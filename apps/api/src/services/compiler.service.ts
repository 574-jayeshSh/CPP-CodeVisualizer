import { mkdtemp, writeFile, rm } from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { config } from "../config.js";

import type {
  CompileResult,
  CompileStep,
  StageResult,
  LexResult,
  ParseResult,
  SemanticResult,
  CodegenResult,
  Token,
  AstNode,
  SymbolEntry,
  Diagnostic,
  DiagnosticSeverity,
} from "@codelens/shared";

export interface CompileStageEvent {
  step: CompileStep;
  status: StageResult<unknown>["status"];
  durationMs?: number;
  progress: number;
}

export interface CompileOptions {
  /** Pre-allocated id so callers can announce a compilation before it runs. */
  id?: string;
  projectId?: string;
  steps?: CompileStep[];
  onStage?: (event: CompileStageEvent) => void;
}

export interface CompilerService {
  compile(source: string, options?: CompileOptions): Promise<CompileResult>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface ClangAstNode {
  id?: string;
  kind?: string;
  name?: string;
  type?: {
    qualType?: string;
  };
  value?: string | number | boolean;
  loc?: {
    line?: number;
    col?: number;
    file?: string;
  };
  range?: {
    begin?: {
      line?: number;
      col?: number;
      file?: string;
    };
    end?: {
      line?: number;
      col?: number;
      file?: string;
    };
  };
  inner?: ClangAstNode[];
}

const ALL_STEPS: CompileStep[] = ["lex", "parse", "semantic", "codegen"];

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const MAX_AST_BYTES = 32 * 1024 * 1024;

const CLANG_TIMEOUT = config.compile.timeoutMs;

const CLANG_STD = config.compile.std;

const CLANG_PATH = config.clangPath || "clang++";

function executeClang(args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLANG_PATH, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: "C",
      },
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;

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
      child.kill("SIGKILL");
      finish(new Error(`Clang process timed out after ${CLANG_TIMEOUT}ms`));
    }, CLANG_TIMEOUT);

    const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      outputBytes += chunk.length;

      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new Error("Compiler output exceeded maximum size"));
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
      finish(undefined, { stdout, stderr, exitCode });
    });
  });
}

function parseDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const regex =
    /^(.*?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/gm;

  let match: RegExpExecArray | null;

  while (
    (match = regex.exec(output)) !== null &&
    diagnostics.length < config.compile.maxDiagnostics
  ) {
    const severity = match[4] as DiagnosticSeverity;

    diagnostics.push({
      severity,
      file: path.basename(match[1] ?? ""),
      message: match[5] ?? "",
      location: {
        line: Number(match[2]),
        column: Number(match[3]),
      },
    });
  }

  return diagnostics;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTokens(output: string, sourceFile: string): Token[] {
  const tokens: Token[] = [];

  // Only tokens whose source location points at the user's file are kept —
  // otherwise every token of every system header would be included.
  const regex = new RegExp(
    String.raw`^(\w+)\s+'((?:\\.|[^'])*)'.*?Loc=<${escapeRegExp(sourceFile)}:(\d+):(\d+)>`,
    "gm",
  );

  let match: RegExpExecArray | null;

  while (
    (match = regex.exec(output)) !== null &&
    tokens.length < config.compile.maxTokens
  ) {
    tokens.push({
      kind: match[1] ?? "unknown",
      value: match[2] ?? "",
      location: {
        line: Number(match[3]),
        column: Number(match[4]),
      },
    });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// File-scoped AST extraction
//
// Dumping the full AST of a TU that includes <iostream> is ~130MB because all
// of the standard library's declarations sit at the top level of the tree, and
// -ast-dump-filter only accepts a single substring (last flag wins), so
// neither buffering the dump nor filtering by name is viable. The dump is
// pretty-printed with a stable layout instead, so it is streamed line by line
// and only the top-level declarations that reference the user's source file
// are parsed and kept.
// ---------------------------------------------------------------------------

const AST_STREAM_MAX_BYTES = 512 * 1024 * 1024;

const AST_INNER_OPEN = '  "inner": [';
const AST_INNER_CLOSE = "  ]";
const AST_ELEMENT_OPEN = "    {";
const AST_ELEMENT_CLOSE = "    }";
const AST_ELEMENT_CLOSE_COMMA = "    },";

interface StreamResult {
  stderr: string;
  exitCode: number | null;
  aborted: boolean;
}

function executeClangStreaming(
  args: string[],
  cwd: string,
  onStdout: (text: string) => "continue" | "abort",
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLANG_PATH, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: "C",
      },
    });

    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let aborted = false;
    let settled = false;

    const finish = (error?: Error, result?: StreamResult) => {
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
      child.kill("SIGKILL");
      finish(new Error(`Clang process timed out after ${CLANG_TIMEOUT}ms`));
    }, CLANG_TIMEOUT);

    child.stdout.on("data", (chunk: Buffer) => {
      if (aborted) return;

      stdoutBytes += chunk.length;

      if (stdoutBytes > AST_STREAM_MAX_BYTES) {
        aborted = true;
        child.kill("SIGKILL");
        return;
      }

      if (onStdout(chunk.toString()) === "abort") {
        aborted = true;
        child.kill("SIGKILL");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;

      if (stderrBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        return;
      }

      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish(error);
    });

    child.on("close", (exitCode) => {
      finish(undefined, { stderr, exitCode, aborted });
    });
  });
}

