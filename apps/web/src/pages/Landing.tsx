import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { IntroLoader } from "../components/IntroLoader";
import { useReveal } from "../hooks/useReveal";

const STAGES = [
  {
    num: "01",
    name: "Lexical",
    description: "Break the source into tokens — keywords, identifiers, literals, operators.",
    command: "-dump-tokens",
  },
  {
    num: "02",
    name: "Parse",
    description: "Shape those tokens into an abstract syntax tree, pruned to your file.",
    command: "-ast-dump",
  },
  {
    num: "03",
    name: "Semantic",
    description: "Resolve names and types; collect every symbol and its scope.",
    command: "sema",
  },
  {
    num: "04",
    name: "Codegen",
    description: "Lower the tree to LLVM IR, then to x86-64 assembly.",
    command: "-S -emit-llvm",
  },
  {
    num: "05",
    name: "Run",
    description: "Execute in a sandbox with your stdin and watch the output.",
    command: "./a.out",
  },
] as const;

const MARQUEE_WORDS = [
  "TOKENS",
  "AST",
  "SYMBOLS",
  "DIAGNOSTICS",
  "LLVM IR",
  "ASSEMBLY",
  "CLANG 18",
  "C++17",
] as const;

interface CardSpec {
  num: string;
  title: string;
  description: string;
  large?: boolean;
}

const CARDS: CardSpec[] = [
  {
    num: "01",
    title: "Token stream",
    description:
      "Every lexeme with its kind, value and exact source location — straight from clang's lexer, no guessing.",
    large: true,
  },
  {
    num: "02",
    title: "AST explorer",
    description: "Expand the syntax tree node by node, pruned to declarations in your file.",
  },
  {
    num: "03",
    title: "Symbol table",
    description: "Functions, classes, variables and scopes the semantic pass collected.",
  },
  {
    num: "04",
    title: "Diagnostics",
    description: "Errors, warnings and notes with file, line and column as clang reports them.",
  },
  {
    num: "05",
    title: "LLVM IR",
    description: "The mid-level IR your code lowers to, before any machine decisions.",
  },
  {
    num: "06",
    title: "Assembly",
    description: "Final x86-64 assembly, ready to compare against the IR above it.",
  },
];

function Word({ children, index }: { children: string; index: number }) {
  return (
    <span className="lp-word" style={{ "--i": index } as CSSProperties}>
      {children}
    </span>
  );
}

interface StatSpec {
  value: number;
  suffix?: string;
  label: string;
}

// Every number here is measured — see lp-stats-note for methodology.
const STATS: StatSpec[] = [
  { value: 130, suffix: "ms", label: "Median hello-world compile" },
  { value: 479, suffix: "ms", label: "Median run round-trip" },
  { value: 5, label: "Stages streamed live" },
  { value: 7, label: "Inspection views" },
  { value: 83, suffix: "KB", label: "Gzipped JS bundle" },
];

function Stat({ value, suffix, label }: StatSpec) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }

    let frame = 0;
    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || cancelled) return;
        observer.disconnect();

        const start = performance.now();
        const duration = 1400;

        const tick = (now: number) => {
          if (cancelled) return;
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setDisplay(Math.round(value * eased));
          if (t < 1) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );

    observer.observe(element);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value]);

  return (
    <div className="lp-stat" ref={ref}>
      <span className="lp-stat-value">
        {display.toLocaleString("en-US")}
        {suffix && <span className="lp-stat-suffix">{suffix}</span>}
      </span>
      <span className="lp-stat-label">{label}</span>
    </div>
  );
}

