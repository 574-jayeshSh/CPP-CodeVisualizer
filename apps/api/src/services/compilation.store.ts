import type { CompileResult } from "@codelens/shared";
import type { Prisma } from "@prisma/client";

import { prisma } from "../db.js";

export interface SaveCompilationOptions {
  projectId?: string;
  userId?: string;
}

export async function saveCompilation(
  result: CompileResult,
  options: SaveCompilationOptions = {},
): Promise<void> {
  try {
    const errorCount = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === "error" || diagnostic.severity === "fatal",
    ).length;

    const warningCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length;

    await prisma.compilation.create({
      data: {
        id: result.id,
        projectId: options.projectId ?? null,
        userId: options.userId ?? null,
        status: result.status,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
        errorCount,
        warningCount,
        totalDurationMs: Math.round(result.totalDurationMs),
      },
    });
  } catch (error) {
    console.error("Failed to persist compilation:", error);
  }
}
