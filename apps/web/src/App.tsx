import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import type {
  AuthResponse,
  CompileResult,
  CompileStep,
  ProjectDto,
  RunResult,
  UserDto,
} from "@codelens/shared";
import { COMPILE_STEPS } from "@codelens/shared";

import { api, ApiRequestError, getToken, setToken } from "./api";
import { getSocket, syncSocketAuth } from "./socket";
import { DEFAULT_SOURCE } from "./samples";
import { Editor } from "./components/Editor";
import { StagePipeline, type LiveStage } from "./components/StagePipeline";
import { AuthPanel } from "./components/Auth";
import { ProjectsPanel } from "./components/Projects";
import {
  AstPanel,
  CodePanel,
  DiagnosticsPanel,
  OutputPanel,
  SymbolsPanel,
  TokensPanel,
} from "./components/panels";

type TabKey = "diagnostics" | "tokens" | "ast" | "symbols" | "ir" | "asm" | "output";

interface TabDescriptor {
  key: TabKey;
  label: string;
  badge?: number | string | null;
}

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function App() {
  const location = useLocation();
  const initialSource = (location.state as { source?: string } | null)?.source;

  const [source, setSource] = useState(initialSource || DEFAULT_SOURCE);
  const [stdin, setStdin] = useState("");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [liveStages, setLiveStages] = useState<Partial<Record<CompileStep, LiveStage>>>({});
  const [progress, setProgress] = useState(0);
  const [compiling, setCompiling] = useState(false);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<TabKey>("diagnostics");

  const [user, setUser] = useState<UserDto | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeRequestRef = useRef<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ---------------------------------------------------------------
  // Socket listeners
  // ---------------------------------------------------------------

  useEffect(() => {
    const socket = getSocket();

    const matchesActive = (requestId: string) => activeRequestRef.current === requestId;

    const handleStart = (event: {
      requestId: string;
      steps: CompileStep[];
    }) => {
      if (!matchesActive(event.requestId)) return;

      const initial: Partial<Record<CompileStep, LiveStage>> = {};
      for (const step of COMPILE_STEPS) {
        initial[step] = { status: event.steps.includes(step) ? "pending" : "skipped" };
      }
      setLiveStages(initial);
      setProgress(0);
      setResult(null);
    };

    const handleStep = (event: {
      requestId: string;
      step: CompileStep;
      status: LiveStage["status"];
      durationMs?: number;
      progress: number;
    }) => {
      if (!matchesActive(event.requestId)) return;

      setLiveStages((previous) => ({
        ...previous,
        [event.step]: {
          status: event.status,
          ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
        },
      }));
      setProgress(event.progress);
    };

    const handleDone = (event: { requestId: string; result: CompileResult }) => {
      if (!matchesActive(event.requestId)) return;

      setResult(event.result);
      setProgress(1);
      setCompiling(false);
      activeRequestRef.current = null;

      if (event.result.status === "failed" && event.result.diagnostics.length > 0) {
        setTab("diagnostics");
      }
    };

    const handleError = (event: { requestId: string; message: string }) => {
      if (!matchesActive(event.requestId)) return;

      setCompiling(false);
      activeRequestRef.current = null;
      showNotice(event.message);
    };

    socket.on("compile:start", handleStart);
    socket.on("compile:step", handleStep);
    socket.on("compile:done", handleDone);
    socket.on("compile:error", handleError);

    return () => {
      socket.off("compile:start", handleStart);
      socket.off("compile:step", handleStep);
      socket.off("compile:done", handleDone);
      socket.off("compile:error", handleError);
    };
  }, [showNotice]);

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------

  const compile = useCallback(() => {
    if (compiling) return;
    if (!source.trim()) {
      showNotice("Source code cannot be empty.");
      return;
    }

    const requestId = makeRequestId();
    activeRequestRef.current = requestId;
    setCompiling(true);
    setResult(null);
    setRunResult(null);
    setRunError(null);

    getSocket().emit("compile:request", {
      requestId,
      source,
      ...(activeProjectId && { projectId: activeProjectId }),
    });
  }, [compiling, source, activeProjectId, showNotice]);

  const run = useCallback(async () => {
    if (running) return;

    setRunning(true);
    setRunError(null);

    try {
      const response = await api.run({ source, stdin });
      setRunResult(response);
      setTab("output");
    } catch (caught) {
      setRunResult(null);
      setRunError(caught instanceof Error ? caught.message : "Failed to run program.");
      setTab("output");
    } finally {
      setRunning(false);
    }
  }, [running, source, stdin]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          void run();
        } else {
          compile();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compile, run]);

  // ---------------------------------------------------------------
  // Auth + projects
  // ---------------------------------------------------------------

  const loadProjects = useCallback(async () => {
    if (!getToken()) {
      setProjects([]);
      return;
    }

    try {
      setProjects(await api.listProjects());
    } catch {
      // token may be stale; /me check handles that separately
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;

    api
      .me()
      .then((profile) => setUser(profile))
      .catch(() => setToken(null))
      .finally(() => void loadProjects());
  }, [loadProjects]);

  const handleAuthed = useCallback(
    (response: AuthResponse) => {
      setToken(response.token);
      setUser(response.user);
      syncSocketAuth();
      void loadProjects();
      showNotice(`Signed in as ${response.user.name}`);
    },
    [loadProjects, showNotice],
  );

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    setProjects([]);
    setActiveProjectId(null);
    setDirty(false);
    syncSocketAuth();
    showNotice("Signed out.");
  }, [showNotice]);

  const handleCreateProject = useCallback(
    async (name: string) => {
      try {
        const project = await api.createProject({ name, sourceCode: source });
        setProjects((previous) => [project, ...previous]);
        setActiveProjectId(project.id);
        setDirty(false);
        showNotice(`Project "${project.name}" created.`);
      } catch (caught) {
        showNotice(caught instanceof ApiRequestError ? caught.message : "Failed to create project.");
        throw caught;
      }
    },
    [source, showNotice],
  );

  const handleSelectProject = useCallback(
    async (project: ProjectDto) => {
      if (dirty && activeProjectId && activeProjectId !== project.id) {
        if (!window.confirm("Discard unsaved changes?")) return;
      }

      try {
        const fresh = await api.getProject(project.id);
        setSource(fresh.sourceCode);
        setActiveProjectId(fresh.id);
        setDirty(false);
        setResult(null);
        showNotice(`Loaded "${fresh.name}".`);
      } catch (caught) {
        showNotice(caught instanceof ApiRequestError ? caught.message : "Failed to load project.");
      }
    },
    [dirty, activeProjectId, showNotice],
  );

  const handleDeleteProject = useCallback(
    async (project: ProjectDto) => {
      if (!window.confirm(`Delete "${project.name}"?`)) return;

      try {
        await api.deleteProject(project.id);
        setProjects((previous) => previous.filter((item) => item.id !== project.id));

        if (activeProjectId === project.id) {
          setActiveProjectId(null);
          setDirty(false);
        }

        showNotice(`Deleted "${project.name}".`);
      } catch (caught) {
        showNotice(caught instanceof ApiRequestError ? caught.message : "Failed to delete project.");
      }
    },
    [activeProjectId, showNotice],
  );

  const handleSaveProject = useCallback(async () => {
    if (!activeProjectId) return;

    try {
      const updated = await api.updateProject(activeProjectId, { sourceCode: source });
      setProjects((previous) =>
        previous.map((project) => (project.id === updated.id ? updated : project)),
      );
      setDirty(false);
      showNotice("Project saved.");
    } catch (caught) {
      showNotice(caught instanceof ApiRequestError ? caught.message : "Failed to save project.");
    }
  }, [activeProjectId, source, showNotice]);

  const handleSourceChange = useCallback((value: string) => {
    setSource(value);
    setDirty(true);
  }, []);

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------

  const tabs: TabDescriptor[] = useMemo(
    () => [
      {
        key: "diagnostics",
        label: "Diagnostics",
        badge: result ? result.diagnostics.length : null,
      },
      {
        key: "tokens",
        label: "Tokens",
        badge: result?.steps.lex?.data?.tokenCount ?? null,
      },
      {
        key: "ast",
        label: "AST",
        badge: result?.steps.parse?.data?.nodeCount ?? null,
      },
      {
        key: "symbols",
        label: "Symbols",
        badge: result?.steps.semantic?.data?.symbolCount ?? null,
      },
      { key: "ir", label: "LLVM IR" },
      { key: "asm", label: "Assembly" },
      { key: "output", label: "Output", badge: runResult ? "ran" : null },
    ],
    [result, runResult],
  );

  const renderPanel = (): ReactNode => {
    if (tab === "output") {
      return <OutputPanel result={runResult} error={runError} />;
    }

    if (!result) {
      return (
        <div className="empty-state">
          Compile your code to populate this view.
          <span className="empty-hint">Ctrl+Enter compiles · Ctrl+Shift+Enter runs</span>
        </div>
      );
    }

    switch (tab) {
      case "diagnostics":
        return <DiagnosticsPanel diagnostics={result.diagnostics} />;
      case "tokens":
        return <TokensPanel result={result} />;
      case "ast":
        return <AstPanel result={result} />;
      case "symbols":
        return <SymbolsPanel result={result} />;
      case "ir":
        return (
          <CodePanel title="LLVM IR" code={result.steps.codegen?.data?.llvmIr ?? ""} status={result.steps.codegen?.status} />
        );
      case "asm":
        return (
          <CodePanel title="Assembly" code={result.steps.codegen?.data?.assembly ?? ""} status={result.steps.codegen?.status} />
        );
      default:
        return null;
    }
  };

  const errorCount = result
    ? result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "fatal",
      ).length
    : 0;
  const warningCount = result
    ? result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length
    : 0;

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" title="Back to home">
          <span className="brand-mark">{"</>"}</span>
          <span className="brand-name">CodeLens</span>
          <span className="brand-sub">C++ compilation visualizer</span>
        </Link>

        <div className="topbar-center">
          {compiling ? (
            <span className="status status-busy">Compiling… {Math.round(progress * 100)}%</span>
          ) : result ? (
            <span className={`status ${result.status === "success" ? "status-ok" : "status-failed"}`}>
              {result.status === "success" ? "Compiled" : "Failed"}
              {errorCount > 0 && ` · ${errorCount} error${errorCount === 1 ? "" : "s"}`}
              {warningCount > 0 && ` · ${warningCount} warning${warningCount === 1 ? "" : "s"}`}
              {` · ${Math.round(result.totalDurationMs)}ms`}
            </span>
          ) : notice ? (
            <span className="status status-notice">{notice}</span>
          ) : null}
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void run()}
            disabled={running}
          >
            {running ? "Running…" : "Run ▶"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={compile}
            disabled={compiling}
          >
            {compiling ? "Compiling…" : "Compile ⌘↵"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <ProjectsPanel
            user={user}
            projects={projects}
            activeProjectId={activeProjectId}
            dirty={dirty}
            onSelect={(project) => void handleSelectProject(project)}
            onCreate={handleCreateProject}
            onDelete={(project) => void handleDeleteProject(project)}
            onSave={() => void handleSaveProject()}
          />

          <div className="sidebar-divider" />

          <AuthPanel
            user={user}
            onAuthed={handleAuthed}
            onLogout={handleLogout}
          />
        </aside>

        <main className="editor-pane">
          <div className="pane-header">
            <span className="pane-title">main.cpp</span>
            {activeProject && <span className="pane-subtitle">{activeProject.name}{dirty ? " •" : ""}</span>}
          </div>

          <Editor value={source} onChange={handleSourceChange} />

          <div className="stdin-pane">
            <div className="pane-header">
              <span className="pane-title">stdin</span>
              <span className="pane-subtitle">fed to your program when you run</span>
            </div>
            <textarea
              className="stdin-input"
              value={stdin}
              placeholder="optional standard input…"
              onChange={(event) => setStdin(event.target.value)}
            />
          </div>
        </main>

        <section className="results-pane">
          <StagePipeline
            result={result}
            live={liveStages}
            progress={progress}
            compiling={compiling}
          />

          <nav className="tabs" aria-label="Compilation views">
            {tabs.map((descriptor) => (
              <button
                key={descriptor.key}
                type="button"
                className={`tab${tab === descriptor.key ? " is-active" : ""}`}
                onClick={() => setTab(descriptor.key)}
              >
                {descriptor.label}
                {descriptor.badge !== null && descriptor.badge !== undefined && (
                  <span className="tab-badge">{descriptor.badge}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="panel">{renderPanel()}</div>
        </section>
      </div>
    </div>
  );
}

export { App };
