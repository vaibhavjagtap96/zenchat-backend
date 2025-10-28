import { Request, Response } from "express";
import asyncHandler from "../helpers/asyncHandler";
import userRepo from "../database/repositories/userRepo";
import { AuthFailureError, BadRequestError } from "../core/ApiError";
import { RoleCode } from "../database/model/Role";
import User from "../database/model/User";
import bcrypt from "bcrypt";
import { createTokens } from "./auth/authUtils";
import { filterUserData } from "../helpers/utils";
import { SuccessResponse } from "../core/ApiResponse";
import { environment } from "../config";

const signUp = asyncHandler(async (req: Request, res: Response) => {
  const { email, username, password } = req.body;

  // check if email already exists
  const existingUserEmail = await userRepo.findByEmail(email);
  if (existingUserEmail) {
    throw new BadRequestError("Email already exists");
  }

  // check if username already exists
  const existingUserUsername = await userRepo.findByUsername(username);
  if (existingUserUsername) {
    throw new BadRequestError("Username already exists");
  }

  // hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // random avatar number between 1 and 23
  const avatarNumber = Math.floor(Math.random() * 23) + 1;

  // add leading zero for numbers below 10
  const formattedNumber = avatarNumber < 10 ? `0${avatarNumber}` : `${avatarNumber}`;

  // create a new user
  const user = await userRepo.create(
    {
      username,
      email,
      password: hashedPassword,
      avatarUrl: `https://imageserver-1-466g.onrender.com/static/avatars/avatar${formattedNumber}.avif`,
    } as User,
    RoleCode.USER
  );

  const tokens = await createTokens(user);
  const userData = await filterUserData(user);

  new SuccessResponse("Signup successful", {
    user: userData,
    tokens,
  }).send(res);
});

const login = asyncHandler(async (req: Request, res: Response) => {
  const { userId, password } = req.body;

  const user = await userRepo.findByEmailOrUsername(userId);
  if (!user) throw new BadRequestError("Invalid email/username");

  if (!password) throw new BadRequestError("No credentials provided");

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new AuthFailureError("Invalid credentials");

  const { password: pass, status, ...filteredUser } = user;

  const tokens = await createTokens(user);

  const options = {
    httpOnly: true,
    secure: environment === "production",
  };

  // attach cookies to response
  res
    .cookie("accessToken", tokens.accessToken, options)
    .cookie("refreshToken", tokens.refreshToken, options);

  new SuccessResponse("Login successful", {
    user: filteredUser,
    tokens,
  }).send(res);
});

const logout = asyncHandler(async (req: Request, res: Response) => {
  const options = {
    httpOnly: true,
    secure: environment === "production",
  };

  res.clearCookie("accessToken", options).clearCookie("refreshToken", options);

  new SuccessResponse("Logout successful", {}).send(res);
});

export { signUp, login, logout };
