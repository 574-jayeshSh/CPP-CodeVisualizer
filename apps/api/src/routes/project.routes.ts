import { Router } from "express";
import { z } from "zod";

import type { CompilationSummary, Language, ProjectDto } from "@codelens/shared";

import { prisma } from "../db.js";
import { asyncHandler, sendError } from "../http.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

function toProjectDto(project: {
  id: string;
  name: string;
  language: string;
  sourceCode: string;
  createdAt: Date;
  updatedAt: Date;
}): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    language: project.language as Language,
    sourceCode: project.sourceCode,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  language: z.literal("cpp").optional(),
  sourceCode: z.string().max(200_000).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  sourceCode: z.string().max(200_000).optional(),
  language: z.literal("cpp").optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: { userId: req.user?.id },
      orderBy: { updatedAt: "desc" },
    });

    res.json(projects.map(toProjectDto));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, 400, "Invalid project payload.", parsed.error.flatten());
      return;
    }

    const project = await prisma.project.create({
      data: {
        name: parsed.data.name,
        language: parsed.data.language ?? "cpp",
        sourceCode: parsed.data.sourceCode ?? "",
        userId: req.user?.id ?? "",
      },
    });

    res.status(201).json(toProjectDto(project));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user?.id },
    });

    if (!project) {
      sendError(res, 404, "Project not found.");
      return;
    }

    res.json(toProjectDto(project));
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, 400, "Invalid project payload.", parsed.error.flatten());
      return;
    }

    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user?.id },
    });

    if (!existing) {
      sendError(res, 404, "Project not found.");
      return;
    }

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.sourceCode !== undefined && {
          sourceCode: parsed.data.sourceCode,
        }),
        ...(parsed.data.language !== undefined && {
          language: parsed.data.language,
        }),
      },
    });

    res.json(toProjectDto(project));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user?.id },
    });

    if (!existing) {
      sendError(res, 404, "Project not found.");
      return;
    }

    await prisma.project.delete({ where: { id: existing.id } });

    res.status(204).end();
  }),
);

router.get(
  "/:id/compilations",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user?.id },
    });

    if (!project) {
      sendError(res, 404, "Project not found.");
      return;
    }

    const compilations = await prisma.compilation.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const summaries: CompilationSummary[] = compilations.map((compilation) => ({
      id: compilation.id,
      projectId: compilation.projectId ?? project.id,
      status: compilation.status === "success" ? "success" : "failed",
      errorCount: compilation.errorCount,
      warningCount: compilation.warningCount,
      totalDurationMs: compilation.totalDurationMs,
      createdAt: compilation.createdAt.toISOString(),
    }));

    res.json(summaries);
  }),
);

export { router as projectRouter };
