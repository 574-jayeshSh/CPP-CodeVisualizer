import { randomUUID } from "node:crypto";

import type { Server, Socket } from "socket.io";

import type { ClientSocketEvents, CompileStep, SocketEvents } from "@codelens/shared";

import { resolveUser } from "./middleware/auth.js";
import { compilerService } from "./services/compiler.service.js";
import { saveCompilation } from "./services/compilation.store.js";

type AppServer = Server<ClientSocketEvents, SocketEvents>;
type AppSocket = Socket<ClientSocketEvents, SocketEvents>;

const ALL_STEPS: CompileStep[] = ["lex", "parse", "semantic", "codegen"];

const STEP_VALUES = new Set<string>(ALL_STEPS);

function sanitizeSteps(raw: unknown): CompileStep[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const steps = raw.filter(
    (value): value is CompileStep =>
      typeof value === "string" && STEP_VALUES.has(value),
  );

  return steps.length > 0 ? ALL_STEPS.filter((step) => steps.includes(step)) : undefined;
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

async function handleCompileRequest(
  socket: AppSocket,
  payload: unknown,
  userId: string | undefined,
): Promise<void> {
  const raw = (payload ?? {}) as Record<string, unknown>;

  const requestId = sanitizeString(raw.requestId, 64) ?? randomUUID();
  const compilationId = randomUUID();
  const source = typeof raw.source === "string" ? raw.source : "";
  const projectId = sanitizeString(raw.projectId, 64);
  const steps = sanitizeSteps(raw.steps);

  socket.emit("compile:start", {
    requestId,
    compilationId,
    projectId,
    steps: steps ?? ALL_STEPS,
  });

  try {
    const result = await compilerService.compile(source, {
      id: compilationId,
      projectId,
      steps,
      onStage: (event) => {
        socket.emit("compile:step", {
          requestId,
          compilationId,
          step: event.step,
          status: event.status,
          ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
          progress: event.progress,
        });
      },
    });

    await saveCompilation(result, { projectId, userId });

    socket.emit("compile:done", { requestId, compilationId, result });
  } catch (error) {
    socket.emit("compile:error", {
      requestId,
      compilationId,
      message:
        error instanceof Error ? error.message : "Unexpected compilation error",
    });
  }
}

export function setupSocket(io: AppServer): void {
  io.on("connection", (socket) => {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const token = typeof auth?.token === "string" ? auth.token : null;
    const user = resolveUser(token);

    socket.on("compile:request", (payload) => {
      void handleCompileRequest(socket, payload, user?.id);
    });
  });
}
