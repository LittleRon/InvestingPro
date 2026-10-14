// /trends：行业趋势。按市场与行业标签统计近 7 天与前 7 天的收录条数，
// 看哪些板块在升温、哪些在降温；每个板块给出当前最热的相关事件。
import { useLoaderData } from "react-router";
import type { TrendsResponse } from "../server.ts";
import { cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { IconTrendDown, IconTrendUp, IconMinus } from "@aihot/web/components/icons";
import type { Screen } from "@aihot/web/components/shell/screens";
import { trendOf, type TrendCounts } from "../logic.ts";

export const handle: Screen = { tab: "trends", name: "趋势" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  return cachedPage(60, { trends: await loadOr404<TrendsResponse>("/api/site/trends", { signal: request.signal }) });
}

export function meta() {
  return pageMeta({
    title: "行业趋势",
    description: "各市场与行业近 7 天与前 7 天的收录变化：哪些板块在升温，哪些在降温，当前最热的相关事件是什么。",
    path: "/trends",
  });
}

const TREND_ICON = { up: IconTrendUp, down: IconTrendDown, flat: IconMinus } as const;
const TREND_TONE = { up: "text-hot", down: "text-ink-4", flat: "text-ink-4" } as const;

/** “↑ 38%”“新增”“持平”：和前 7 天比。 */
function ChangeChip({ counts, trend }: { counts: TrendCounts; trend: "up" | "down" | "flat" }) {
  const pct = counts.prior === 0 ? null : Math.round(((counts.current - counts.prior) / counts.prior) * 100);
  const Icon = TREND_ICON[trend];
  const text = trend === "flat" ? "持平" : pct === null ? "新增" : `${Math.abs(pct)}%`;
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-bg-sunk px-2 text-[11.5px] font-medium tabular-nums dark:bg-bg-muted/60 ${TREND_TONE[trend]}`} title="较前 7 天">
      {trend !== "flat" && <Icon size={13} />}
      {text}
    </span>
  );
}

function SectorRow({ e, max }: { e: TrendsResponse["sectors"][number]; max: number }) {
  const width = max > 0 ? Math.round((e.counts.current / max) * 100) : 0;
  return (
    <li className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-bg-sunk/70 sm:px-5 dark:hover:bg-bg-muted/40">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[15px] font-[650] text-ink">{e.tag}</h2>
          <span className="num text-[13px] text-ink-3">{e.counts.current}</span>
          <span className="text-[11.5px] text-ink-4">条 / 7 天</span>
          <ChangeChip counts={e.counts} trend={e.trend} />
          {e.counts.today > 0 && <span className="hidden text-[11.5px] text-ink-4 sm:inline">今日 <span className="num">{e.counts.today}</span></span>}
        </div>
        <div className="mt-2 h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-bg-sunk dark:bg-bg-muted/60">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
        </div>
        {e.top && (
          <p className="mt-2 line-clamp-1 text-[12.5px] leading-[1.6] text-ink-4">
            <span className="mr-1.5 text-ink-3">当前最热</span>
            <IntentLink viewTransition to={`/story/${e.top.storyPublicId}`} className="transition-colors after:absolute after:inset-0 after:content-[''] hover:text-accent">
              {e.top.title}
            </IntentLink>
          </p>
        )}
      </div>
      <div className="text-right text-[11.5px] text-ink-4">
        前 7 天 <span className="num">{e.counts.prior}</span>
      </div>
    </li>
  );
}

export default function TrendsPage() {
  const { trends } = useLoaderData<typeof loader>();
  const sectors = trends.sectors.filter((e) => e.counts.current + e.counts.prior > 0);
  const max = sectors.reduce((m, e) => Math.max(m, e.counts.current), 0);
  const rising = sectors.filter((e) => trendOf(e.counts) === "up").length;
  return (
    <div className="pb-10">
      <PhoneBar title="行业趋势" large sub={<>近 7 天与前 7 天的收录变化 · {sectors.length} 个板块</>} />
      <header className="hidden flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5 pt-1 lg:flex">
        <div>
          <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">行业趋势</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-[1.7] text-ink-3">
            各市场与行业近 7 天收录的条数，与再往前 7 天比较：升温说明这个方向的信源动态在变多，降温说明关注度在回落。它反映本站信源范围内的报道热度，不代表全市场。
          </p>
        </div>
        <p className="text-[12px] text-ink-4">
          <span className="num">{rising}</span> 个板块升温 · <span className="num">{sectors.length - rising}</span> 个走平或降温
        </p>
      </header>

      {sectors.length === 0 ? (
        <div className="card rounded-sheet">
          <EmptyState title="暂时没有趋势数据">信源还没有产出带板块标签的收录，趋势会在第一批内容入库后出现。</EmptyState>
        </div>
      ) : (
        <ol className="card divide-y divide-line-soft overflow-hidden">
          {sectors.map((e) => (
            <SectorRow key={e.tag} e={e} max={max} />
          ))}
        </ol>
      )}

      <p className="mt-6 text-[12px] leading-[1.75] text-ink-4">
        趋势按本站监测信源的收录量计算，用于观察行业关注度变化，不构成投资建议；重要数据请以官方发布与原文为准。
      </p>
    </div>
  );
}
