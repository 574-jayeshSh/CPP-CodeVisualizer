#!/usr/bin/env node
/**
 * CodeLens benchmark suite.
 *
 * Measures end-to-end compile latency (per stage) and run round-trip
 * against a live API, verifies correctness, and prints a median-based
 * report.
 *
 * Usage:
 *   pnpm bench                      # defaults: 3 timed runs, localhost:4000
 *   pnpm bench --runs 10            # more samples
 *   pnpm bench --base http://host:port
 *   pnpm bench --json               # machine-readable output
 *
 * Methodology: one untimed warm-up per scenario, then N timed runs;
 * the report shows the median (robust against outliers). Requires the
 * API to be running (`pnpm dev:api`).
 */

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = args[index + 1];
  return next && !next.startsWith("--") ? next : true;
}

const BASE = String(flag("base", "http://localhost:4000")).replace(/\/$/, "");
const RUNS = Math.max(1, Number(flag("runs", 3)));
const JSON_OUT = Boolean(flag("json", false));

const SOURCES = {
  "hello-world": "int main(){return 0;}",
  "iostream-hello": `#include <iostream>
int main(){std::cout<<"hi"<<std::endl;return 0;}`,
  "typical": `#include <iostream>
#include <string>
#include <vector>
struct Point{int x;int y;};
int add(int a,int b){return a+b;}
namespace util { int twice(int v){return v*2;} }
int main(){
  Point p{2,3};
  std::string s="hello";
  std::vector<int> v{1,2,3};
  int total=0;
  for(int x:v) total+=add(x,p.x)+util::twice(x);
  std::cout<<s<<" "<<total<<"\\n";
  return 0;
}`,
};

const RUN_SOURCES = {
  "run/iostream+stdin": {
    source: `#include <iostream>
#include <string>
int main(){std::string s;std::cin>>s;std::cout<<s<<" ok\\n";return 0;}`,
    stdin: "benchmark\n",
    expectStdinEcho: "benchmark ok",
  },
};

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round = (x) => Math.round(x);
const ms = (x) => `${round(x)} ms`;

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} → HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function checkApi() {
  try {
    const response = await fetch(`${BASE}/api/health`);
    const health = await response.json();
    if (!health.ok) throw new Error("not ok");
    return health;
  } catch (error) {
    console.error(
      `✗ API is not reachable at ${BASE}\n` +
        `  Start it first:  pnpm dev:api\n` +
        `  (original error: ${error instanceof Error ? error.message : error})`,
    );
    process.exit(1);
  }
}

async function benchCompile(name, source) {
  const warm = await post("/api/compile", { source });
  if (warm.status !== "success") {
    throw new Error(`${name}: warm-up compile failed (${warm.status})`);
  }

  const totals = [];
  const walls = [];
  const stages = { lex: [], parse: [], semantic: [], codegen: [] };
  let last = null;

  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    const data = await post("/api/compile", { source });
    walls.push(performance.now() - started);

    if (data.status !== "success") {
      throw new Error(`${name}: timed run ${i + 1} failed (${data.status})`);
    }

    totals.push(data.totalDurationMs);
    for (const step of Object.keys(stages)) {
      stages[step].push(data.steps[step]?.durationMs ?? 0);
    }
    last = data;
  }

  return {
    name,
    medianTotalMs: round(median(totals)),
    minTotalMs: round(Math.min(...totals)),
    medianWallMs: round(median(walls)),
    stages: Object.fromEntries(
      Object.entries(stages).map(([step, values]) => [step, round(median(values))]),
    ),
    tokens: last.steps.lex?.data?.tokenCount ?? 0,
    astNodes: last.steps.parse?.data?.nodeCount ?? 0,
    symbols: last.steps.semantic?.data?.symbolCount ?? 0,
    diagnostics: last.diagnostics.length,
  };
}

async function benchRun(name, spec) {
  const warm = await post("/api/run", { source: spec.source, stdin: spec.stdin });
  if (warm.exitCode !== 0) {
    throw new Error(`${name}: warm-up run exited ${warm.exitCode}`);
  }

  const walls = [];
  const reported = [];

  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    const data = await post("/api/run", { source: spec.source, stdin: spec.stdin });
    walls.push(performance.now() - started);

    if (data.exitCode !== 0 || data.timedOut) {
      throw new Error(`${name}: timed run ${i + 1} failed (exit=${data.exitCode})`);
    }
    if (spec.expectStdinEcho && !data.stdout.includes(spec.expectStdinEcho)) {
      throw new Error(`${name}: output verification failed — expected "${spec.expectStdinEcho}"`);
    }
    reported.push(data.durationMs);
  }

  return {
    name,
    medianWallMs: round(median(walls)),
    medianReportedMs: round(median(reported)),
    outputVerified: Boolean(spec.expectStdinEcho),
  };
}

function printReport(report) {
  const pad = (value, width) => String(value).padEnd(width);

  console.log("");
  console.log(`CodeLens benchmark — ${BASE}`);
  console.log(`warm-up: 1 · timed runs: ${RUNS} · aggregation: median`);
  console.log("");

  const header =
    pad("compile scenario", 20) +
    pad("total", 10) +
    pad("min", 10) +
    pad("lex", 9) +
    pad("parse", 9) +
    pad("semantic", 10) +
    pad("codegen", 10) +
    pad("tokens", 8) +
    pad("nodes", 7) +
    "symbols";
  console.log(header);
  console.log("─".repeat(header.length));

  for (const row of report.compile) {
    console.log(
      pad(row.name, 20) +
        pad(ms(row.medianTotalMs), 10) +
        pad(ms(row.minTotalMs), 10) +
        pad(ms(row.stages.lex), 9) +
        pad(ms(row.stages.parse), 9) +
        pad(ms(row.stages.semantic), 10) +
        pad(ms(row.stages.codegen), 10) +
        pad(row.tokens, 8) +
        pad(row.astNodes, 7) +
        row.symbols,
    );
  }

  console.log("");
  for (const row of report.run) {
    const verify = row.outputVerified ? " · stdout verified" : "";
    console.log(
      `run  ${pad(row.name, 28)} median ${ms(row.medianWallMs)} wall · ` +
        `${ms(row.medianReportedMs)} reported${verify}`,
    );
  }
  console.log("");
}

async function main() {
  const health = await checkApi();

  const report = {
    meta: {
      base: BASE,
      runs: RUNS,
      aggregation: "median",
      warmup: 1,
      date: new Date().toISOString(),
      std: health.std,
      language: health.language,
      sandboxMode: health.sandboxMode,
    },
    compile: [],
    run: [],
  };

  for (const [name, source] of Object.entries(SOURCES)) {
    process.stderr.write(`  compiling ${name}… `);
    report.compile.push(await benchCompile(name, source));
    process.stderr.write("done\n");
  }

  for (const [name, spec] of Object.entries(RUN_SOURCES)) {
    process.stderr.write(`  running ${name}… `);
    report.run.push(await benchRun(name, spec));
    process.stderr.write("done\n");
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main().catch((error) => {
  console.error(`✗ benchmark failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
