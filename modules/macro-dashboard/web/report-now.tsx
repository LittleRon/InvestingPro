// 「立即编写」按钮（仪表盘和报告页共用）：先问 /api/admin/me 拿会话的 CSRF token，
// 再 POST /api/admin/macro/report 入队，worker 先采集再写报告。提交后轮询统一状态接口，
// 显示预计倒计时与进度，写好后主动提示并给「查看报告」入口。未登录时给登录链接。
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { CountryKey } from "../indicators.ts";
import { GenerationProgress, type GenerationPhase } from "./generation-progress.tsx";

type Check = "checking" | "ready" | "not-admin";

interface AdminMe { name: string; csrf: string; dev: boolean }

/** /api/site/dashboard/generation/status 里报告那一侧的字段。 */
interface ReportJobState {
  running: boolean;
  lastStatus: string | null;
  lastError: string | null;
  detail: { written: boolean | null; reason: string | null } | null;
  startedAt: string | null;
  at: string | null;
  writtenAt: string | null;
}

interface StatusResponse {
  expectedSeconds: number;
  report: ReportJobState;
}

const BTN = "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-60";

export function ReportNowButton({ scope, label = "立即编写今天" }: { scope: CountryKey; label?: string }) {
  const [check, setCheck] = useState<Check>("checking");
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [message, setMessage] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [expectedSeconds, setExpectedSeconds] = useState(180);
  // 查看链接的 cache-bust 参数只在提交成功后设置：渲染期读 Date.now() 会让
  // SSR 与 hydration 产出不同的 href。初始为 null，SSR 输出稳定。
  const [doneAt, setDoneAt] = useState<number | null>(null);
  // 地址从 router 拿，不读 window：这个组件会跟着 SSR 的页面一起渲染。
  const { pathname, search } = useLocation();
  const loginLink = `/api/auth/login?return=${encodeURIComponent(pathname + search)}`;

  // 公开页面没有 admin-layout 的 loader，CSRF 直接从 /api/admin/me 取。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) { setCheck("not-admin"); return; }
        if (!res.ok) throw new Error(`me ${res.status}`);
        const me = await res.json() as AdminMe;
        // 登录成功必须离开 "checking"：漏了这一句按钮就会永远置灰显示「检查登录状态…」。
        setCheck("ready");
        setMessage(`以 ${me.name} 的身份提交`);
      } catch (error) {
        if (!cancelled) { setCheck("not-admin"); setMessage((error as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const beijingToday = () => {
    // 和后端 report.ts 的 beijingToday 一致：站点日程按北京时间走。
    const d = new Date(Date.now() + 8 * 3_600_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  /** 轮询：以「是否出现当天报告」为完成判据，同时读任务状态给出失败/跳过的原因。 */
  const pollUntilWritten = async () => {
    const want = beijingToday();
    // 最多等约 4 分钟，每 3 秒问一次；接口是 no-store，不会被缓存挡住。
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        const res = await fetch(`/api/site/dashboard/generation/status?scope=${scope}`, { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) continue;
        const body = await res.json() as StatusResponse;
        if (body.expectedSeconds) setExpectedSeconds(body.expectedSeconds);
        const job = body.report;
        if (job.startedAt) {
          const t = Date.parse(job.startedAt);
          if (Number.isFinite(t)) setStartedAt(t);
        }
        if (job.at === want) {
          setPhase("done");
          setMessage(`今天的 PEST 报告已经写好（${want}），点下方按钮直接查看。`);
          return;
        }
        if (job.lastStatus === "failed") {
          setPhase("failed");
          setMessage(job.lastError ? job.lastError.split("\n")[0]!.slice(0, 160) : "任务失败，请在后台「运行」页查看原因。");
          return;
        }
        // 任务跑完但没有写出：把跳过原因（数据不够 / 今天已有报告）如实说出来。
        if (!job.running && job.lastStatus === "ok" && job.detail?.written === false) {
          const reason = job.detail.reason ?? "任务跳过了";
          if (reason.includes("已经有报告")) {
            setPhase("done");
            setMessage("今天的报告已经存在，点下方按钮查看。");
          } else {
            setPhase("failed");
            setMessage(reason);
          }
          return;
        }
      } catch { /* 网络抖动，继续等 */ }
    }
    setPhase("timeout");
    setMessage("等了约 4 分钟还没写出报告。任务可能仍在执行，稍后刷新，或在后台「运行」页查任务状态。");
  };

  const submit = async () => {
    setPhase("submitting");
    const submitted = Date.now();
    setStartedAt(submitted);
    setDoneAt(submitted);
    setMessage("正在提交…");
    try {
      const me = await (await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" })).json() as AdminMe;
      // 声明了 JSON 就必须带 body：Fastify 的 JSON parser 遇到空 body 会抛 400。
      const res = await fetch(`/api/admin/macro/report?scope=${scope}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": me.csrf },
        body: "{}",
      });
      if (res.status === 401) { setCheck("not-admin"); setPhase("idle"); setMessage("登录状态过期了，请重新登录"); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { detail?: string }).detail ?? `提交失败（${res.status}）`);
      setPhase("running");
      setMessage("已提交，worker 正在采集数据并撰写报告。");
      await pollUntilWritten();
    } catch (error) {
      setPhase("failed");
      setMessage((error as Error).message);
    }
  };

  // doneAt 为空时不带 t，保证 SSR 首屏的 href 稳定；完成后才用提交时刻破页面缓存。
  const viewHref = `/dashboard/report?scope=${scope}&at=${beijingToday()}${doneAt ? `&t=${doneAt}` : ""}`;

  if (check === "checking") return <button type="button" className={`${BTN} border-line-soft text-ink-3`} disabled>检查登录状态…</button>;
  if (check === "not-admin") {
    return (
      <a href={loginLink} className={`${BTN} border-line-soft text-ink-3 hover:text-accent`}>
        登录后可手动编写
      </a>
    );
  }
  const busy = phase === "submitting" || phase === "running";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={submit} disabled={busy}
        className={`${BTN} ${phase === "done" ? "border-line-soft bg-bg-sunk text-ink dark:bg-bg-muted" : "border-accent/40 text-accent"}`}>
        {busy ? "生成中…" : phase === "done" ? "再写一次" : label}
      </button>
      {!busy && phase === "idle" && message && <span className="text-[11px] leading-[1.6] text-ink-4">{message}</span>}
      <GenerationProgress
        phase={phase}
        startedAt={startedAt}
        expectedSeconds={expectedSeconds}
        message={busy ? undefined : message}
        view={{ href: viewHref, label: "查看今天的 PEST 报告" }}
        onRetry={submit}
      />
    </div>
  );
}
