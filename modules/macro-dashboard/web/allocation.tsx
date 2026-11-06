// /dashboard/allocation：动态组合策略配置。输入总资产、当前持仓、时效范围，展示规则引擎算出的
// 各资产大类基线权重 + 金额。配置保存在服务器（挂管理员账户，不做读者账户）。AI 解读通过按钮触发，
// 读者打开页面不自动调模型（项目规则）。
import { useLoaderData } from "react-router";
import { useState, useEffect } from "react";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import type { AllocationResult, Horizon } from "../allocation.ts";
import { HORIZONS } from "../allocation.ts";
import type { ClockResult } from "../clock.ts";

export const handle: Screen = { tab: "dashboard", name: "组合配置" };
export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

interface AllocationResponse {
  clock: ClockResult;
  cycles: { key: string; phase: "rising" | "falling" | null }[];
  allocation: AllocationResult;
  horizons: Record<Horizon, AllocationResult>;
}

interface InterpretationResponse {
  scope: string;
  at: string;
  model: string | null;
  generation: number;
  regeneratedAt: string | null;
  payload: {
    interpretation: string;
    watchpoints: string[];
    snapshot: {
      quadrant: string;
      cycles: string;
      shortWeights: string;
      mediumWeights: string;
      longWeights: string;
      holdings: string;
      totalAssets: string;
      notes: string[];
    };
  };
}

/** 生成状态：有没有在跑、服务器上的解读是不是比客户端这份新。 */
interface InterpStatus {
  running: boolean;
  lastStatus: string | null;
  lastError: string | null;
  generation: number;
  regeneratedAt: string | null;
}

interface AdminMe { name: string; csrf: string; dev: boolean }

export async function loader({ request }: { request: Request }) {
  const [alloc, interpRaw] = await Promise.all([
    loadOr404<AllocationResponse>("/api/site/dashboard/allocation", { signal: request.signal }),
    loadOr404<InterpretationResponse | { missing: string }>("/api/site/dashboard/allocation/interpretation", { signal: request.signal }).catch(() => null),
  ]);
  const interpretation = interpRaw && !("missing" in interpRaw) ? interpRaw : null;
  return cachedPage(300, {
    data: alloc,
    interpretation,
  });
}

export function meta() {
  return pageMeta({
    title: "组合配置",
    description: "基于投资时钟与经济周期位置的动态组合配置参考：规则引擎算权重，AI 写解读。工具参考，不构成投资建议。",
    path: "/dashboard/allocation",
  });
}

