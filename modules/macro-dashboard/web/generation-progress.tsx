// 生成进度：管理员点「立即编写 / 生成 AI 解读」后，异步任务由 worker 执行，
// 页面必须把「还要等多久、现在到哪一步、好了没有」说清楚，完成后主动引导去看结果。
//
// 进度是按「任务开始时间 + 预计耗时」推算的估算值，不是 worker 的真实百分比
// （worker 目前不回传阶段）。文案如实写「预计」，不假装精确。
import { useEffect, useState } from "react";

export type GenerationPhase = "idle" | "submitting" | "running" | "done" | "failed" | "timeout";

export interface GenerationView {
  /** 生成完成后点「查看报告」去哪里。 */
  href: string;
  label: string;
}

export interface GenerationProgressProps {
  phase: GenerationPhase;
  /** 任务开始时间（毫秒）；没有就用本地提交时间。 */
  startedAt: number | null;
  /** 服务端给的预计耗时（秒）。 */
  expectedSeconds?: number;
  /** 当前阶段的一句补充说明。 */
  message?: string;
  /** 完成后的查看入口。 */
  view?: GenerationView;
  /** 页面加载时就发现「今天已有报告」时的常驻入口（用户可能是在别处点的生成）。 */
  readyView?: GenerationView & { message?: string };
  /** 失败后的重试。 */
  onRetry?: () => void;
}

const STAGES = [
  { at: 0, label: "任务已排队，等待 worker 接手" },
  { at: 10, label: "正在采集当天的宏观数据" },
  { at: 35, label: "正在调用模型撰写内容" },
  { at: 90, label: "正在写入并校验结果" },
];

function stageOf(elapsed: number): string {
  let stage = STAGES[0]!.label;
  for (const s of STAGES) if (elapsed >= s.at) stage = s.label;
  return stage;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const BTN = "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors";

/**
 * 只在 running / submitting 时渲染；其余状态由各页面自己的提示区负责。
 * 用 requestAnimationFrame 无关的 1 秒定时器，卸载时清理，SSR 首屏不读浏览器时间。
 */
export function GenerationProgress({ phase, startedAt, expectedSeconds = 180, message, view, readyView, onRetry }: GenerationProgressProps) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "running" && phase !== "submitting") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  if (phase === "done") {
    return (
      <div className="mt-3 rounded-sheet border border-accent/30 bg-accent/5 px-4 py-3" role="status" aria-live="polite">
        <div className="text-[13px] font-semibold text-ink-2">报告已经生成好了</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{message ?? "内容已写入，可以直接查看。"}</p>
        {view && (
          // 普通链接做整页跳转：SPA 的预取链接会走页面复用缓存，
          // 生成完立刻点可能停在旧 HTML 上，看起来像「点了没反应」。
          <a href={view.href} className={`${BTN} mt-3 border-accent/40 text-accent hover:bg-accent/10`}>
            {view.label} <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
    );
  }

  // 用户可能在别处点了生成、或跳走又回来：页面一加载就根据服务端状态给出常驻入口。
  if (phase === "idle" && readyView) {
    return (
      <div className="mt-3 rounded-sheet border border-line-soft bg-bg-sunk px-4 py-3 dark:bg-bg-muted">
        <div className="text-[12.5px] font-semibold text-ink-2">今天的报告已经生成好了</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{readyView.message ?? "可以直接查看，无需在页面上等待。"}</p>
        <a href={readyView.href} className={`${BTN} mt-3 border-accent/40 text-accent hover:bg-accent/10`}>
          {readyView.label} <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  }

  if (phase === "failed" || phase === "timeout") {
    return (
      <div className="mt-3 rounded-sheet border border-hot/30 bg-hot/5 px-4 py-3" role="alert">
        <div className="text-[13px] font-semibold text-ink-2">{phase === "timeout" ? "等待时间超出预期" : "这次生成没有成功"}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{message ?? "可以稍后重试，或在后台「运行」页查看任务记录。"}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className={`${BTN} mt-3 border-line-soft text-ink-2 hover:text-accent`}>
            重新生成
          </button>
        )}
      </div>
    );
  }

  if (phase !== "running" && phase !== "submitting") return null;

  // SSR 首屏 now 还没取到：给一个不依赖浏览器时间的静态骨架，hydration 后立刻开始走。
  const elapsed = now !== null && startedAt !== null ? Math.max(0, (now - startedAt) / 1000) : 0;
  const remaining = Math.max(0, expectedSeconds - elapsed);
  // 进度条只到 92%，避免「到 100% 却还没好」的假完成；完成后由 done 状态接管。
  const pct = Math.min(92, Math.round((elapsed / expectedSeconds) * 100));
  const overtime = remaining === 0;

  return (
    <div className="mt-3 rounded-sheet border border-line-soft bg-bg-sunk px-4 py-3 dark:bg-bg-muted" role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[12.5px] font-semibold text-ink-2">正在生成报告</span>
        <span className="num text-[11.5px] text-ink-3">
          {now === null ? "预计约 3 分钟" : overtime ? `已超过预计时间 ${mmss(elapsed - expectedSeconds)}` : `预计还需 ${mmss(remaining)}`}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line-soft" role="progressbar"
        aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="报告生成进度（预计）">
        <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
        {stageOf(elapsed)}{overtime ? "；比预计稍久，仍在生成，请再等一会儿" : "。生成完成后会在这里提示，并给出查看入口。"}
      </p>
      {message && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">{message}</p>}
    </div>
  );
}
