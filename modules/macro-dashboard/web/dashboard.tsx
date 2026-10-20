// /dashboard：宏观仪表盘。五块图（经济周期、黄金与指数基金、原油、CPI/PPI、大宗商品），
// 可以切换中国与美国、改时间范围；每天 06:30 采集一次，之后写一份 PEST 报告。
import { useLoaderData } from "react-router";
import type { BlockData, CyclesData, DashboardResponse } from "../server.ts";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { CYCLES, type CountryKey, type CycleKey } from "../indicators.ts";
import { LineChart, fmtValue, type Line } from "./chart.tsx";

export const handle: Screen = { tab: "dashboard", name: "仪表盘" };
export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

type Range = { kind: "default" } | { kind: "years"; years: number } | { kind: "custom"; from: string; to: string };

function readQuery(url: URL): { country: CountryKey; range: Range; cycle: CycleKey | "all" } {
  const country: CountryKey = url.searchParams.get("country") === "US" ? "US" : "CN";
  const cycleParam = url.searchParams.get("cycle");
  const cycle = CYCLES.some((c) => c.key === cycleParam) ? (cycleParam as CycleKey) : "all";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && to) return { country, range: { kind: "custom", from, to }, cycle };
  const years = Number(url.searchParams.get("years"));
  if (Number.isFinite(years) && years > 0) return { country, range: { kind: "years", years }, cycle };
  return { country, range: { kind: "default" }, cycle };
}

/** 时间范围落到具体的 from：周期那一块要看全部历史，长波本来就靠长序列。 */
function fromOf(range: Range): string | null {
  if (range.kind === "custom") return range.from;
  if (range.kind === "years") return new Date(Date.now() - range.years * 365 * 86_400_000).toISOString().slice(0, 10);
  return null;
}

export async function loader({ request }: { request: Request }) {
  const { country, range, cycle } = readQuery(new URL(request.url));
  const query = new URLSearchParams({ country });
  const from = fromOf(range);
  if (from) query.set("from", from);
  if (range.kind === "custom") query.set("to", range.to);
  const data = await loadOr404<DashboardResponse>(`/api/site/dashboard?${query}`, { signal: request.signal });
  return cachedPage(300, { data, country, range, cycle });
}

export function meta() {
  return pageMeta({
    title: "宏观仪表盘",
    description: "经济周期（康德拉季耶夫长波、朱格拉中周期、基钦短周期）、黄金与指数基金、原油、CPI/PPI 与大宗商品的公开数据图表，可切换中国与美国。",
    path: "/dashboard",
  });
}

const TONES = ["text-accent", "text-hot", "text-ink-3", "text-ink-4"];

function toLines(series: { key: string; name: string; points: { at: string; value: number }[] }[]): Line[] {
  return series.map((s, i) => ({ key: s.key, name: s.name, tone: TONES[i % TONES.length]!, points: s.points }));
}

function Legend({ lines }: { lines: Line[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-4">
      {lines.map((l) => (
        <span key={l.key} className="flex items-center gap-1.5">
          <span className={`h-1.5 w-3 rounded-full bg-current ${l.tone}`} />
          {l.name}
        </span>
      ))}
    </div>
  );
}

/** 顶部切换：国家、时间范围。都是链接，交给服务端渲染，不引客户端状态。 */
function Controls({ country, range, cycle }: { country: CountryKey; range: Range; cycle: CycleKey | "all" }) {
  const link = (next: { country?: CountryKey; years?: number | null; cycle?: CycleKey | "all" }) => {
    const params = new URLSearchParams();
    params.set("country", next.country ?? country);
    if (next.years) params.set("years", String(next.years));
    if (next.cycle && next.cycle !== "all") params.set("cycle", next.cycle);
    return `/dashboard?${params}`;
  };
  const active = "bg-bg-sunk font-medium text-ink dark:bg-bg-muted";
  const idle = "text-ink-3 transition-colors hover:text-ink";
  const years = range.kind === "years" ? range.years : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px]">
      <span className="flex overflow-hidden rounded-full border border-line-soft">
        {(["CN", "US"] as const).map((c) => (
          <IntentLink key={c} to={link({ country: c })} className={`px-3 py-1 ${country === c ? active : idle}`}>
            {c === "CN" ? "中国" : "美国"}
          </IntentLink>
        ))}
      </span>
      <span className="flex overflow-hidden rounded-full border border-line-soft">
        <IntentLink to={link({ years: null })} className={`px-3 py-1 ${range.kind === "default" ? active : idle}`}>默认</IntentLink>
        {[1, 3, 5, 10].map((n) => (
          <IntentLink key={n} to={link({ years: n })} className={`px-3 py-1 ${years === n ? active : idle}`}>{n} 年</IntentLink>
        ))}
      </span>
      <form method="get" action="/dashboard" className="flex items-center gap-1.5">
        <input type="hidden" name="country" value={country} />
        {cycle !== "all" && <input type="hidden" name="cycle" value={cycle} />}
        <input type="date" name="from" defaultValue={range.kind === "custom" ? range.from : ""} aria-label="开始日期" className="rounded-full border border-line-soft bg-transparent px-2.5 py-1 text-[12px] text-ink-2" />
        <span className="text-ink-4">至</span>
        <input type="date" name="to" defaultValue={range.kind === "custom" ? range.to : ""} aria-label="结束日期" className="rounded-full border border-line-soft bg-transparent px-2.5 py-1 text-[12px] text-ink-2" />
        <button type="submit" className="rounded-full border border-line-soft px-2.5 py-1 text-ink-3 transition-colors hover:text-ink">查看</button>
      </form>
    </div>
  );
}

