import "dotenv/config";
import path from "node:path";

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/codelens",

  /** local = spawn clang directly (dev), docker = run inside sandbox image (prod) */
  sandboxMode: (process.env.SANDBOX_MODE ?? "local") as "local" | "docker",
  clangPath: process.env.CLANG_PATH ?? "",
  sandboxImage: process.env.SANDBOX_IMAGE ?? "codelens-sandbox:latest",

  workDir: process.env.CODELENS_WORK_DIR ?? path.join(process.cwd(), ".codelens-work"),

  compile: {
    timeoutMs: Number(process.env.COMPILE_TIMEOUT_MS ?? 20_000),
    std: (process.env.CLANG_STD ?? "c++17") as string,
    maxDiagnostics: Number(process.env.MAX_DIAGNOSTICS ?? 100),
    maxTokens: Number(process.env.MAX_TOKENS ?? 5_000),
  },

  run: {
    timeoutMs: Number(process.env.RUN_TIMEOUT_MS ?? 5_000),
    timeLimitMs: Number(process.env.RUN_TIME_LIMIT_MS ?? 3_000),
    memoryMb: Number(process.env.RUN_MEMORY_MB ?? 256),
    maxOutputBytes: Number(process.env.RUN_MAX_OUTPUT_BYTES ?? 64 * 1024),
  },
};