interface UserDeclarationDump {
  stderr: string;
  declarations: ClangAstNode[];
  formatMismatch: boolean;
  overflow: boolean;
}

async function dumpUserDeclarations(
  sourceFile: string,
  cwd: string,
): Promise<UserDeclarationDump> {
  const declarations: ClangAstNode[] = [];
  // Clang only prints "file" in a location when the file changes from the
  // previously printed location, so declarations in the same file inherit
  // the last file that was printed.
  let currentFile: string | undefined;

  let partialLine = "";
  let totalBytes = 0;
  let phase: "seek-inner" | "in-array" | "done" = "seek-inner";
  let captureLines: string[] | null = null;
  let overflow = false;
  let sawInner = false;

  const finishCapture = () => {
    if (!captureLines) return;

    let text = captureLines.join("\n");
    captureLines = null;

    if (text.length > MAX_AST_BYTES) {
      overflow = true;
      return;
    }

    const fileMatch = /"file":\s*"([^"]+)"/.exec(text);
    const elementFile = fileMatch ? fileMatch[1] : currentFile;

    if (fileMatch) {
      currentFile = elementFile;
    }

    if (elementFile !== sourceFile) {
      return;
    }

    // The element close is `    },` for non-final elements; the trailing
    // comma is not valid JSON.
    if (text.endsWith(AST_ELEMENT_CLOSE_COMMA)) {
      text = text.slice(0, -1);
    }

    try {
      const declaration = JSON.parse(text) as ClangAstNode;
      const pruned = pruneToSourceFile(declaration, sourceFile);
      if (pruned) declarations.push(pruned);
    } catch {
      // ignore a fragment that failed to parse
    }
  };

  const processLine = (line: string) => {
    if (overflow) return;

    if (phase === "seek-inner") {
      if (line === AST_INNER_OPEN) {
        sawInner = true;
        phase = "in-array";
      }
      return;
    }

    if (phase === "done") return;

    if (captureLines === null) {
      if (line === AST_INNER_CLOSE) {
        phase = "done";
      } else if (line === AST_ELEMENT_OPEN) {
        captureLines = [line];
      }
      return;
    }

    captureLines.push(line);

    if (line === AST_ELEMENT_CLOSE || line === AST_ELEMENT_CLOSE_COMMA) {
      finishCapture();
    }
  };

  const result = await executeClangStreaming(
    [
      "-std=" + CLANG_STD,
      "-fno-color-diagnostics",
      "-fsyntax-only",
      "-Xclang",
      "-ast-dump=json",
      sourceFile,
    ],
    cwd,
    (text) => {
      totalBytes += text.length;
      partialLine += text;

      let newlineIndex = partialLine.indexOf("\n");

      while (newlineIndex >= 0) {
        processLine(partialLine.slice(0, newlineIndex));
        partialLine = partialLine.slice(newlineIndex + 1);

        if (overflow) return "abort";
        newlineIndex = partialLine.indexOf("\n");
      }

      if (partialLine.length > MAX_AST_BYTES) {
        overflow = true;
        return "abort";
      }

      return "continue";
    },
  );

  const formatMismatch =
    !sawInner &&
    !overflow &&
    !result.aborted &&
    declarations.length === 0 &&
    totalBytes > 4096;

  return {
    stderr: result.stderr,
    declarations,
    formatMismatch,
    overflow,
  };
}

