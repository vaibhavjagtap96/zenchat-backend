import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { corsUrl, environment } from "./config";
import authRoutes from "./routes/user.routes";
import chatRoutes from "./routes/chat.routes";
import messageRoutes from "./routes/message.routes";
import "./database"; // initialize database
import {
  ApiError,
  ErrorType,
  InternalError,
  RateLimitError,
} from "./core/ApiError";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { createServer, Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { initSocketIo } from "./socket";
import path from "path";
import { RateLimitRequestHandler, rateLimit } from "express-rate-limit";
import requestIp from "request-ip";

const app = express();

// creation of http server
const httpServer = createServer(app);

// middleware to get the ip of client from the request
app.use(requestIp.mw());

// Adding a rate limiter to the server
const limiter: RateLimitRequestHandler = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // Limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => requestIp.getClientIp(req) || "",
  handler: (req: Request, res: Response, next: NextFunction, options) => {
    next(
      new RateLimitError(
        `You exceeded the request limit. Allowed ${options.max} requests per ${
          options.windowMs / 60000
        } minute.`
      )
    );
  },
});

// Apply the rate limiter to all routes
app.use(limiter);

// express app middlewares
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(
  cors({
    origin: corsUrl,
    optionsSuccessStatus: 200,
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(cookieParser());

// ✅ Root route (so “Cannot GET /” no longer appears)
app.get("/", (req, res) => {
  res.send("🚀 ZenChat Backend Server is Running Successfully!");
});

// HEALTH CHECK ROUTE
app.get("/health", (req, res) => {
  res.send("healthy running");
});

// auth Routes
app.use("/auth", authRoutes);

// chat Routes
app.use("/api/chat", chatRoutes);

// message Routes
app.use("/api/messages", messageRoutes);

// static images
app.use("/public", express.static(path.join(__dirname, "..", "public")));

// socket server setup
const io = new SocketServer(httpServer, {
  pingTimeout: 60000,
  cors: {
    origin: corsUrl,
    credentials: true,
  },
});

// initialize socket server
initSocketIo(io);
app.set("io", io);

// middleware error handlers
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof ApiError) {
    ApiError.handle(err, res);
    if (err.type === ErrorType.INTERNAL)
      console.error(
        `500 - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}\nError Stack: ${err.stack}`
      );
  } else {
    console.error(
      `500 - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}\nError Stack: ${err.stack}`
    );
    if (environment === "development") {
      return res.status(500).send(err.stack);
    }
    ApiError.handle(new InternalError(), res);
  }
});

export default httpServer;
