import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { corsUrl, environment } from "./config";
import authRoutes from "./routes/user.routes";
import chatRoutes from "./routes/chat.routes";
import messageRoutes from "./routes/message.routes";
import "./database";
import {
  ApiError,
  ErrorType,
  InternalError,
  RateLimitError,
} from "./core/ApiError";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { initSocketIo } from "./socket";
import path from "path";
import { rateLimit } from "express-rate-limit";
import requestIp from "request-ip";

const app = express();

// ✅ Health check
app.get("/", (_req: Request, res: Response) => {
  res.status(200).send("✅ ZenChat Backend is Running Successfully on Render!");
});

// ✅ Client IP middleware
app.use(requestIp.mw());

// ✅ Rate limiter
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => requestIp.getClientIp(req) || "",
  handler: (_req, _res, next, options) => {
    next(
      new RateLimitError(
        `Too many requests. Limit ${options.max} per ${
          options.windowMs / 60000
        } minute.`
      )
    );
  },
});
app.use(limiter);

// ✅ Allowed CORS origins
const allowedOrigins: string[] = Array.isArray(corsUrl)
  ? [...corsUrl, "https://zenchat-frontend.onrender.com"]
  : [corsUrl, "https://zenchat-frontend.onrender.com"];

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(cookieParser());

// ✅ API Routes
app.get("/health", (_req, res) => res.send("healthy running"));
app.use("/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/messages", messageRoutes);

// ✅ Static files
app.use("/public", express.static(path.join(__dirname, "..", "public")));

// ✅ HTTP + Socket.IO
const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  pingTimeout: 60000,
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

initSocketIo(io);
app.set("io", io);

// ✅ Global Error Handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    ApiError.handle(err, res);
    if (err.type === ErrorType.INTERNAL)
      console.error(
        `500 - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}\n${err.stack}`
      );
  } else {
    console.error(
      `500 - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}\n${err.stack}`
    );
    if (environment === "development") return res.status(500).send(err.stack);
    ApiError.handle(new InternalError(), res);
  }
});

export default httpServer;
