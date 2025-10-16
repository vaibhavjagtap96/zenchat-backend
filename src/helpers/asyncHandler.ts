// helpers/asyncHandler.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Generic async handler that allows using custom Request types (like ProtectedRequest)
 */
export type AsyncFunction<T extends Request = Request> = (
  req: T,
  res: Response,
  next: NextFunction
) => Promise<any>;

export default function asyncHandler<T extends Request = Request>(
  execution: AsyncFunction<T>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(execution(req as T, res, next)).catch(next);
  };
}