function Landing() {
  useReveal();
  const navigate = useNavigate();

  const handleComposer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft = String(data.get("draft") ?? "").trim();
    navigate("/compiler", draft ? { state: { source: draft } } : undefined);
  };

  return (
    <div className="landing">
      <IntroLoader />

      {/* ---------------------------------------------------------- nav */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">{"</>"}</span>
            <span className="brand-name">CodeLens</span>
          </Link>

          <nav className="lp-nav-links">
            <a href="#stats" className="lp-link">
              Bench
            </a>
            <a href="#pipeline" className="lp-link">
              How it works
            </a>
            <a href="#features" className="lp-link">
              Features
            </a>
            <a href="#views" className="lp-link">
              Views
            </a>
          </nav>

          <div className="lp-nav-actions">
            <Link to="/login" className="btn btn-ghost">
              Sign in
            </Link>
            <Link to="/compiler" className="btn btn-primary btn-sm">
              Open compiler
            </Link>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------- hero */}
      <section className="lp-hero">
        <span className="lp-pill" style={{ "--i": 0 } as CSSProperties}>
          <span className="lp-pill-dot" />
          C++ compilation, visualized
        </span>

        <h1 className="lp-hero-title">
          <span className="lp-hero-line">
            <Word index={0}>From</Word> <Word index={1}>source,</Word>
          </span>
          <span className="lp-hero-line lp-gradient">
            <Word index={2}>to</Word> <Word index={3}>assembly.</Word>
          </span>
        </h1>

        <p className="lp-hero-desc" style={{ "--i": 4 } as CSSProperties}>
          CodeLens compiles your C++ one stage at a time — tokens, AST, symbols, LLVM IR and
          machine code — in a single live workspace powered by clang.
        </p>

        <form className="lp-composer" style={{ "--i": 5 } as CSSProperties} onSubmit={handleComposer}>
          <div className="lp-composer-shell">
            <input
              className="lp-composer-input"
              name="draft"
              placeholder="int main() { return 0; }  — or write it in the editor…"
              aria-label="Draft C++ code"
            />
            <button className="lp-send" type="submit" aria-label="Open the compiler">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </form>

        <p className="lp-hero-hint" style={{ "--i": 6 } as CSSProperties}>
          No signup needed · Ctrl+Enter compiles · Ctrl+Shift+Enter runs
        </p>
      </section>

      {/* ------------------------------------------------------ marquee */}
      <section className="lp-marquee" aria-hidden="true">
        <div className="lp-marquee-track">
          {[0, 1].map((copy) => (
            <div className="lp-marquee-group" key={copy}>
              {MARQUEE_WORDS.map((word) => (
                <span className="lp-marquee-item" key={`${copy}-${word}`}>
                  {word}
                  <span className="lp-marquee-star">✳</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- stats */}
      <section className="lp-section lp-stats" id="stats">
        <span className="lp-eyebrow" data-reveal>
          Measured, not promised
        </span>
        <h2 className="lp-title" data-reveal>
          Numbers from the <span className="lp-gradient">bench.</span>
        </h2>

        <div className="lp-stats-grid" data-reveal>
          {STATS.map((stat) => (
            <Stat key={stat.label} {...stat} />
          ))}
        </div>

        <p className="lp-stats-note" data-reveal>
          Medians of 3 timed runs after a warm-up · clang 18 · C++17 · localhost, Nov 2026
        </p>
      </section>

      {/* ------------------------------------------------------ pipeline */}
      <section className="lp-section" id="pipeline">
        <span className="lp-eyebrow" data-reveal>
          The story so far
        </span>
        <h2 className="lp-title" data-reveal>
          Five stages, <span className="lp-gradient">one keystroke.</span>
        </h2>
        <p className="lp-section-desc" data-reveal>
          Every compile runs the real clang pipeline and streams each stage back as it finishes —
          watch the work happen instead of staring at a spinner.
        </p>

        <div className="lp-rows" data-reveal>
          {STAGES.map((stage) => (
            <div className="lp-row" key={stage.num}>
              <span className="lp-row-num">{stage.num}</span>
              <div className="lp-row-body">
                <strong className="lp-row-name">{stage.name}</strong>
                <p className="lp-row-desc">{stage.description}</p>
              </div>
              <code className="lp-row-cmd">{stage.command}</code>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ features */}
      <section className="lp-section" id="features">
        <span className="lp-eyebrow" data-reveal>
          Keep exploring
        </span>
        <h2 className="lp-title" data-reveal>
          Views into the <span className="lp-gradient">compiler.</span>
        </h2>

        <div className="lp-grid">
          {CARDS.map((card, index) => (
            <article
              key={card.num}
              className={`lp-card${card.large ? " lp-card-lg" : ""}`}
              data-reveal
              style={{ "--delay": `${(index % 3) * 0.08}s` } as CSSProperties}
            >
              <span className="lp-card-inner" aria-hidden="true" />
              <span className="lp-card-num">{card.num}</span>
              <h3 className="lp-card-title">{card.title}</h3>
              <p className="lp-card-desc">{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- dark CTA */}
      <section className="lp-dark" id="views" data-reveal>
        <span className="lp-dark-badge">
          <span className="lp-pill-dot lp-pill-dot-light" />
          Live · clang 18 · sandboxed
        </span>
        <h2 className="lp-dark-title">
          Compile once.
          <br />
          Inspect <span className="lp-gradient">everything.</span>
        </h2>
        <p className="lp-dark-desc">
          One keystroke fills seven views — diagnostics, tokens, AST, symbols, LLVM IR, assembly
          and the program's actual output.
        </p>
        <Link to="/compiler" className="lp-glow-cta">
          Open the compiler
          <span className="lp-glow-arrow">→</span>
        </Link>
        <div className="lp-chips">
          {["tokens", "ast", "symbols", "ir", "asm", "output"].map((chip) => (
            <span className="lp-chip" key={chip}>
              {chip}
            </span>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- closing CTA */}
      <section className="lp-section lp-closing">
        <h2 className="lp-title" data-reveal>
          Ready when <span className="lp-gradient">you are.</span>
        </h2>
        <p className="lp-section-desc" data-reveal>
          Open the workspace, paste a snippet, and see what your code turns into.
        </p>
        <div className="lp-closing-actions" data-reveal>
          <Link to="/compiler" className="btn btn-primary">
            Start compiling
          </Link>
          <Link to="/login" className="btn btn-secondary">
            Create an account
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-footer-mark">{"</>"}</span>
            <div>
              <div className="lp-footer-name">CodeLens</div>
              <p className="lp-footer-tag">From source, to assembly.</p>
            </div>
          </div>

          <div className="lp-footer-cols">
            <div className="lp-footer-col">
              <span className="lp-footer-head">Product</span>
              <Link to="/compiler" className="lp-footer-link">
                Compiler
              </Link>
              <Link to="/login" className="lp-footer-link">
                Sign in
              </Link>
            </div>
            <div className="lp-footer-col">
              <span className="lp-footer-head">Stages</span>
              <a href="#pipeline" className="lp-footer-link">
                Lex · Parse
              </a>
              <a href="#pipeline" className="lp-footer-link">
                Sema · Codegen
              </a>
            </div>
            <div className="lp-footer-col">
              <span className="lp-footer-head">Views</span>
              <a href="#features" className="lp-footer-link">
                Tokens · AST
              </a>
              <a href="#views" className="lp-footer-link">
                IR · Assembly
              </a>
            </div>
          </div>
        </div>
        <div className="lp-footer-base">
          <span>© 2026 CodeLens</span>
          <span className="lp-footer-base-mono">clang · LLVM · C++17</span>
        </div>
      </footer>
    </div>
  );
}

export { Landing };
