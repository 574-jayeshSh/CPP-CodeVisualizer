import { mkdtemp, writeFile, rm } from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { config } from "../config.js";

import type { RunResult } from "@codelens/shared";

export interface RunOptions {
  source: string;
  stdin?: string;
  timeLimitMs?: number;
}

export interface RunService {
  run(options: RunOptions): Promise<RunResult>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

interface ExecOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  stdin?: string;
  memoryMb?: number;
}

function execute(command: string, args: string[], options: ExecOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: "C.UTF-8",
      },
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const killChild = () => {
      if (child.pid === undefined) return;

      try {
        if (process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
          return;
        }
      } catch {
        // fall through to a direct kill
      }

      try {
        child.kill("SIGKILL");
      } catch {
        // process already exited
      }
    };

    const finish = (error?: Error, result?: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, options.timeoutMs);

    const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      outputBytes += chunk.length;

      if (outputBytes > options.maxOutputBytes) {
        truncated = true;
        killChild();
        return;
      }

      if (target === "stdout") {
        stdout += chunk.toString();
      } else {
        stderr += chunk.toString();
      }
    };

    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));

    child.on("error", (error) => {
      finish(error);
    });

    child.on("close", (exitCode) => {
      finish(undefined, {
        stdout,
        stderr,
        exitCode: timedOut ? null : exitCode,
        timedOut,
        truncated,
      });
    });

    if (options.stdin !== undefined) {
      child.stdin.on("error", () => {
        // the process may exit before consuming stdin
      });
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

class ClangRunService implements RunService {
  async run(options: RunOptions): Promise<RunResult> {
    const startTime = performance.now();
    const { source, stdin = "" } = options;

    if (!source.trim()) {
      return {
        stdout: "",
        stderr: "Source code cannot be empty.",
        exitCode: null,
        timedOut: false,
        durationMs: 0,
      };
    }

    const clangPath = config.clangPath || "clang++";
    let workDir: string | undefined;

    try {
      workDir = await mkdtemp(path.join(os.tmpdir(), "codelens-run-"));

      const sourceFile = path.join(workDir, "main.cpp");
      const binaryFile = path.join(workDir, "program");

      await writeFile(sourceFile, source, "utf8");

      const build = await execute(
        clangPath,
        ["-std=" + config.compile.std, "-O2", "-o", binaryFile, sourceFile],
        {
          cwd: workDir,
          timeoutMs: config.compile.timeoutMs,
          maxOutputBytes: config.run.maxOutputBytes,
        },
      );

      if (build.exitCode !== 0) {
        return {
          stdout: build.stdout,
          stderr: build.stderr || "Compilation failed.",
          exitCode: build.exitCode,
          timedOut: false,
          durationMs: performance.now() - startTime,
        };
      }

      const timeLimitMs = Math.min(
        Math.max(options.timeLimitMs ?? config.run.timeLimitMs, 50),
        config.run.timeoutMs,
      );

      const memoryKb = Math.max(config.run.memoryMb, 32) * 1024;

      const execution = await execute(
        "/bin/bash",
        ["-c", `ulimit -v ${memoryKb} 2>/dev/null; exec "$0"`, binaryFile],
        {
          cwd: workDir,
          timeoutMs: timeLimitMs,
          maxOutputBytes: config.run.maxOutputBytes,
          stdin,
          memoryMb: config.run.memoryMb,
        },
      );

      let stderr = execution.stderr;
      if (execution.truncated) {
        stderr += (stderr ? "\n" : "") + "[output truncated]";
      }

      return {
        stdout: execution.stdout,
        stderr,
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        durationMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr:
          error instanceof Error ? error.message : "Failed to execute program.",
        exitCode: null,
        timedOut: false,
        durationMs: performance.now() - startTime,
      };
    } finally {
      if (workDir) {
        try {
          await rm(workDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Failed to clean run workspace:", error);
        }
      }
    }
  }
}

export const runService = new ClangRunService();
