import type { CompileResult, CompileStep, StageResult } from "@codelens/shared";
import { COMPILE_STEPS, STEP_LABELS } from "@codelens/shared";

export interface LiveStage {
  status: StageResult<unknown>["status"];
  durationMs?: number;
}

interface StagePipelineProps {
  result: CompileResult | null;
  live: Partial<Record<CompileStep, LiveStage>>;
  progress: number;
  compiling: boolean;
}

const STATUS_MARK: Record<StageResult<unknown>["status"], string> = {
  pending: "○",
  running: "◔",
  success: "✓",
  failed: "✗",
  skipped: "–",
};

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) return "";
  if (durationMs < 1) return "<1ms";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

export function StagePipeline({ result, live, progress, compiling }: StagePipelineProps) {
  const percent = Math.round((result ? 1 : progress) * 100);

  return (
    <div className="pipeline">
      <div className="pipeline-track">
        <div
          className={`pipeline-fill${result ? (result.status === "success" ? " is-success" : " is-failed") : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="pipeline-steps">
        {COMPILE_STEPS.map((step) => {
          const stage = result ? result.steps[step] : live[step];
          const status = stage?.status ?? "pending";
          const durationMs = result ? result.steps[step]?.durationMs : stage?.durationMs;

          return (
            <div key={step} className={`stage stage-${status}`}>
              <span className="stage-mark">{STATUS_MARK[status]}</span>
              <span className="stage-label">{STEP_LABELS[step]}</span>
              <span className="stage-duration">{formatDuration(durationMs)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