function CyclesBlock({
  cycles,
  country,
  range,
  cycle,
}: { cycles: CyclesData; country: CountryKey; range: Range; cycle: CycleKey | "all" }) {
  const shown = cycle === "all" ? cycles.cycles : cycles.cycles.filter((c) => c.cycle === cycle);
  const lines: Line[] = cycle === "all"
    ? [{ key: "overlay", name: "三者叠加", tone: "text-ink", points: cycles.overlay.points, dashedFrom: cycles.overlay.provisionalFrom },
       ...shown.map((c, i) => ({ key: c.cycle, name: c.name, tone: TONES[i % TONES.length]!, points: c.points, dashedFrom: c.provisionalFrom }))]
    : shown.map((c) => ({ key: c.cycle, name: c.name, tone: "text-accent", points: c.points, dashedFrom: c.provisionalFrom }));
  const tabs = [{ key: "all" as const, name: "叠加" }, ...CYCLES.map((c) => ({ key: c.key, name: c.short }))];
  const params = (next: string) => {
    const p = new URLSearchParams({ country });
    if (range.kind === "years") p.set("years", String(range.years));
    if (range.kind === "custom") { p.set("from", range.from); p.set("to", range.to); }
    if (next !== "all") p.set("cycle", next);
    return `/dashboard?${p}`;
  };
  return (
    <section aria-label="经济周期" className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-[15px] font-semibold text-ink">经济周期</h2>
        <span className="flex overflow-hidden rounded-full border border-line-soft text-[12px]">
          {tabs.map((t) => (
            <IntentLink key={t.key} to={params(t.key)} className={`px-3 py-1 ${cycle === t.key ? "bg-bg-sunk font-medium text-ink dark:bg-bg-muted" : "text-ink-3 transition-colors hover:text-ink"}`}>
              {t.name}
            </IntentLink>
          ))}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-[1.7] text-ink-4">
        长波 50–60 年看实际 GDP，中周期 7–11 年看固定资本形成，短周期 3–5 年看工业产出。滤波用 Christiano-Fitzgerald 带通，纵轴是相对趋势的偏离百分比。
        {country === "CN" && "中国的固定资本形成是现价口径（世行给中国的不变价序列只有一年）"}
      </p>
      {lines.length ? <div className="mt-3"><LineChart lines={lines} height={210} zero /></div> : <div className="mt-3"><EmptyState title="还没有周期数据">先让采集跑一轮（每天 06:30）。</EmptyState></div>}
      <Legend lines={lines} />
      {cycles.cycles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink-3">
          {cycles.cycles.map((c) => (
            <span key={c.cycle} className="flex items-baseline gap-1.5">
              {c.short}
              <span className={`num font-medium ${c.phase === "rising" ? "text-hot" : c.phase === "falling" ? "text-ink-2" : "text-ink-3"}`}>
                {c.latest === null ? "—" : fmtValue(c.latest)}
              </span>
              <span className="text-[11px] text-ink-4">{c.phase === "rising" ? "上升" : c.phase === "falling" ? "下降" : "走平"}</span>
            </span>
          ))}
        </div>
      )}
      <details className="disclosure group/method mt-4 text-[12px] text-ink-4">
        <summary className="flex items-center gap-1.5 py-1 transition-colors hover:text-ink-2">技术侧的印证与这个图的局限</summary>
        <div className="space-y-2 pb-2 pl-[21px] pt-2 leading-[1.75] text-ink-3">
          <p>{cycles.note}</p>
          <p>
            长波靠的是长序列：序列越短，滤波器在两端能用的邻点越少，位置就越是估计。图里末端按虚线画，新数据进来会被修正。
            技术一侧的印证看三条：全要素生产率、研发投入强度、居民专利申请量。
          </p>
          {cycles.confirmation.length > 0 && (
            <p className="text-ink-4">
              当前印证读数：{cycles.confirmation.map((c) => `${c.name} ${c.latest ? `${fmtValue(c.latest.value)}（${c.latest.at}）` : "—"}`).join("；")}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

const ANALOGUE_TONES = ["text-ink-4", "text-ink-4", "text-ink-3", "text-ink-3", "text-ink-2"];

/**
 * 历史类比图：横轴是「那之后第几个月」，每条细线是一段相似的历史，粗线是它们的逐月中位数。
 * 这是回顾——历史上经济在类似位置时，上证之后确实走过什么。不是外推，也不是预测。
 */
function AnalogueChart({ analogues, median, forwardMonths }: {
  analogues: { at: string; path: { offset: number; pct: number }[] }[];
  median: { offset: number; pct: number }[];
  forwardMonths: number;
}) {
  const W = 820;
  const H = 200;
  const PAD = { left: 46, right: 10, top: 12, bottom: 24 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const all = [...analogues.flatMap((a) => a.path), ...median].map((p) => p.pct);
  if (!all.length) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  const x = (offset: number) => PAD.left + ((offset - 1) / Math.max(1, forwardMonths - 1)) * innerW;
  const y = (pct: number) => PAD.top + (1 - (pct - (min - pad)) / (max + pad - (min - pad))) * innerH;
  const path = (points: { offset: number; pct: number }[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.offset).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(" ");
  const ticks = [min + pad, (min + max) / 2, max - pad];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="历史上相似位置之后的走势">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line-soft" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" className="fill-ink-4 text-[10px]">{t.toFixed(0)}%</text>
        </g>
      ))}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-ink-3" strokeWidth={1} strokeDasharray="3 3" />
      {analogues.map((a, i) => (
        <path key={a.at} d={path(a.path)} fill="none" stroke="currentColor" strokeWidth={1.1} className={ANALOGUE_TONES[i % ANALOGUE_TONES.length]!} />
      ))}
      <path d={path(median)} fill="none" stroke="currentColor" strokeWidth={2.4} className="text-accent" strokeLinejoin="round" />
      {[1, 6, 12, 18, forwardMonths].filter((o) => o <= forwardMonths).map((o) => (
        <text key={o} x={x(o)} y={H - 8} textAnchor="middle" className="fill-ink-4 text-[10px]">第 {o} 月</text>
      ))}
    </svg>
  );
}

function AnaloguesBlock({ data }: { data: NonNullable<DashboardResponse["analogues"]> }) {
  const forwardMonths = data.median.length || 24;
  return (
    <section aria-label="历史类比" className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">历史上相似的位置</h2>
        <span className="text-[11.5px] text-ink-4">按 PPI 同比、制造业 PMI 与康波背景找最像的几个月</span>
      </div>
      {!data.current || !data.analogues.length ? (
        <p className="mt-3 text-[12.5px] leading-[1.7] text-ink-4">还没有足够的历史数据做类比（要先采到 PPI、PMI 和上证指数）。</p>
      ) : (
        <>
          <p className="mt-2 text-[12.5px] leading-[1.7] text-ink-3">
            当前（{data.current.at}）：PPI 同比 <span className="num">{data.current.ppi}</span>%，制造业 PMI <span className="num">{data.current.pmi}</span>。
            在 {data.compared} 个月的历史里，与这个位置最像的 {data.analogues.length} 个月是它们；下面是那之后两年上证的走势。
          </p>
          <div className="mt-3"><AnalogueChart analogues={data.analogues} median={data.median} forwardMonths={forwardMonths} /></div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-4">
            {data.analogues.map((a) => (
              <li key={a.at}>
                <span className="num text-ink-2">{a.at}</span>
                {" · "}PPI <span className="num">{a.ppi}</span>% · PMI <span className="num">{a.pmi}</span>
                {" · "}两年后 <span className={`num ${a.path[a.path.length - 1]!.pct >= 0 ? "text-hot" : "text-ink-2"}`}>
                  {a.path[a.path.length - 1]!.pct >= 0 ? "+" : ""}{a.path[a.path.length - 1]!.pct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-[1.7] text-ink-4">
            这是回顾性统计：只说明过去几次经济处在类似位置时，股市之后走过什么。样本有限，不构成任何预测，也不构成投资建议。
          </p>
        </>
      )}
    </section>
  );
}

function PlainBlock({ block }: { block: BlockData }) {
  const lines = toLines(block.series);
  return (
    <section aria-label={block.name} className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">{block.name}</h2>
        <span className="text-[11.5px] text-ink-4">{block.hint}</span>
      </div>
      {block.unavailable ? (
        <p className="mt-3 text-[12.5px] leading-[1.7] text-ink-4">{block.unavailable}</p>
      ) : lines.length ? (
        <>
          <div className="mt-3"><LineChart lines={lines} /></div>
          <Legend lines={lines} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-4">
            {block.series.map((s) => (
              <span key={s.key}>
                {s.name} <span className="num text-ink-2">{s.latest ? fmtValue(s.latest.value) : "—"}</span>
                {s.latest && <span className="text-ink-4">（{s.latest.at}）</span>}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-3"><EmptyState title="还没有数据">先让采集跑一轮（每天 06:30）。</EmptyState></div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const { data, country, range, cycle } = useLoaderData<typeof loader>();
  const blocks = data.blocks.filter((b) => b.key !== "cycles");
  return (
    <div className="pb-10">
      <PhoneBar title="宏观仪表盘" large sub={<>{country === "CN" ? "中国" : "美国"} · 公开宏观与市场价格</>} />
      <header className="hidden pb-5 pt-1 lg:block">
        <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">宏观仪表盘</h1>
        <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-[1.7] text-ink-3">
          康德拉季耶夫长波、朱格拉中周期、基钦短周期三个频带，加上黄金与指数基金、原油、CPI/PPI 和大宗商品的价格。数据取自 FRED 与世界银行的公开接口，每天 06:30 采集一次。
        </p>
      </header>

      <Controls country={country} range={range} cycle={cycle} />
      <div className="mt-4 space-y-4">
        <CyclesBlock cycles={data.cycles} country={country} range={range} cycle={cycle} />
        {data.analogues && <AnaloguesBlock data={data.analogues} />}
        {blocks.map((b) => <PlainBlock key={b.key} block={b} />)}
      </div>

      <section aria-label="每日 PEST 报告" className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">每日 PEST 分析</h2>
          <p className="mt-1 text-[12.5px] leading-[1.7] text-ink-4">
            {data.latestReport ? (
              <>
                最近一份：<span className="num">{data.latestReport.at}</span>，按政治、经济、社会、技术四个象限写当天的数据变化。
              </>
            ) : (
              "报告还没有生成（每天 06:40 写一次，采集到足够数据才有）。"
            )}
          </p>
        </div>
        <IntentLink to={`/dashboard/report?scope=${country}`} className="rounded-full border border-line-soft px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-accent">
          查看报告
        </IntentLink>
      </section>

      {!data.sources.fred && (
        <p className="mt-4 rounded-sheet bg-bg-sunk px-4 py-3 text-[12.5px] leading-[1.7] text-ink-3 dark:bg-bg-muted">
          没有配置 FRED_API_KEY，FRED 的序列（CPI、PPI、原油、大宗商品、全要素生产率）都取不到。在 collectors 组里配上它，重启后下一次采集就会补上。
        </p>
      )}
      {!data.sources.market && (
        <p className="mt-3 rounded-sheet bg-bg-sunk px-4 py-3 text-[12.5px] leading-[1.7] text-ink-3 dark:bg-bg-muted">
          没有配置行情 API key（Twelve Data / Polygon / Alpha Vantage 任选一个），黄金与指数基金的价格取不到，那一块就是空的。
        </p>
      )}

      <p className="mt-6 text-[11.5px] leading-[1.8] text-ink-4">
        本站聚合公开数据源并生成图表与摘要，数据可能有误，重要信息请以原始来源为准。图表与报告是事实记录，不预测涨跌，也不构成投资建议。
      </p>
    </div>
  );
}
