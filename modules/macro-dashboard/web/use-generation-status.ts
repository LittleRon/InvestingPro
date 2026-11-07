// 生成状态以服务端 job_runs 为准，不放在组件本地 state 里。
// 这样用户跳到别的页面再回来（甚至换台设备、刷新）都能看到真实进度与结果。
import { useEffect, useState } from "react";

export interface GenerationJobState {
  running: boolean;
  lastStatus: string | null;
  lastError: string | null;
  startedAt: string | null;
  at: string | null;
  hasToday: boolean;
}

export interface ReportJobState extends GenerationJobState {
  detail: { written: boolean | null; reason: string | null } | null;
  writtenAt: string | null;
}

export interface InterpJobState extends GenerationJobState {
  generation: number;
}

export interface GenerationStatus {
  expectedSeconds: number;
  today: string;
  report: ReportJobState;
  interpretation: InterpJobState;
}

/** 查一次服务端状态；失败返回 null，页面保持安静而不是报错。 */
export async function loadGenerationStatus(scope: string): Promise<GenerationStatus | null> {
  try {
    const res = await fetch(`/api/site/dashboard/generation/status?scope=${encodeURIComponent(scope)}`, {
      credentials: "same-origin", cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json() as GenerationStatus;
  } catch {
    return null;
  }
}

export type GenerationKind = "report" | "interpretation";

/**
 * 页面挂载时恢复生成状态，并在任务进行中持续轮询。
 * 返回的是服务端事实，不是本地猜测：刷新、跳走再回来都能对上。
 */
export function useGenerationStatus(kind: GenerationKind, scope = "CN", intervalMs = 3_000) {
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      const next = await loadGenerationStatus(scope);
      if (cancelled || !next) return;
      setStatus(next);
      const job = kind === "report" ? next.report : next.interpretation;
      // 任务结束就停止轮询，避免页面一直空转。
      if (!job.running && timer) { clearInterval(timer); timer = null; }
    };
    void poll();
    timer = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [kind, scope, intervalMs]);
  return status;
}

/** 把服务端状态翻译成进度组件需要的阶段与时间戳。 */
export function phaseFromStatus(
  status: GenerationStatus | null,
  kind: GenerationKind,
): { phase: "idle" | "running" | "done" | "failed"; startedAt: number | null; message: string; hasToday: boolean; expectedSeconds: number } {
  if (!status) return { phase: "idle", startedAt: null, message: "", hasToday: false, expectedSeconds: 180 };
  const job = kind === "report" ? status.report : status.interpretation;
  const startedAt = job.startedAt ? Date.parse(job.startedAt) : null;
  const base = { startedAt: Number.isFinite(startedAt) ? startedAt : null, hasToday: job.hasToday, expectedSeconds: status.expectedSeconds || 180 };
  if (job.running) {
    return { ...base, phase: "running", message: "后台任务正在生成，页面会自动更新；你可以先去做别的事。" };
  }
  if (job.lastStatus === "failed") {
    return { ...base, phase: "failed", message: job.lastError ? job.lastError.split("\n")[0]!.slice(0, 160) : "这次生成没有成功，可以重试。" };
  }
  if (job.hasToday) {
    return { ...base, phase: "done", message: "今天的报告已经生成好，可以直接查看。" };
  }
  return { ...base, phase: "idle", message: "" };
}

/** 供解读使用：generation 变大说明确实写出了新的一版。 */
export function interpWritten(status: GenerationStatus | null, baseGeneration: number): boolean {
  if (!status) return false;
  return status.interpretation.generation > baseGeneration || status.interpretation.hasToday;
}
