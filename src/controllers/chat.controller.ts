import { Request, Response } from "express";
import asyncHandler from "../helpers/asyncHandler";
import userRepo from "../database/repositories/userRepo";
import {
  AuthFailureError,
  BadRequestError,
  InternalError,
  NoDataError,
  NotFoundError,
} from "../core/ApiError";
import chatRepo from "../database/repositories/chatRepo";
import { SuccessMsgResponse, SuccessResponse } from "../core/ApiResponse";
import { Types } from "mongoose";
import { emitSocketEvent } from "../socket";
import { ChatEventEnum } from "../constants";
import User from "../database/model/User";
import { ProtectedRequest } from "../types/app-request";
import { removeLocalFile } from "../helpers/utils";
import messageRepo from "../database/repositories/messageRepo";

// search available users
const searchAvailableusers = asyncHandler(
  async (req: Request, res: Response) => {
    const { user } = req as ProtectedRequest;
    const userId = req.query.userId as string;

    if (!userId)
      throw new BadRequestError("invalid search, provide a username or email");

    const users = await userRepo.searchAvailableUsers(user, userId);

    if (!users.length) {
      throw new NoDataError("no users found");
    }

    return new SuccessResponse("found Users", { users }).send(res);
  }
);

// method to create or return existing chat
const createOrGetExistingChat = asyncHandler(
  async (req: Request, res: Response) => {
    const { user } = req as ProtectedRequest;
    const { receiverId } = req.params;

    const currentUserId = user?._id;

    const receiver = await userRepo.findById(new Types.ObjectId(receiverId));
    if (!receiver) throw new BadRequestError("receiver does not exist");

    if (receiver._id.toString() === currentUserId.toString()) {
      throw new BadRequestError("you cannot chat with yourself");
    }

    const chat = await chatRepo.getExistingOneToOneChat(
      currentUserId,
      new Types.ObjectId(receiverId)
    );

    if (chat.length) {
      return new SuccessResponse("chat retrieved successfully", {
        existing: true,
        ...chat[0],
      }).send(res);
    }

    const newChatInstance = await chatRepo.createNewOneToOneChat(
      currentUserId,
      new Types.ObjectId(receiverId)
    );

    const newChatId = newChatInstance._id;
    const createdChat = await chatRepo.getChatByChatIdAggregated(newChatId);

    if (!createdChat.length) {
      throw new InternalError("unable to create a one-to-one chat instance");
    }

    createdChat[0]?.participants?.forEach((participant: User) => {
      if (participant._id?.toString() === user?._id.toString()) return;

      emitSocketEvent(
        req,
        participant._id?.toString(),
        ChatEventEnum.NEW_CHAT_EVENT,
        createdChat[0]
      );
    });

    return new SuccessResponse("chat created successfully", {
      existing: false,
      ...createdChat[0],
    }).send(res);
  }
);

// get all chat of logged-in user
const getCurrentUserChats = asyncHandler(
  async (req: Request, res: Response) => {
    const { user } = req as ProtectedRequest;
    const currentUserId = user?._id;

    const chats = await chatRepo.getCurrentUserAllChats(currentUserId);
    return new SuccessResponse(
      "user chats fetched successfully",
      chats || []
    ).send(res);
  }
);

// create a group chat
const createGroupChat = asyncHandler(
  async (req: Request, res: Response) => {
    const { user } = req as ProtectedRequest;
    const { name, participants } = req.body;
    const currentUserId = user?._id;

    if (participants?.includes(currentUserId.toString())) {
      throw new BadRequestError(
        "invalid participants, contains the current user"
      );
    }

    const members = [...new Set([...participants, user._id.toString()])];

    if (members.length < 3) {
      throw new BadRequestError("invalid participants length");
    }

    const createdGroupChat = await chatRepo.createNewGroupChat(
      currentUserId,
      name,
      members
    );

    const chatRes = await chatRepo.getAggregatedGroupChat(createdGroupChat._id);
    const groupChat = chatRes[0];

    groupChat?.participants?.forEach((participant: any) => {
      if (participant._id?.toString() === currentUserId?.toString()) return;

      emitSocketEvent(
        req,
        participant._id?.toString(),
        ChatEventEnum.NEW_CHAT_EVENT,
        groupChat
      );
    });

    return new SuccessResponse(
      "group chat created successfully",
      groupChat
    ).send(res);
  }
);

const getGroupChatDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { chatId } = req.params;

    const chatRes = await chatRepo.getAggregatedGroupChat(
      new Types.ObjectId(chatId)
    );

    const groupChatDetails = chatRes[0];
    if (!groupChatDetails) throw new NoDataError("group chat not found!");

    return new SuccessResponse(
      "group chat fetched successfully",
      groupChatDetails
    ).send(res);
  }
);

// add new user to the group chat
const addNewUserToGroup = asyncHandler(
  async (req: Request, res: Response) => {
    const { user } = req as ProtectedRequest;
    const { chatId } = req.params;
    const { newParticipantId } = req.body;
    const currentUserId = user?._id;

    if (!chatId) throw new BadRequestError("no chatId provided");

    const existingGroupChat = await chatRepo.getChatByChatId(
      new Types.ObjectId(chatId)
    );

    if (!existingGroupChat) throw new NotFoundError("no group chat found");

    if (existingGroupChat.admin?.toString() !== currentUserId?.toString()) {
      throw new BadRequestError("only admins can add new users");
    }

    const existingParticipants = existingGroupChat.participants;
    if (
      existingParticipants.some(
        (participant) => participant.toString() === newParticipantId
      )
    ) {
      throw new BadRequestError("user already exists in the group");
    }

    await chatRepo.updateChatFields(new Types.ObjectId(chatId), {
      $push: { participants: newParticipantId },
    });

    const aggregatedChat = await chatRepo.getAggregatedGroupChat(
      new Types.ObjectId(chatId)
    );

    const updatedChat = aggregatedChat[0];
    if (!updatedChat) throw new InternalError("Internal Server Error");

    return new SuccessResponse(
      "participant added successfully",
      updatedChat
    ).send(res);
  }
);

// delete chat
const deleteChat = asyncHandler(
  async (req: Request, res: Response) => {
    const { user } = req as ProtectedRequest;
    const { chatId } = req.params;
    const currentUserId = user?._id;

    const existingChat = await chatRepo.getChatByChatId(
      new Types.ObjectId(chatId)
    );

    if (!existingChat) throw new NotFoundError("chat not found");

    if (!existingChat.isGroupChat) {
      if (existingChat.admin.toString() !== currentUserId.toString()) {
        throw new AuthFailureError("only admins can delete the group");
      }
    }

    if (
      !existingChat?.participants?.some(
        (participantId) => participantId.toString() === currentUserId.toString()
      )
    ) {
      throw new AuthFailureError("you cannot delete others' chats");
    }

    await chatRepo.deleteChatById(existingChat._id);

    const existingMessages = await messageRepo.getMessagesOfChatId(
      existingChat._id
    );

    const attachments: { url: string; localPath: string }[][] = [];
    existingMessages.forEach((message: any) => {
      if (message.attachments?.length > 0) {
        attachments.push(message.attachments);
      }
    });

    attachments.forEach((attachment) => {
      attachment.forEach(({ localPath }) => removeLocalFile(localPath));
    });

    await messageRepo.deleteAllMessagesOfChatId(existingChat._id);

    existingChat.participants.forEach((participantId) => {
      if (participantId.toString() === currentUserId.toString()) return;

      emitSocketEvent(
        req,
        participantId.toString(),
        ChatEventEnum.LEAVE_CHAT_EVENT,
        existingChat
      );
    });

    return new SuccessMsgResponse("chat deleted successfully").send(res);
  }
);

export {
  searchAvailableusers,
  createOrGetExistingChat,
  getCurrentUserChats,
  createGroupChat,
  getGroupChatDetails,
  addNewUserToGroup,
  deleteChat,
};