export default function AllocationPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { clock, allocation, cycles, horizons } = loaderData.data;
  // 解读放在本地 state：生成完直接换掉，不靠整页刷新（页面本身有 300 秒缓存，
  // 刷新也可能拿到旧的）。
  const [interpretation, setInterpretation] = useState<InterpretationResponse | null>(
    loaderData.interpretation as InterpretationResponse | null,
  );

  // CSRF token：公开页面没有 admin-layout 的 loader，直接从 /api/admin/me 取（和 report-now.tsx 一致）。
  const [admin, setAdmin] = useState<AdminMe | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setAdmin(await res.json() as AdminMe);
      } catch { /* not admin */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 页面本身带 300 秒缓存，HTML 里的解读可能是旧的。hydration 之后立刻拉一次最新的
  // （接口是 no-store），服务器上版本更新就换掉，保证读者看到的始终是最新一版。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/site/dashboard/allocation/interpretation", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const fresh = await res.json() as InterpretationResponse | { missing: string };
        if (cancelled || !fresh || "missing" in fresh || !fresh.payload) return;
        setInterpretation((prev) => (!prev || fresh.generation >= prev.generation ? fresh : prev));
      } catch { /* 网络抖动，用 SSR 那份 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 保存配置状态
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");

  // AI 解读状态
  const [interpState, setInterpState] = useState<"idle" | "generating" | "done" | "error" | "not-admin">("idle");
  const [interpMsg, setInterpMsg] = useState("");

  const ASSET_KEYS = ["stocks", "bonds", "commodities", "cash", "gold"] as const;
  const ASSET_NAMES: Record<string, string> = { stocks: "股票", bonds: "债券", commodities: "大宗商品", cash: "现金", gold: "黄金" };

  const totalAssets = allocation.totalAssets;
  const holdings = {
    stocks: allocation.weights.find((w) => w.key === "stocks")?.holdings ?? 0,
    bonds: allocation.weights.find((w) => w.key === "bonds")?.holdings ?? 0,
    commodities: allocation.weights.find((w) => w.key === "commodities")?.holdings ?? 0,
    cash: allocation.weights.find((w) => w.key === "cash")?.holdings ?? 0,
    gold: allocation.weights.find((w) => w.key === "gold")?.holdings ?? 0,
  };

  const loginLink = `/api/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;

  /** 保存配置：收集表单数据，带 CSRF token POST JSON。 */
  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!admin) { setSaveState("error"); setSaveMsg("需要管理员登录"); return; }
    setSaveState("saving");
    setSaveMsg("");
    const fd = new FormData(e.currentTarget);
    const total = Number(fd.get("totalAssets")) || 0;
    const holdingsObj: Record<string, number> = {};
    for (const key of ASSET_KEYS) {
      holdingsObj[key] = Number(fd.get(`holding_${key}`)) || 0;
    }
    try {
      const res = await fetch("/api/admin/macro/allocation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": admin.csrf },
        body: JSON.stringify({ totalAssets: total, holdings: holdingsObj, horizon: "medium" }),
      });
      if (res.status === 401) { setSaveState("error"); setSaveMsg("登录状态过期，请重新登录"); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { detail?: string }).detail ?? `保存失败（${res.status}）`);
      setSaveState("saved");
      setSaveMsg("已保存");
      setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      setSaveState("error");
      setSaveMsg((error as Error).message);
    }
  };

  /**
   * 生成 AI 解读：带 CSRF token POST，入队后立刻返回。
   * force=true 时覆盖同一天原来那条（重新生成）。
   * 入队后轮询状态接口，服务器上出现更新的解读就刷新页面，读者自动看到最新一版。
   */
  const handleInterp = async (force: boolean) => {
    if (!admin) { setInterpState("not-admin"); setInterpMsg("需要管理员登录"); return; }
    setInterpState("generating");
    setInterpMsg(force ? "正在重新生成…" : "正在生成…");
    try {
      const res = await fetch("/api/admin/macro/allocation/interpretation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": admin.csrf },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      if (res.status === 401) { setInterpState("not-admin"); setInterpMsg("登录状态过期，请重新登录"); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { detail?: string }).detail ?? `触发失败（${res.status}）`);
      setInterpMsg("已提交，正在生成…");
      await pollForNewInterp(interpretation?.generation ?? 0);
    } catch (error) {
      setInterpState("error");
      setInterpMsg((error as Error).message);
    }
  };

  /**
   * 轮询生成状态：服务器上的 generation 变大就是有新解读。
   * 拿到新解读后直接换本地 state——不整页刷新（页面有 300 秒缓存，刷新也可能读到旧的）。
   */
  const pollForNewInterp = async (base: number) => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 5_000));
      try {
        const res = await fetch("/api/site/dashboard/allocation/interpretation/status", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) continue;
        const status = await res.json() as InterpStatus;
        if (status.generation > base) {
          const fresh = await (await fetch("/api/site/dashboard/allocation/interpretation", {
            credentials: "same-origin",
            cache: "no-store",
          })).json() as InterpretationResponse;
          if (fresh?.payload) {
            setInterpretation(fresh);
            setInterpState("done");
            setInterpMsg(`已生成第 ${fresh.generation} 版`);
          } else {
            setInterpState("done");
            setInterpMsg("已生成，页面正在刷新…");
            window.location.reload();
          }
          return;
        }
        if (status.lastStatus === "failed" && !status.running) {
          setInterpState("error");
          setInterpMsg(status.lastError ?? "生成失败");
          return;
        }
      } catch { /* 网络抖动，继续等 */ }
    }
    setInterpState("error");
    setInterpMsg("等了 3 分钟还没生成完，稍后刷新看看");
  };

  const BTN = "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-50";

  return (
    <div className="pb-10">
      <PhoneBar title="组合配置" large sub={<>当前象限：<span className="num">{clock.quadrantName}</span></>} />
      <header className="hidden pb-5 pt-1 lg:block">
        <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">动态组合配置</h1>
        <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-[1.7] text-ink-3">
          规则引擎基于投资时钟与经济周期位置算出各资产大类基线权重，AI 只写解读不重算权重。配置保存在服务器，挂管理员账户。
        </p>
      </header>

      <div className="space-y-4">
        {/* 配置输入 */}
        <section className="card p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink">配置输入</h2>
          <p className="mt-1 text-[12px] text-ink-4">修改后点击保存，重新计算配置方案。</p>
          <form onSubmit={handleSave} className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="w-24 shrink-0 text-[12.5px] text-ink-3">总资产（元）</label>
                <input
                  type="number"
                  name="totalAssets"
                  defaultValue={totalAssets}
                  className="w-full rounded-md border border-line-soft bg-transparent px-2.5 py-1.5 text-[13px] text-ink-2 focus:border-accent focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <span className="text-[12.5px] text-ink-3">当前持仓（元）</span>
                {ASSET_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-3">
                    <label className="w-24 shrink-0 text-[12.5px] text-ink-3">{ASSET_NAMES[key]}</label>
                    <input
                      type="number"
                      name={`holding_${key}`}
                      defaultValue={holdings[key]}
                      className="w-full rounded-md border border-line-soft bg-transparent px-2.5 py-1.5 text-[13px] text-ink-2 focus:border-accent focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              {admin
                ? <button type="submit" disabled={saveState === "saving"} className={`${BTN} border-line-soft text-ink-2 hover:text-accent`}>保存配置</button>
                : <a href={loginLink} className={`${BTN} border-line-soft text-ink-3 hover:text-accent`}>登录后保存</a>
              }
              {saveState === "saving" && <span className="text-[12px] text-ink-3">正在保存…</span>}
              {saveState === "saved" && <span className="text-[12px] text-accent">已保存</span>}
              {saveState === "error" && <span className="text-[12px] text-hot">{saveMsg}</span>}
            </div>
          </form>
        </section>

        {/* 三视图对比 */}
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-semibold text-ink">配置方案</h2>
            <span className="text-[11.5px] text-ink-4">规则引擎算出，AI 不重算权重</span>
          </div>
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            {HORIZONS.map((h) => {
              const res = horizons[h.key];
              return (
                <div key={h.key}>
                  <div className="mb-3 text-[12.5px] font-semibold text-ink-2">{h.name}（{h.months}）</div>
                  <div className="space-y-2.5">
                    {res.weights.map((w) => (
                      <div key={w.key} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[11.5px] text-ink-4">{w.name}</span>
                        <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-bg-sunk dark:bg-bg-muted">
                          <div
                            className={`flex h-full items-center justify-end rounded-md px-1.5 ${w.diff >= 0 ? "bg-accent/20" : "bg-hot/20"}`}
                            style={{ width: `${Math.max(8, w.weight)}%` }}
                          >
                            <span className="text-[10px] font-medium text-ink-2">{w.weight.toFixed(1)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink-3">
            {allocation.weights.map((w) => (
              <span key={w.key} className="flex items-center gap-1.5">
                {w.name}
                <span className="text-[11px] text-ink-4">
                  短期 {horizons.short.weights.find((x) => x.key === w.key)?.weight.toFixed(1)}%
                  {" · "}
                  中期 {horizons.medium.weights.find((x) => x.key === w.key)?.weight.toFixed(1)}%
                  {" · "}
                  长期 {horizons.long.weights.find((x) => x.key === w.key)?.weight.toFixed(1)}%
                </span>
              </span>
            ))}
          </div>
        </section>

        {/* AI 解读 */}
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-semibold text-ink">AI 解读</h2>
            <span className="text-[11.5px] text-ink-4">
              {interpretation
                ? <>生成于 {interpretation.at}{interpretation.generation > 1 && <> · 第 {interpretation.generation} 版</>}</>
                : "还没有生成解读"}
            </span>
          </div>
          {/* 管理员触发按钮 */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {admin
              ? <>
                  <button type="button" onClick={() => handleInterp(false)} disabled={interpState === "generating"} className={`${BTN} border-line-soft text-ink-2 hover:text-accent`}>
                    {interpState === "generating" ? "正在生成…" : interpretation ? "重新生成" : "生成 AI 解读"}
                  </button>
                  {interpretation && interpState !== "generating" && (
                    <button type="button" onClick={() => handleInterp(true)} className={`${BTN} border-line-soft text-ink-3 hover:text-accent`}>
                      强制覆盖生成
                    </button>
                  )}
                </>
              : <a href={loginLink} className={`${BTN} border-line-soft text-ink-3 hover:text-accent`}>登录后生成解读</a>
            }
            {interpState === "generating" && <span className="text-[12px] text-ink-3">{interpMsg}</span>}
            {interpState === "done" && <span className="text-[12px] text-accent">{interpMsg}</span>}
            {interpState === "error" && <span className="text-[12px] text-hot">{interpMsg}</span>}
            {interpState === "not-admin" && <span className="text-[12px] text-ink-4">{interpMsg}</span>}
          </div>
          {interpretation && interpretation.regeneratedAt && (
            <p className="mt-2 text-[11.5px] text-ink-4">
              最后一次重新生成：{new Date(interpretation.regeneratedAt).toLocaleString("zh-CN", { hour12: false })}
            </p>
          )}
          {/* 解读正文 */}
          {interpretation && (
            <div className="mt-4 space-y-3">
              <div className="text-[13px] leading-[1.8] text-ink-2 whitespace-pre-wrap">
                {interpretation.payload.interpretation}
              </div>
              {interpretation.payload.watchpoints.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink-3">关注点</h3>
                  <ul className="space-y-1">
                    {interpretation.payload.watchpoints.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink-3">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <details className="mt-2">
                <summary className="text-[12px] text-ink-4 hover:text-ink-3">查看解读依据（数据快照）</summary>
                <pre className="mt-2 overflow-x-auto rounded-md bg-bg-sunk dark:bg-bg-muted p-3 text-[11px] leading-[1.6] text-ink-4">
{interpretation.payload.snapshot.quadrant}

{interpretation.payload.snapshot.cycles}

短期权重：
{interpretation.payload.snapshot.shortWeights}

中期权重：
{interpretation.payload.snapshot.mediumWeights}

长期权重：
{interpretation.payload.snapshot.longWeights}

当前持仓：
{interpretation.payload.snapshot.holdings}

总资产：{interpretation.payload.snapshot.totalAssets} 元
                </pre>
              </details>
            </div>
          )}
          {!interpretation && (
            <p className="mt-3 text-[12.5px] text-ink-4">
              点击上方按钮生成 AI 解读。解读基于当前配置方案和数据快照，AI 只写解读不重算权重。
            </p>
          )}
        </section>

        {/* 周期位置 */}
        <section className="card p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink">周期位置</h2>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-ink-3">
            {cycles.map((c) => (
              <span key={c.key}>
                {c.key === "kondratiev" ? "长波" : c.key === "juglar" ? "中周期" : "短周期"}：
                <span className={c.phase === "rising" ? "text-hot" : c.phase === "falling" ? "text-ink-2" : "text-ink-4"}>
                  {c.phase === "rising" ? "上升" : c.phase === "falling" ? "下降" : "走平"}
                </span>
              </span>
            ))}
          </div>
        </section>

        {/* 方法论说明 */}
        <details className="card disclosure p-4 sm:p-5">
          <summary className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink transition-colors hover:text-accent">
            方法论与局限
          </summary>
          <div className="mt-3 space-y-2 text-[12px] leading-[1.8] text-ink-3">
            <p>
              配置方案由规则引擎算出：以投资时钟的资产适配分为基础权重，经济周期位置做小幅战术调整，时效范围做风险偏好调整，归一化到 100%。
              AI 只负责写解读，不重算权重——权重是确定、可复现、可审计的。
            </p>
            {allocation.notes.map((n) => <p key={n}>{n}</p>)}
            <p className="text-ink-4">
              这是工具参考，给框架与参考权重，不构成投资建议，不预测涨跌。数据取自公开统计源并按中国实际调整口径。
            </p>
          </div>
        </details>
      </div>

      <p className="mt-6 text-[11.5px] leading-[1.8] text-ink-4">
        本页为工具参考，给框架与参考权重，不构成投资建议，不预测涨跌。
      </p>
    </div>
  );
}
