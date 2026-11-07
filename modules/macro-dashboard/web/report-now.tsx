// 「立即编写」按钮（仪表盘和报告页共用）：先问 /api/admin/me 拿会话的 CSRF token，
// 再 POST /api/admin/macro/report 入队。生成状态完全以服务端 job_runs 为准，
// 由 useGenerationStatus 持续同步——刷新、跳到别的页面再回来都能看到真实进度与结果。
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { CountryKey } from "../indicators.ts";
import { GenerationProgress } from "./generation-progress.tsx";
import { loadGenerationStatus, phaseFromStatus, useGenerationStatus } from "./use-generation-status.ts";

type Check = "checking" | "ready" | "not-admin";

interface AdminMe { name: string; csrf: string; dev: boolean }

const BTN = "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-60";

export function ReportNowButton({ scope, label = "立即编写今天" }: { scope: CountryKey; label?: string }) {
  const [check, setCheck] = useState<Check>("checking");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [meName, setMeName] = useState("");
  // 区分「本次刚生成完」（醒目提示）与「回来发现今天早已有报告」（安静的常驻入口）。
  const [submittedHere, setSubmittedHere] = useState(false);
  // 服务端状态：挂载即恢复，任务进行中自动轮询，任务结束自动停。
  const serverStatus = useGenerationStatus("report", scope);
  const derived = phaseFromStatus(serverStatus, "report");

  // 地址从 router 拿，不读 window：这个组件会跟着 SSR 的页面一起渲染。
  const { pathname, search } = useLocation();
  const loginLink = `/api/auth/login?return=${encodeURIComponent(pathname + search)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) { setCheck("not-admin"); return; }
        if (!res.ok) throw new Error(`me ${res.status}`);
        const me = await res.json() as AdminMe;
        setCheck("ready");
        setMeName(me.name);
      } catch (error) {
        if (!cancelled) { setCheck("not-admin"); setSubmitError((error as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const me = await (await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" })).json() as AdminMe;
      // 声明了 JSON 就必须带 body：Fastify 的 JSON parser 遇到空 body 会抛 400。
      const res = await fetch(`/api/admin/macro/report?scope=${scope}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": me.csrf },
        body: "{}",
      });
      if (res.status === 401) { setCheck("not-admin"); setSubmitError("登录状态过期了，请重新登录"); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { detail?: string }).detail ?? `提交失败（${res.status}）`);
      setSubmittedHere(true);
      // 提交成功后立刻拉一次，让进度条不用等下一个轮询周期。
      await loadGenerationStatus(scope);
    } catch (error) {
      setSubmitError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // 不带 at：报告页按最新一篇展示。带精确日期时若日期与库里不一致，
  // 点了就会落到「还没有这一天的报告」，看起来像按钮没反应。
  const viewHref = `/dashboard/report?scope=${scope}`;
  const view = { href: viewHref, label: "查看今天的 PEST 报告" };

  if (check === "checking") return <button type="button" className={`${BTN} border-line-soft text-ink-3`} disabled>检查登录状态…</button>;
  if (check === "not-admin") {
    return (
      <a href={loginLink} className={`${BTN} border-line-soft text-ink-3 hover:text-accent`}>
        登录后可手动编写
      </a>
    );
  }

  // 本地提交中优先显示；否则完全跟随服务端状态。
  // 回来时若今天早已有报告，不弹「刚刚生成好了」，只给一个安静的常驻查看入口。
  const quietDone = derived.phase === "done" && !submittedHere;
  const phase = submitting ? "submitting" : submitError ? "failed" : quietDone ? "idle" : derived.phase;
  const busy = phase === "submitting" || phase === "running";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={submit} disabled={busy}
        className={`${BTN} ${phase === "done" ? "border-line-soft bg-bg-sunk text-ink dark:bg-bg-muted" : "border-accent/40 text-accent"}`}>
        {busy ? "生成中…" : phase === "done" ? "再写一次" : label}
      </button>
      {!busy && phase === "idle" && meName && <span className="text-[11px] leading-[1.6] text-ink-4">以 {meName} 的身份提交</span>}
      <GenerationProgress
        phase={phase}
        startedAt={derived.startedAt}
        expectedSeconds={derived.expectedSeconds}
        message={submitError ?? derived.message}
        view={view}
        readyView={derived.hasToday ? { ...view, message: "今天的报告已经生成好，可以直接查看。" } : undefined}
        onRetry={submit}
      />
    </div>
  );
}