function nodeFile(node: ClangAstNode): string | undefined {
  return node.loc?.file ?? node.range?.begin?.file;
}

function pruneToSourceFile(
  node: ClangAstNode,
  sourceFile: string,
  isRoot = false,
): ClangAstNode | undefined {
  const file = nodeFile(node);

  if (!isRoot && file !== undefined && file !== sourceFile) {
    return undefined;
  }

  const children: ClangAstNode[] = [];

  for (const child of node.inner ?? []) {
    const selected = pruneToSourceFile(child, sourceFile);
    if (selected) {
      children.push(selected);
    }
  }

  return { ...node, inner: children };
}

function convertAstNode(node: ClangAstNode, index: number): AstNode {
  const children = (node.inner ?? []).map((child, childIndex) =>
    convertAstNode(child, childIndex),
  );

  return {
    id: node.id ?? `${node.kind ?? "node"}-${index}`,
    kind: node.kind ?? "Unknown",
    ...(node.name && { name: node.name }),
    ...(node.type?.qualType && { type: node.type.qualType }),
    ...(node.value !== undefined && { value: String(node.value) }),
    ...(node.loc?.line && {
      location: {
        line: node.loc.line,
        column: node.loc.col ?? 1,
      },
    }),
    children,
  };
}

function countAstNodes(node: AstNode): number {
  let count = 1;

  for (const child of node.children) {
    count += countAstNodes(child);
  }

  return count;
}

const SYMBOL_KINDS: Record<string, SymbolEntry["kind"]> = {
  VarDecl: "variable",
  FunctionDecl: "function",
  ParmVarDecl: "parameter",
  FieldDecl: "field",
  TypedefDecl: "type",
  TypeAliasDecl: "type",
  RecordDecl: "class",
  CXXRecordDecl: "class",
  EnumDecl: "enum",
  EnumConstantDecl: "enumerator",
  NamespaceDecl: "namespace",
};

function extractSymbols(
  node: ClangAstNode,
  symbols: SymbolEntry[] = [],
  scope = "global",
): SymbolEntry[] {
  if (!node) return symbols;

  const kind = node.kind ?? "";

  let currentScope = scope;

  if (
    kind === "NamespaceDecl" ||
    kind === "FunctionDecl" ||
    kind === "CXXMethodDecl" ||
    kind === "CXXRecordDecl" ||
    kind === "RecordDecl"
  ) {
    if (node.name) {
      currentScope = `${scope}::${node.name}`;
    }
  }

  const symbolKind = SYMBOL_KINDS[kind];

  if (symbolKind && node.name) {
    const location = node.loc?.line
      ? {
          line: node.loc.line,
          column: node.loc.col ?? 1,
        }
      : undefined;

    symbols.push({
      name: node.name,
      kind: symbolKind,
      type: node.type?.qualType ?? "unknown",
      scope,
      ...(location && { location }),
    });
  }

  for (const child of node.inner ?? []) {
    extractSymbols(child, symbols, currentScope);
  }

  return symbols;
}

function createStage<T>(
  step: CompileStep,
  status: StageResult<T>["status"],
  data?: T,
  error?: string,
  durationMs?: number,
): StageResult<T> {
  return {
    step,
    status,
    ...(data !== undefined && { data }),
    ...(error && { error }),
    ...(durationMs !== undefined && { durationMs }),
  };
}

function syntaxArgs(sourceFile: string): string[] {
  return [
    "-std=" + CLANG_STD,
    "-fno-color-diagnostics",
    "-fsyntax-only",
    sourceFile,
  ];
}

