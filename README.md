# CodeLens — C++ Compilation Visualizer

**From source, to assembly.** CodeLens compiles C++ one stage at a time and streams every layer the compiler builds to your browser — diagnostics, tokens, AST, symbols, LLVM IR, machine assembly and the program's actual output — powered by real **clang**, not a toy interpreter.

```
source ──▶ lex ──▶ parse ──▶ semantic ──▶ codegen ──▶ run
            │         │           │            │         │
            ▼         ▼           ▼            ▼         ▼
         tokens      AST      symbols      IR · asm    stdout
```

## Features

- **Live 5-stage pipeline** — lex → parse → semantic → codegen → run, streamed over Socket.IO with per-stage status and timing as each stage finishes
- **7 inspection views** — diagnostics, token stream, AST explorer, symbol table, LLVM IR, x86-64 assembly, program output
- **Real toolchain** — clang 18 with `-dump-tokens`, `-ast-dump=json`, `-S -emit-llvm`; no reimplementation of C++
- **Sandboxed execution** — bash wrapper with `ulimit -v` memory caps, wall-clock timeouts and output truncation; stdin supported
- **Auth & projects** — JWT auth, save/load/delete projects (Prisma + PostgreSQL)
- **Memory-bounded AST extraction** — a streaming line-state machine handles clang JSON dumps of 129 MB+ without loading them into memory
- **Warm, animated UI** — nomu-inspired design: intro loader, scroll reveals, count-up benchmark stats, Inter type, pill components

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite 6 · TypeScript · socket.io-client |
| Backend | Express · Socket.IO · TypeScript (NodeNext) |
| Database | PostgreSQL · Prisma ORM |
| Compiler | clang++ 18 (`-fsyntax-only` stages + codegen) |
| Monorepo | pnpm workspaces + project references |
| Auth | JWT (jsonwebtoken) · bcrypt |

## Architecture

```
CodeVisualizer/
├── apps/
│   ├── api/                 # Express + Socket.IO server (port 4000)
│   │   ├── prisma/          # schema, migrations, seed
│   │   └── src/
│   │       ├── routes/      # auth · projects · compile · run
│   │       ├── services/    # compiler · run · compilation store
│   │       ├── socket.ts    # compile:request → step events
│   │       └── index.ts
│   └── web/                 # React SPA (port 5173, proxies /api + /socket.io)
│       └── src/
│           ├── pages/       # Landing · Login
│           ├── components/  # Editor · panels · IntroLoader · Auth · Projects
│           └── hooks/
├── packages/shared/         # shared types + socket event contracts
└── benchmarks/              # reproducible benchmark suite (pnpm bench)
```

## Quick start

### Prerequisites

- **Node ≥ 20** and **pnpm 11** (`corepack enable`)
- **clang++ 18** (`clang++ --version`)
- **PostgreSQL** running locally

### Setup

```bash
pnpm install

# configure the API
cat > apps/api/.env <<'EOF'
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/codelens
JWT_SECRET=change-me-in-prod
EOF

# create the database schema + demo data
createdb codelens            # or via psql/pgAdmin
pnpm db:generate             # prisma client
pnpm db:push                 # create tables
pnpm db:seed                 # demo user + sample project

# run both apps (API :4000, web :5173)
pnpm dev
```

Open **http://localhost:5173** and sign in with the seeded account:

| | |
|---|---|
| Email | `demo@codelens.dev` |
| Password | `demo1234` |

Guests can compile and run immediately — signing in only unlocks saved projects.

### Usage

| Action | How |
|---|---|
| Compile | **Ctrl+Enter** (⌘↵) or the orange **Compile** button |
| Run | **Ctrl+Shift+Enter** or **Run ▶** |
| Feed stdin | the `stdin` pane below the editor |
| Draft → editor | type in the landing composer, hit the arrow |

## Benchmarks

Measured with the bundled suite against a live API on localhost (clang 18, C++17, Nov 2026). **Methodology:** one untimed warm-up per scenario, then 3 timed runs; values are **medians**.

```bash
pnpm dev:api      # terminal 1 — API must be running
pnpm bench        # terminal 2 — try --runs 10, --json, --base <url>
```

Latest run:

```
compile scenario    total     min       lex      parse    semantic  codegen   tokens  nodes  symbols
────────────────────────────────────────────────────────────────────────────────────────────────────
hello-world         130 ms    129 ms    25 ms    25 ms    25 ms     53 ms     10      5      1
iostream-hello      6281 ms   6173 ms   3850 ms  1330 ms  358 ms    741 ms    20      16     1
typical             7147 ms   6951 ms   4417 ms  1472 ms  401 ms    850 ms    126     126    19

run  run/iostream+stdin    median 479 ms wall · 475 ms reported · stdout verified
```

| Headline number | Value |
|---|---|
| Hello-world compile (end-to-end) | **130 ms** median |
| Run round-trip (compile-free execution) | **479 ms** median, stdout verified |
| Typical program (3 headers, class, namespace, vector) | **7.1 s** — dominated by clang lexing the standard library (~4.4 s of header tokens) |
| Client bundle | **82.8 KB** gzipped JS + 7.8 KB CSS (`pnpm build`) |
| Source | **~6.7 K lines** of TypeScript/CSS across 30 files |

> Include-heavy timings are honest: lexing `<iostream>`/`<string>`/`<vector>` token-by-token is the bottleneck, exactly as it would be in a real clang invocation — the UI streams each stage as it completes so you watch that cost happen instead of waiting on a spinner.

## API

### REST (`:4000`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | create account |
| `POST` | `/api/auth/login` | — | → `{ token, user }` |
| `GET` | `/api/auth/me` | ✓ | current user |
| `GET/POST` | `/api/projects` | ✓ | list / create |
| `GET/PUT/DELETE` | `/api/projects/:id` | ✓ | read / update / delete |
| `POST` | `/api/compile` | — | full compile (all stages) |
| `POST` | `/api/run` | — | execute with optional `stdin` |
| `GET` | `/api/health` | — | liveness + toolchain info |

### Socket.IO events

| Direction | Event | Payload |
|---|---|---|
| client → server | `compile:request` | `{ requestId, source, projectId?, steps? }` |
| server → client | `compile:start` | `{ requestId, steps }` |
| server → client | `compile:step` | `{ requestId, step, status, durationMs?, progress }` |
| server → client | `compile:done` | `{ requestId, compilationId, result }` |
| server → client | `compile:error` | `{ requestId, message }` |

`requestId` correlates every event, so overlapping or out-of-order compiles can't interleave in the UI.

## Development

```bash
pnpm typecheck     # tsc across shared + api + web
pnpm lint          # typecheck-based lint
pnpm build         # shared → api → web (vite production build)
pnpm db:studio     # Prisma studio
```

## How it works

1. **Stages stream, not batch** — each stage runs in its own clang invocation where possible; the API emits `compile:step` the moment a stage lands, so the UI animates progress in real time.
2. **AST without the OOM** — clang's `-ast-dump=json` for a hello-world with `<iostream>` is ~129 MB. CodeLens streams stdout through a line-state machine that captures only top-level declarations belonging to the user's file (tracking clang's file-occurrence rule where `"file"` is printed only on change), keeping memory bounded by a 512 MB cap instead of the dump size.
3. **Sandboxed runs** — user programs execute through a bash wrapper with `ulimit -v` (memory), `timeout` (wall clock) and byte-capped output capture.
4. **One type system** — `packages/shared` defines compile/run DTOs and typed socket contracts consumed by both server and client, so a payload change breaks the build, not production.
