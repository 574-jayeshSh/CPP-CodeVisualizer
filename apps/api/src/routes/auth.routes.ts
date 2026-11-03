import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "../db.js";
import { asyncHandler, sendError } from "../http.js";
import { requireAuth, signToken } from "../middleware/auth.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(80),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, 400, "Invalid registration payload.", parsed.error.flatten());
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      sendError(res, 409, "An account with this email already exists.");
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        name: parsed.data.name,
        passwordHash,
      },
    });

    const token = signToken({ id: user.id, email: user.email, name: user.name });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
      },
    });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, 400, "Invalid login payload.", parsed.error.flatten());
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    const valid = user
      ? await bcrypt.compare(parsed.data.password, user.passwordHash)
      : false;

    if (!user || !valid) {
      sendError(res, 401, "Invalid email or password.");
      return;
    }

    const token = signToken({ id: user.id, email: user.email, name: user.name });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
      },
    });
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;

    if (!user) {
      sendError(res, 401, "Authentication required.");
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    });
  }),
);

export { router as authRouter };