class ClangCompilerService implements CompilerService {
  async compile(source: string, options: CompileOptions = {}): Promise<CompileResult> {
    const compilationId = options.id ?? randomUUID();
    const startTime = performance.now();

    const diagnostics: Diagnostic[] = [];
    const seenDiagnostics = new Set<string>();

    const addDiagnostics = (list: Diagnostic[]) => {
      for (const diagnostic of list) {
        const key = [
          diagnostic.severity,
          diagnostic.file ?? "",
          diagnostic.location?.line ?? 0,
          diagnostic.location?.column ?? 0,
          diagnostic.message,
        ].join(":");

        if (seenDiagnostics.has(key)) continue;
        if (diagnostics.length >= config.compile.maxDiagnostics) return;

        seenDiagnostics.add(key);
        diagnostics.push(diagnostic);
      }
    };

    const steps: CompileResult["steps"] = {};
    const projectId = options.projectId;

    const requestedSteps = new Set<CompileStep>(
      options.steps?.length ? options.steps : ALL_STEPS,
    );
    const activeSteps = ALL_STEPS.filter((step) => requestedSteps.has(step));
    const totalSteps = Math.max(activeSteps.length, 1);
    let completedSteps = 0;

    const emit = (
      step: CompileStep,
      status: StageResult<unknown>["status"],
      durationMs?: number,
    ) => {
      options.onStage?.({
        step,
        status,
        ...(durationMs !== undefined && { durationMs }),
        progress: completedSteps / totalSteps,
      });
    };

    let workDir: string | undefined;

    if (!source.trim()) {
      return {
        id: compilationId,
        projectId,
        status: "failed",
        steps: Object.fromEntries(
          ALL_STEPS.map((step) => [step, createStage(step, "skipped")]),
        ) as CompileResult["steps"],
        diagnostics: [
          {
            severity: "error",
            message: "Source code cannot be empty.",
          },
        ],
        totalDurationMs: performance.now() - startTime,
      };
    }

    try {
      workDir = await mkdtemp(path.join(os.tmpdir(), "codelens-"));

      const sourceFile = path.join(workDir, "main.cpp");

      await writeFile(sourceFile, source, "utf8");

      const dumpAst = async (): Promise<ClangAstNode> => {
        const dump = await dumpUserDeclarations(sourceFile, workDir as string);

        addDiagnostics(parseDiagnostics(dump.stderr));

        if (dump.overflow) {
          throw new Error("AST output is too large to visualize.");
        }

        if (dump.formatMismatch) {
          throw new Error("Unexpected clang AST dump format.");
        }

        return {
          id: "translation-unit",
          kind: "TranslationUnitDecl",
          inner: dump.declarations,
        };
      };

      let rawAst: ClangAstNode | undefined;

      // --------------------------------------------
      // STAGE 1: LEXICAL ANALYSIS
      // --------------------------------------------

      if (requestedSteps.has("lex")) {
        const stageStart = performance.now();
        emit("lex", "running");

        try {
          const result = await executeClang(
            [
              "-std=" + CLANG_STD,
              "-fno-color-diagnostics",
              "-fsyntax-only",
              "-Xclang",
              "-dump-tokens",
              sourceFile,
            ],
            workDir,
          );

          addDiagnostics(parseDiagnostics(result.stderr));

          const tokens = parseTokens(result.stderr, sourceFile);

          const data: LexResult = {
            tokens,
            tokenCount: tokens.length,
          };

          const durationMs = performance.now() - stageStart;
          steps.lex = createStage("lex", "success", data, undefined, durationMs);
          completedSteps += 1;
          emit("lex", "success", durationMs);
        } catch (error) {
          const durationMs = performance.now() - stageStart;
          steps.lex = createStage<LexResult>(
            "lex",
            "failed",
            undefined,
            error instanceof Error ? error.message : "Lexical analysis failed",
            durationMs,
          );
          completedSteps += 1;
          emit("lex", "failed", durationMs);
        }
      } else {
        steps.lex = createStage<LexResult>("lex", "skipped");
      }

      // --------------------------------------------
      // STAGE 2: SYNTAX ANALYSIS
      // --------------------------------------------

      if (requestedSteps.has("parse")) {
        const stageStart = performance.now();
        emit("parse", "running");

        try {
          rawAst = await dumpAst();

          const ast = convertAstNode(rawAst, 0);

          const data: ParseResult = {
            ast,
            nodeCount: countAstNodes(ast),
          };

          const durationMs = performance.now() - stageStart;
          steps.parse = createStage(
            "parse",
            "success",
            data,
            undefined,
            durationMs,
          );
          completedSteps += 1;
          emit("parse", "success", durationMs);
        } catch (error) {
          const durationMs = performance.now() - stageStart;
          steps.parse = createStage<ParseResult>(
            "parse",
            "failed",
            undefined,
            error instanceof Error ? error.message : "Syntax analysis failed",
            durationMs,
          );
          completedSteps += 1;
          emit("parse", "failed", durationMs);
        }
      } else {
        steps.parse = createStage<ParseResult>("parse", "skipped");
      }

      // --------------------------------------------
      // STAGE 3: SEMANTIC ANALYSIS
      // --------------------------------------------

      if (requestedSteps.has("semantic")) {
        const stageStart = performance.now();
        emit("semantic", "running");

        try {
          const result = await executeClang(syntaxArgs(sourceFile), workDir);

          addDiagnostics(parseDiagnostics(result.stderr));

          if (result.exitCode !== 0) {
            throw new Error(
              "Semantic analysis failed. Check compiler diagnostics.",
            );
          }

          if (!rawAst) {
            rawAst = await dumpAst();
          }

          const symbols = extractSymbols(rawAst);

          const data: SemanticResult = {
            symbols,
            symbolCount: symbols.length,
          };

          const durationMs = performance.now() - stageStart;
          steps.semantic = createStage(
            "semantic",
            "success",
            data,
            undefined,
            durationMs,
          );
          completedSteps += 1;
          emit("semantic", "success", durationMs);
        } catch (error) {
          const durationMs = performance.now() - stageStart;
          steps.semantic = createStage<SemanticResult>(
            "semantic",
            "failed",
            undefined,
            error instanceof Error ? error.message : "Semantic analysis failed",
            durationMs,
          );
          completedSteps += 1;
          emit("semantic", "failed", durationMs);
        }
      } else {
        steps.semantic = createStage<SemanticResult>("semantic", "skipped");
      }

      // --------------------------------------------
      // STAGE 4: CODE GENERATION
      // --------------------------------------------

      if (requestedSteps.has("codegen")) {
        const stageStart = performance.now();
        emit("codegen", "running");

        let llvmIr = "";
        let assembly = "";
        const errors: string[] = [];

        try {
          const result = await executeClang(
            [
              "-std=" + CLANG_STD,
              "-fno-color-diagnostics",
              "-S",
              "-emit-llvm",
              "-o",
              "-",
              sourceFile,
            ],
            workDir,
          );

          addDiagnostics(parseDiagnostics(result.stderr));

          if (result.exitCode !== 0) {
            throw new Error("LLVM IR generation failed");
          }

          llvmIr = result.stdout;
        } catch (error) {
          errors.push(
            error instanceof Error ? error.message : "LLVM IR generation failed",
          );
        }

        try {
          const result = await executeClang(
            ["-std=" + CLANG_STD, "-fno-color-diagnostics", "-S", "-o", "-", sourceFile],
            workDir,
          );

          addDiagnostics(parseDiagnostics(result.stderr));

          if (result.exitCode !== 0) {
            throw new Error("Assembly generation failed");
          }

          assembly = result.stdout;
        } catch (error) {
          errors.push(
            error instanceof Error
              ? error.message
              : "Assembly generation failed",
          );
        }

        const data: CodegenResult = {
          llvmIr,
          assembly,
        };

        const codegenSuccessful = llvmIr.length > 0 || assembly.length > 0;
        const durationMs = performance.now() - stageStart;

        steps.codegen = createStage(
          "codegen",
          codegenSuccessful ? "success" : "failed",
          data,
          errors.length > 0 ? errors.join("; ") : undefined,
          durationMs,
        );

        completedSteps += 1;
        emit("codegen", codegenSuccessful ? "success" : "failed", durationMs);
      } else {
        steps.codegen = createStage<CodegenResult>("codegen", "skipped");
      }
    } catch (error) {
      diagnostics.push({
        severity: "fatal",
        message:
          error instanceof Error
            ? error.message
            : "Unexpected compiler service error",
      });
    } finally {
      if (workDir) {
        try {
          await rm(workDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Failed to clean compiler workspace:", error);
        }
      }
    }

    const totalDurationMs = performance.now() - startTime;

    const hasErrors = diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" || diagnostic.severity === "fatal",
    );

    const stageFailed = Object.values(steps).some(
      (stage) => stage?.status === "failed",
    );

    const status = hasErrors || stageFailed ? "failed" : "success";

    return {
      id: compilationId,
      projectId,
      status,
      steps,
      diagnostics,
      totalDurationMs,
    };
  }
}

export const compilerService = new ClangCompilerService();
