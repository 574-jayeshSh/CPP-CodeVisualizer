import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { config } from "../config.js";

export interface AuthPayload {
  id: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;

  if (header && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }

  return null;
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as unknown as AuthPayload;
  } catch {
    return null;
  }
}

export function resolveUser(token: string | null): AuthPayload | null {
  if (!token) return null;
  return verifyToken(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readToken(req);
  const user = resolveUser(token);

  if (!user) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }

  req.user = user;
  next();
}

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const user = resolveUser(readToken(req));

  if (user) {
    req.user = user;
  }

  next();
}
