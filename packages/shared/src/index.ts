export type Language = "cpp";

export type CompileStep = "lex" | "parse" | "semantic" | "codegen";

export const COMPILE_STEPS: CompileStep[] = ["lex", "parse", "semantic", "codegen"];

export const STEP_LABELS: Record<CompileStep, string> = {
  lex: "Lexical analysis",
  parse: "Syntax analysis",
  semantic: "Semantic analysis",
  codegen: "Code generation",
};

export interface SourceLocation {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface Token {
  kind: string;
  value: string;
  location: SourceLocation;
}

export interface AstNode {
  id: string;
  kind: string;
  name?: string;
  type?: string;
  value?: string;
  location?: SourceLocation;
  children: AstNode[];
}

export type SymbolKind =
  | "variable"
  | "function"
  | "parameter"
  | "field"
  | "type"
  | "class"
  | "enum"
  | "enumerator"
  | "namespace"
  | "using";

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  type: string;
  scope: string;
  location?: SourceLocation;
}

export type DiagnosticSeverity = "fatal" | "error" | "warning" | "note";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  location?: SourceLocation;
  option?: string;
  replacement?: string;
}

export interface StageResult<T> {
  step: CompileStep;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  durationMs?: number;
  data?: T;
  error?: string;
}

export interface LexResult {
  tokens: Token[];
  tokenCount: number;
}

export interface ParseResult {
  ast: AstNode;
  nodeCount: number;
}

export interface SemanticResult {
  symbols: SymbolEntry[];
  symbolCount: number;
}

export interface CodegenResult {
  assembly: string;
  llvmIr: string;
}

export interface CompileResult {
  id: string;
  projectId?: string;
  status: "success" | "failed";
  steps: {
    lex?: StageResult<LexResult>;
    parse?: StageResult<ParseResult>;
    semantic?: StageResult<SemanticResult>;
    codegen?: StageResult<CodegenResult>;
  };
  diagnostics: Diagnostic[];
  totalDurationMs: number;
}

export interface CompileRequest {
  source: string;
  projectId?: string;
  language?: Language;
  steps?: CompileStep[];
}

export interface RunRequest {
  source: string;
  stdin?: string;
  timeLimitMs?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  language: Language;
  sourceCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompilationSummary {
  id: string;
  projectId: string;
  status: "success" | "failed";
  errorCount: number;
  warningCount: number;
  totalDurationMs: number;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

export interface ApiError {
  message: string;
  details?: unknown;
}

export interface CompileStartEvent {
  requestId: string;
  compilationId: string;
  projectId?: string;
  steps: CompileStep[];
}

export interface CompileStepEvent {
  requestId: string;
  compilationId: string;
  step: CompileStep;
  status: StageResult<unknown>["status"];
  durationMs?: number;
  progress: number;
}

export interface CompileDoneEvent {
  requestId: string;
  compilationId: string;
  result: CompileResult;
}

export interface CompileErrorEvent {
  requestId: string;
  compilationId: string;
  message: string;
}

export interface CompileRequestEvent {
  requestId: string;
  source: string;
  projectId?: string;
  steps?: CompileStep[];
}

export type SocketEvents = {
  "compile:start": (event: CompileStartEvent) => void;
  "compile:step": (event: CompileStepEvent) => void;
  "compile:done": (event: CompileDoneEvent) => void;
  "compile:error": (event: CompileErrorEvent) => void;
};

export type ClientSocketEvents = {
  "compile:request": (event: CompileRequestEvent) => void;
};
