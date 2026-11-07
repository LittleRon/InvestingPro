// 「立即编写」按钮（仪表盘和报告页共用）：先问 /api/admin/me 拿会话的 CSRF token，
// 再 POST /api/admin/macro/report 入队，worker 先采集再写报告。提交后轮询报告接口，
// 直到今天的报告出现（或轮询超时），把过程如实写在按钮下方。未登录时给登录链接。
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { CountryKey } from "../indicators.ts";

type Phase = "checking" | "ready" | "not-admin" | "submitting" | "polling" | "done" | "timeout" | "error";

interface AdminMe { name: string; csrf: string; dev: boolean }

const BTN = "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-60";

export function ReportNowButton({ scope, label = "立即编写今天" }: { scope: CountryKey; label?: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");
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
        if (res.status === 401) { setPhase("not-admin"); return; }
        if (!res.ok) throw new Error(`me ${res.status}`);
        const me = await res.json() as AdminMe;
        // 登录成功必须离开 "checking"：漏了这一句按钮就会永远置灰显示「检查登录状态…」。
        setPhase("ready");
        setMessage(`以 ${me.name} 的身份提交`);
      } catch (error) {
        if (!cancelled) { setPhase("not-admin"); setMessage((error as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    setPhase("submitting");
    setMessage("正在入队…");
    try {
      const me = await (await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" })).json() as AdminMe;
      // 声明了 JSON 就必须带 body：Fastify 的 JSON parser 遇到空 body 会抛 400，
      // 全局错误处理会回 "The request could not be processed."，按钮看起来就是「点了没反应」。
      const res = await fetch(`/api/admin/macro/report?scope=${scope}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": me.csrf },
        body: "{}",
      });
      if (res.status === 401) { setPhase("not-admin"); setMessage("登录状态过期了，请重新登录"); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { detail?: string }).detail ?? `提交失败（${res.status}）`);
      setPhase("polling");
      setMessage("已提交，worker 正在先采集再写报告，稍等…");
      await pollUntilWritten();
    } catch (error) {
      setPhase("error");
      setMessage((error as Error).message);
    }
  };

  const beijingToday = () => {
    // 和后端 report.ts 的 beijingToday 一致：站点日程按北京时间走。
    const d = new Date(Date.now() + 8 * 3_600_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  const pollUntilWritten = async () => {
    const want = beijingToday();
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const res = await fetch(`/api/site/dashboard/report?scope=${scope}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) continue;
      const body = await res.json() as { at: string | null };
      if (body.at === want) { setPhase("done"); setMessage(`今天的报告已写好（${want}），刷新查看`); return; }
    }
    setPhase("timeout");
    setMessage("等了三分钟还没见报告，稍后再刷新看看（后台「运行」页可以查任务状态）");
  };

  if (phase === "checking") return <button type="button" className={`${BTN} border-line-soft text-ink-3`} disabled>检查登录状态…</button>;
  if (phase === "not-admin") {
    return (
      <a href={loginLink} className={`${BTN} border-line-soft text-ink-3 hover:text-accent`}>
        登录后可手动编写
      </a>
    );
  }
  const busy = phase === "submitting" || phase === "polling";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={submit} disabled={busy}
        className={`${BTN} ${phase === "done" ? "border-line-soft bg-bg-sunk text-ink dark:bg-bg-muted" : "border-accent/40 text-accent"}`}>
        {phase === "polling" ? "已提交，等待…" : label}
      </button>
      {message && <span className="text-[11px] leading-[1.6] text-ink-4">{message}</span>}
    </div>
  );
}
