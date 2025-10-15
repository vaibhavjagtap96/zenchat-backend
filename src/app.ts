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
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { initSocketIo } from "./socket";
import path from "path";
import { rateLimit } from "express-rate-limit";
import requestIp from "request-ip";

const app = express();

// ✅ Health check route to fix GET / 404 on Render
app.get("/", (req: Request, res: Response) => {
  res.status(200).send("✅ ZenChat Backend is Running Successfully on Render!");
});

// ✅ Middleware: client IP tracking
app.use(requestIp.mw());

// ✅ Rate limiter
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => requestIp.getClientIp(req) || "",
  handler: (_req, _res, next, options) => {
    next(
      new RateLimitError(
        `You exceeded the request limit. Allowed ${options.max} requests per ${
          options.windowMs / 60000
        } minute.`
      )
    );
  },
});
app.use(limiter);

// ✅ Basic middlewares
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(
  cors({
    origin: [
      corsUrl,
      "https://zenchat-frontend.onrender.com", // Allow frontend hosted on Render
    ],
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(cookieParser());

// ✅ API routes
app.get("/health", (req, res) => res.send("healthy running"));
app.use("/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/messages", messageRoutes);

// ✅ Static files (public)
app.use("/public", express.static(path.join(__dirname, "..", "public")));

// ✅ Create HTTP + Socket.IO server
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  pingTimeout: 60000,
  cors: {
    origin: [
      corsUrl,
      "https://zenchat-frontend.onrender.com",
    ],
    credentials: true,
  },
});

// Initialize sockets
initSocketIo(io);
app.set("io", io);

// ✅ Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
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
    if (environment === "development") return res.status(500).send(err.stack);
    ApiError.handle(new InternalError(), res);
  }
});

// ✅ Export HTTP server for external use
export default httpServer;
