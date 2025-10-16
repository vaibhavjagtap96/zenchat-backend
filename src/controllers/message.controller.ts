// controllers/message.controller.ts
import { Request, Response } from "express";
import { Types } from "mongoose";
import asyncHandler from "../helpers/asyncHandler";
import chatRepo from "../database/repositories/chatRepo";
import messageRepo from "../database/repositories/messageRepo";
import {
  getLocalFilePath,
  getStaticFilePath,
  removeLocalFile,
} from "../helpers/utils";
import { emitSocketEvent } from "../socket";
import { ChatEventEnum } from "../constants";
import Chat from "../database/model/Chat";
import { ProtectedRequest } from "../types/app-request";
import {
  AuthFailureError,
  BadRequestError,
  InternalError,
  NotFoundError,
} from "../core/ApiError";
import { SuccessMsgResponse, SuccessResponse } from "../core/ApiResponse";

/**
 * Helper to safely extract ProtectedRequest.user
 */
function getProtectedUser(req: Request) {
  return (req as ProtectedRequest).user;
}

/**
 * Get all messages of a chat (aggregated)
 */
export const getAllMessages = asyncHandler(
  async (req: Request, res: Response) => {
    const { chatId } = req.params;
    const currentUser = getProtectedUser(req);

    if (!chatId) throw new BadRequestError("no chat id provided");

    // retrieve the chat of corresponding chatId
    const selectedChat = await chatRepo.getChatByChatId(
      new Types.ObjectId(chatId)
    );

    // if not chat found throw an error
    if (!selectedChat) {
      throw new NotFoundError("no chat found to retrieve messages");
    }

    // check for existence of current user in the chat
    // FIXED: if currentUser is NOT part of participants -> throw
    if (
      !selectedChat.participants?.some(
        (p: Types.ObjectId | string) =>
          p.toString() === currentUser?._id.toString()
      )
    ) {
      throw new AuthFailureError("you don't own the chat !");
    }

    // get all the messages in aggregated form
    const messages = await messageRepo.getAllMessagesAggregated(
      new Types.ObjectId(chatId)
    );

    if (!messages) {
      throw new InternalError("error while retrieving messages");
    }

    return new SuccessResponse("messages retrieved successfully", messages).send(
      res
    );
  }
);

/**
 * Send a message (with optional attachments)
 */
export const sendMessage = asyncHandler(
  async (req: Request, res: Response) => {
    const { content } = req.body;
    const { chatId } = req.params;

    const currentUserId = getProtectedUser(req)?._id;

    // multer attaches files on req.files (may be array or object)
    const filesObj =
      ((req as any).files as { attachments?: Express.Multer.File[] }) || {
        attachments: [],
      };

    const attachmentsFiles = filesObj.attachments || [];

    if (!chatId) {
      throw new BadRequestError("no chat id provided");
    }

    if (!content && attachmentsFiles.length === 0) {
      throw new BadRequestError("no content provided");
    }

    const selectedChat = await chatRepo.getChatByChatId(
      new Types.ObjectId(chatId)
    );

    if (!selectedChat) {
      throw new NotFoundError("No chat found");
    }

    // build attachments with url and localPath
    const attachmentFiles: { url: string; localPath: string }[] = [];

    attachmentsFiles.forEach((attachment) => {
      attachmentFiles.push({
        url: getStaticFilePath(attachment.filename),
        localPath: getLocalFilePath(attachment.filename),
      });
    });

    // create a new message
    const message = await messageRepo.createMessage(
      new Types.ObjectId(currentUserId),
      new Types.ObjectId(chatId),
      content || "",
      attachmentFiles
    );

    // update the last message of the chat
    const updatedChat = await chatRepo.updateChatFields(
      new Types.ObjectId(chatId),
      { lastMessage: message._id }
    );

    // structure the message for response
    const structuredMessage = await messageRepo.getStructuredMessages(
      message._id
    );

    if (!structuredMessage.length) {
      throw new InternalError("error creating message: " + message._id);
    }

    // emit socket event to other participants
    updatedChat.participants.forEach((participantId: Types.ObjectId) => {
      if (participantId.toString() === currentUserId.toString()) return;

      emitSocketEvent(
        req,
        participantId.toString(),
        ChatEventEnum.MESSAGE_RECEIVED_EVENT,
        structuredMessage[0]
      );
    });

    return new SuccessResponse(
      "message sent successfully",
      structuredMessage[0]
    ).send(res);
  }
);

/**
 * Delete a message
 */
export const deleteMessage = asyncHandler(
  async (req: Request, res: Response) => {
    const { messageId } = req.params;
    const currentUserId = getProtectedUser(req)?._id;

    if (!messageId) {
      throw new BadRequestError("no message id provided");
    }

    const existingMessage = await messageRepo.getMessageById(
      new Types.ObjectId(messageId)
    );

    if (!existingMessage)
      throw new BadRequestError("invalid message id, message not found");

    // fetch the existing chat
    const existingChat = await chatRepo.getChatByChatId(existingMessage?.chat);

    if (!existingChat)
      throw new InternalError("Internal Error: chat not found");

    // ensure current user is a participant of the chat
    if (
      !existingChat?.participants?.some(
        (participantId: Types.ObjectId) =>
          participantId.toString() === currentUserId.toString()
      )
    ) {
      throw new AuthFailureError("you don't own the message");
    }

    // ensure current user is the sender of the message
    if (!(existingMessage.sender.toString() === currentUserId.toString()))
      throw new AuthFailureError("you don't own the message ");

    // delete attachments from local folder (if any)
    if (
      existingMessage &&
      existingMessage.attachments &&
      existingMessage.attachments.length > 0
    ) {
      existingMessage.attachments.forEach(({ localPath }: any) => {
        removeLocalFile(localPath);
      });
    }

    // delete the message from database
    const deletedMsg = await messageRepo.deleteMessageById(existingMessage._id);

    if (!deletedMsg)
      throw new InternalError("Internal Error: Couldn't delete message");

    // update the last message of the chat if needed
    let lastMessage: any;
    if (
      existingChat?.lastMessage?.toString() === existingMessage._id.toString()
    ) {
      lastMessage = await messageRepo.getLastMessage(existingChat._id);

      await chatRepo.updateChatFields(existingChat._id, {
        $set: {
          lastMessage: lastMessage ? lastMessage._id : null,
        },
      });
    }

    // emit delete message event to other participants
    existingChat.participants.forEach((participantId: Types.ObjectId) => {
      if (participantId.toString() === currentUserId.toString()) return;

      emitSocketEvent(req, participantId.toString(), ChatEventEnum.MESSAGE_DELETE_EVENT, {
        messageId: existingMessage._id,
        // chatLastMessage: lastMessage?.content || "attachment",
      });
    });

    return new SuccessMsgResponse("message deleted successfully").send(res);
  }
);
