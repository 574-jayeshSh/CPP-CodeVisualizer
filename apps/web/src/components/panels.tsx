import { useState } from "react";

import type { AstNode, CompileResult, Diagnostic, RunResult } from "@codelens/shared";

const TOKEN_LIMIT = 2000;
const SYMBOL_LIMIT = 2000;

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) {
    return <EmptyState>No diagnostics — the compiler has nothing to report.</EmptyState>;
  }

  return (
    <div className="diagnostics">
      {diagnostics.map((diagnostic, index) => (
        <div key={index} className={`diagnostic diagnostic-${diagnostic.severity}`}>
          <span className="diagnostic-severity">{diagnostic.severity}</span>
          <span className="diagnostic-message">{diagnostic.message}</span>
          {diagnostic.location && (
            <span className="diagnostic-location">
              {diagnostic.file ?? "main.cpp"}:{diagnostic.location.line}:
              {diagnostic.location.column}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function TokensPanel({ result }: { result: CompileResult }) {
  const tokens = result.steps.lex?.data?.tokens ?? [];
  const shown = tokens.slice(0, TOKEN_LIMIT);

  if (tokens.length === 0) {
    return <EmptyState>No tokens were produced. Check the lexical analysis stage.</EmptyState>;
  }

  return (
    <>
      <div className="panel-note">
        {tokens.length} tokens
        {tokens.length > shown.length ? ` · showing first ${shown.length}` : ""}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Kind</th>
              <th>Value</th>
              <th>Line</th>
              <th>Col</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((token, index) => (
              <tr key={index}>
                <td className="num">{index + 1}</td>
                <td className="token-kind">{token.kind}</td>
                <td className="token-value">{token.value}</td>
                <td className="num">{token.location.line}</td>
                <td className="num">{token.location.column}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AstTreeNode({ node, depth }: { node: AstNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div className="ast-branch">
      <div className="ast-row" style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          className="ast-toggle"
          disabled={!hasChildren}
          onClick={() => setOpen((value) => !value)}
          aria-label={hasChildren ? (open ? "Collapse" : "Expand") : "Leaf"}
        >
          {hasChildren ? (open ? "▾" : "▸") : "·"}
        </button>
        <span className="ast-kind">{node.kind}</span>
        {node.name && <span className="ast-name">{node.name}</span>}
        {node.type && <span className="ast-type">{node.type}</span>}
        {node.value !== undefined && <span className="ast-value">= {node.value}</span>}
        {node.location && (
          <span className="ast-location">
            L{node.location.line}:{node.location.column}
          </span>
        )}
      </div>
      {open && node.children.map((child) => (
        <AstTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function AstPanel({ result }: { result: CompileResult }) {
  const ast = result.steps.parse?.data?.ast;
  const nodeCount = result.steps.parse?.data?.nodeCount ?? 0;

  if (!ast) {
    return <EmptyState>No AST was produced. Check the syntax analysis stage.</EmptyState>;
  }

  return (
    <>
      <div className="panel-note">{nodeCount} nodes · click ▸/▾ to expand</div>
      <div className="ast-tree">
        <AstTreeNode node={ast} depth={0} />
      </div>
    </>
  );
}

export function SymbolsPanel({ result }: { result: CompileResult }) {
  const symbols = result.steps.semantic?.data?.symbols ?? [];
  const shown = symbols.slice(0, SYMBOL_LIMIT);

  if (symbols.length === 0) {
    return <EmptyState>No symbols were extracted. Check the semantic analysis stage.</EmptyState>;
  }

  return (
    <>
      <div className="panel-note">
        {symbols.length} symbols
        {symbols.length > shown.length ? ` · showing first ${shown.length}` : ""}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Line</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((symbol, index) => (
              <tr key={index}>
                <td className="symbol-name">{symbol.name}</td>
                <td>
                  <span className={`badge badge-${symbol.kind}`}>{symbol.kind}</span>
                </td>
                <td className="symbol-type">{symbol.type}</td>
                <td className="symbol-scope">{symbol.scope}</td>
                <td className="num">{symbol.location?.line ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CodePanel({ title, code, status }: { title: string; code: string; status?: string }) {
  if (!code.trim()) {
    return <EmptyState>{title} was not generated{status ? ` (${status})` : ""}.</EmptyState>;
  }

  return (
    <pre className="code-block">{code}</pre>
  );
}

export function OutputPanel({ result, error }: { result: RunResult | null; error: string | null }) {
  if (error) {
    return <EmptyState>{error}</EmptyState>;
  }

  if (!result) {
    return <EmptyState>Run your program to see its output.</EmptyState>;
  }

  return (
    <div className="output">
      <div className="output-meta">
        <span className={`badge ${result.timedOut ? "badge-error" : result.exitCode === 0 ? "badge-ok" : "badge-warn"}`}>
          {result.timedOut ? "timed out" : `exit ${result.exitCode ?? "?"}`}
        </span>
        <span className="output-duration">{Math.round(result.durationMs)}ms</span>
      </div>
      {result.stdout && (
        <section className="output-section">
          <h4>stdout</h4>
          <pre className="code-block">{result.stdout}</pre>
        </section>
      )}
      {result.stderr && (
        <section className="output-section">
          <h4>stderr</h4>
          <pre className="code-block code-block-error">{result.stderr}</pre>
        </section>
      )}
      {!result.stdout && !result.stderr && (
        <div className="empty-state">The program produced no output.</div>
      )}
    </div>
  );
}
