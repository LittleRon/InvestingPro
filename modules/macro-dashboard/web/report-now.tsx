// 生成按钮：PEST 报告与 AI 解读共用同一套处理流程。
//
//   登录检查(/api/admin/me) → 带 CSRF 的 POST 入队 → 以服务端 job_runs 为准恢复状态
//   → 预计倒计时/进度条 → 完成后主动提示并给出查看入口 → 失败给原因并可重试。
//
// 两边曾经各写一套，结果解读侧漏了「在报告页直接生成」「失败原因」「跨页面恢复」。
// 现在统一由 GenerationNowButton 实现，ReportNowButton / InterpretationNowButton
// 只是配置不同的薄封装，任何一方改行为都会同时作用到两边。
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { CountryKey } from "../indicators.ts";
import { GenerationProgress, type GenerationView } from "./generation-progress.tsx";
import {
  loadGenerationStatus, phaseFromStatus, useGenerationStatus,
  type GenerationKind, type GenerationStatus,
} from "./use-generation-status.ts";

type Check = "checking" | "ready" | "not-admin";

interface AdminMe { name: string; csrf: string; dev: boolean }

const BTN = "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-60";

export interface GenerationNowButtonProps {
  kind: GenerationKind;
  scope?: CountryKey | string;
  label: string;
  /** 已经有内容时，主按钮换成这个文案。 */
  redoLabel?: string;
  /** 完成后 / 常驻「今天已有」指向同一份报告。 */
  view: GenerationView;
  /** 回来时发现今天已有成果的常驻提示。 */
  readyMessage?: string;
  /** 非管理员时登录提示的措辞。 */
  loginLabel?: string;
  /** 服务端状态变化时通知父组件。传稳定的 setState，父组件不用再自己轮询一次。 */
  onStatus?: (status: GenerationStatus) => void;
}

export function GenerationNowButton({
  kind, scope = "CN", label, redoLabel, view, readyMessage, loginLabel = "登录后可手动生成", onStatus,
}: GenerationNowButtonProps) {
  const [check, setCheck] = useState<Check>("checking");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [meName, setMeName] = useState("");
  // 区分「本次刚生成完」（醒目提示）与「回来发现今天早已有报告」（安静的常驻入口）。
  const [submittedHere, setSubmittedHere] = useState(false);
  const [force, setForce] = useState(false);
  // 服务端状态：挂载即恢复，任务进行中自动轮询，任务结束自动停。
  const serverStatus = useGenerationStatus(kind, String(scope), 3_000, onStatus);
  const derived = phaseFromStatus(serverStatus, kind);

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

  const submit = async (useForce = false) => {
    setForce(useForce);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const me = await (await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" })).json() as AdminMe;
      const isReport = kind === "report";
      const path = isReport
        ? `/api/admin/macro/report?scope=${scope}`
        : "/api/admin/macro/allocation/interpretation";
      // 声明了 JSON 就必须带 body：Fastify 的 JSON parser 遇到空 body 会抛 400。
      // 两边都接受 force：今天已有成果时点「再写一次 / 重新生成」要真的覆盖当天那一篇。
      const postBody = JSON.stringify(useForce ? { force: true } : {});
      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": me.csrf },
        body: postBody,
      });
      if (res.status === 401) { setCheck("not-admin"); setSubmitError("登录状态过期了，请重新登录"); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { detail?: string }).detail ?? `提交失败（${res.status}）`);
      setSubmittedHere(true);
      // 提交成功后立刻拉一次，让进度条不用等下一个轮询周期。
      const next = await loadGenerationStatus(String(scope));
      if (next) onStatus?.(next);
    } catch (error) {
      setSubmitError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (check === "checking") return <button type="button" className={`${BTN} border-line-soft text-ink-3`} disabled>检查登录状态…</button>;
  if (check === "not-admin") {
    return (
      <a href={loginLink} className={`${BTN} border-line-soft text-ink-3 hover:text-accent`}>
        {loginLabel}
      </a>
    );
  }

  // 本地提交中优先显示；否则完全跟随服务端状态。
  // 回来时若今天早已有报告，不弹「刚刚生成好了」，只给一个安静的常驻查看入口。
  const quietDone = derived.phase === "done" && !submittedHere;
  const phase = submitting ? "submitting" : submitError ? "failed" : quietDone ? "idle" : derived.phase;
  const busy = phase === "submitting" || phase === "running";
  // 今天已经有成果时，主按钮变成「再写一次 / 重新生成」，并带 force 覆盖当天那一篇。
  // 不带 force 的话 composeReport / composeInterpretation 会直接跳过写入，
  // 用户点完只看到「这一天已经有报告了」，感觉像按钮没反应。报告侧与解读侧同此逻辑。
  const redo = derived.hasToday;
  const mainLabel = busy ? "生成中…" : redo ? (redoLabel ?? label) : label;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => submit(redo)} disabled={busy}
          className={`${BTN} ${redo ? "border-line-soft bg-bg-sunk text-ink dark:bg-bg-muted" : "border-accent/40 text-accent"}`}>
          {mainLabel}
        </button>
      </div>
      {!busy && phase === "idle" && meName && <span className="text-[11px] leading-[1.6] text-ink-4">以 {meName} 的身份提交</span>}
      <GenerationProgress
        phase={phase}
        startedAt={derived.startedAt}
        expectedSeconds={derived.expectedSeconds}
        message={submitError ?? derived.message}
        view={view}
        readyView={derived.hasToday ? { ...view, message: readyMessage } : undefined}
        onRetry={() => submit(force)}
      />
    </div>
  );
}

/** PEST 报告：仪表盘与报告页共用。查看链接不带精确日期，按最新一篇展示。 */
export function ReportNowButton({ scope, label = "立即编写今天" }: { scope: CountryKey; label?: string }) {
  // 不能带精确日期参数：那会按某一天查库，日期与库里不一致就落到
  // 「还没有这一天的报告」，看起来像按钮没反应。
  const viewHref = `/dashboard/report?scope=${scope}`;
  return (
    <GenerationNowButton
      kind="report"
      scope={scope}
      label={label}
      redoLabel="再写一次"
      loginLabel="登录后可手动编写"
      view={{ href: viewHref, label: "查看今天的 PEST 报告" }}
      readyMessage="今天的报告已经生成好，可以直接查看。"
    />
  );
}

/** AI 解读：组合配置页与解读报告页共用，行为与 PEST 完全对齐。 */
export function InterpretationNowButton({ onStatus }: { onStatus?: (status: GenerationStatus) => void }) {
  return (
    <GenerationNowButton
      kind="interpretation"
      scope="CN"
      label="生成 AI 解读"
      redoLabel="重新生成"
      loginLabel="登录后生成解读"
      view={{ href: "/dashboard/allocation/report", label: "查看 AI 解读报告" }}
      readyMessage="今天的解读已经生成好，可以直接查看。"
      onStatus={onStatus}
    />
  );
}
