import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({
    message,
    ...(details !== undefined && { details }),
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  sendError(res, 404, "Endpoint not found.");
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    sendError(res, 400, "Invalid request payload.", error.flatten());
    return;
  }

  console.error("Unhandled API error:", error);
  sendError(res, 500, "Internal server error.");
}
