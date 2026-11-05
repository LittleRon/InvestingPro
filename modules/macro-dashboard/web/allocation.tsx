// /dashboard/allocation：动态组合策略配置。输入总资产、当前持仓、时效范围，展示规则引擎算出的
// 各资产大类基线权重 + 金额。配置保存在服务器（挂管理员账户，不做读者账户）。AI 解读通过按钮触发，
// 读者打开页面不自动调模型（项目规则）。
import { useLoaderData, useFetcher } from "react-router";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import type { AllocationResult, Horizon } from "../allocation.ts";
import { HORIZONS } from "../allocation.ts";
import type { ClockResult } from "../clock.ts";
import { IconChart } from "@aihot/web/components/icons";

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
  const interpretation = loaderData.interpretation as InterpretationResponse | null;

  /** 保存配置的 fetcher（客户端提交，不整页刷新）。 */
  const saveFetcher = useFetcher<{ ok: boolean; error?: string }>();

  /** AI 解读的 fetcher（触发生成）。 */
  const interpFetcher = useFetcher<{ ok: boolean; error?: string }>();

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
          <saveFetcher.Form method="post" action="/api/admin/macro/allocation" className="mt-4">
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
              <button type="submit" disabled={saveFetcher.state !== "idle"} className="rounded-full border border-line-soft px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-accent disabled:opacity-50">
                保存配置
              </button>
              {saveFetcher.data?.ok && <span className="text-[12px] text-accent">已保存</span>}
              {saveFetcher.data && !saveFetcher.data.ok && <span className="text-[12px] text-hot">保存失败</span>}
            </div>
          </saveFetcher.Form>
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
              {interpretation ? `生成于 ${interpretation.at}` : "还没有生成解读"}
            </span>
          </div>
          {/* 管理员触发按钮 */}
          <interpFetcher.Form method="post" action="/api/admin/macro/allocation/interpretation" className="mt-3">
            <button type="submit" disabled={interpFetcher.state !== "idle"} className="rounded-full border border-line-soft px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-accent disabled:opacity-50">
              {interpFetcher.state !== "idle" ? "正在生成…" : "生成 AI 解读"}
            </button>
          </interpFetcher.Form>
          {interpFetcher.data?.ok && <span className="ml-3 text-[12px] text-accent">已触发，稍后刷新查看</span>}
          {interpFetcher.data && !interpFetcher.data.ok && <span className="ml-3 text-[12px] text-hot">触发失败</span>}
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
