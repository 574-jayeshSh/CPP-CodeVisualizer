import { Router } from "express";
import { z } from "zod";

import type { CompileResult } from "@codelens/shared";

import { prisma } from "../db.js";
import { asyncHandler, sendError } from "../http.js";
import { attachUser } from "../middleware/auth.js";
import { compilerService } from "../services/compiler.service.js";
import { saveCompilation } from "../services/compilation.store.js";

const router = Router();

const compileSchema = z.object({
  source: z.string().min(1).max(200_000),
  projectId: z.string().min(1).max(64).optional(),
  language: z.literal("cpp").optional(),
  steps: z
    .array(z.enum(["lex", "parse", "semantic", "codegen"]))
    .min(1)
    .max(4)
    .optional(),
});

router.post(
  "/",
  attachUser,
  asyncHandler(async (req, res) => {
    const parsed = compileSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, 400, "Invalid compile payload.", parsed.error.flatten());
      return;
    }

    const { source, projectId, steps } = parsed.data;

    if (projectId) {
      if (!req.user) {
        sendError(res, 401, "Authentication required for project compilation.");
        return;
      }

      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: req.user.id },
      });

      if (!project) {
        sendError(res, 404, "Project not found.");
        return;
      }
    }

    const result: CompileResult = await compilerService.compile(source, {
      projectId,
      steps,
    });

    await saveCompilation(result, {
      projectId,
      userId: req.user?.id,
    });

    res.json(result);
  }),
);

export { router as compileRouter };
