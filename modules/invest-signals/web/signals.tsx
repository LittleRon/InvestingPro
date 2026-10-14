// /signals：信号置信度榜。每条当前热点事件按“来源强度 + 交叉印证 + 讨论佐证”算出 0–100 的
// 信号置信度，衡量这条消息有多可核查；页面同时给出监测概览，并写明置信度不是投资建议。
import { useLoaderData } from "react-router";
import type { SignalsResponse } from "../server.ts";
import { cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { monthDayTime } from "@aihot/web/lib/format";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { Badge } from "@aihot/web/components/ui/Badge";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { Delta } from "@aihot/web/features/hot/Delta";
import type { Screen } from "@aihot/web/components/shell/screens";
import { CONFIDENCE_LABEL, CONFIDENCE_METHOD } from "../logic.ts";

export const handle: Screen = { tab: "signals", name: "信号" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  return cachedPage(60, { signals: await loadOr404<SignalsResponse>("/api/site/signals", { signal: request.signal }) });
}

export function meta() {
  return pageMeta({
    title: "信号置信度榜",
    description: "当前热点事件的可核查程度：来源分级、独立报道方数量与讨论佐证合成的信号置信度。不是投资建议。",
    path: "/signals",
  });
}

const LEVEL_TONE = { high: "hot", medium: "accent", low: "neutral" } as const;

function StatCard({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] text-ink-4">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="num text-[22px] font-semibold leading-none text-ink">{value}</span>
        {unit && <span className="text-[12px] text-ink-4">{unit}</span>}
      </div>
    </div>
  );
}

/** 置信度三段构成：来源强度 / 交叉印证 / 讨论佐证，各按满分归一。 */
function Parts({ parts }: { parts: { evidence: number; cross: number; discussion: number } }) {
  const rows: Array<[string, number, number]> = [
    ["来源强度", parts.evidence, 50],
    ["交叉印证", parts.cross, 30],
    ["讨论佐证", parts.discussion, 20],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {rows.map(([label, value, max]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11.5px] text-ink-4" title={`${label} ${value}/${max}`}>
          {label}
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-bg-sunk dark:bg-bg-muted/60">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((value / max) * 100)}%` }} />
          </span>
          <span className="num text-ink-3">{value}</span>
        </span>
      ))}
    </div>
  );
}

function SignalRow({ s }: { s: SignalsResponse["signals"][number] }) {
  return (
    <li className="group relative px-4 py-4 transition-colors hover:bg-bg-sunk/70 sm:px-5 dark:hover:bg-bg-muted/40">
      <div className="flex items-start gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center">
          <span className="num text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink">{s.confidence.score}</span>
          <span className="mt-1 text-[10.5px] text-ink-4">置信度</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={LEVEL_TONE[s.confidence.level]}>{CONFIDENCE_LABEL[s.confidence.level]}</Badge>
            <h2 className="text-[15px] font-[650] leading-[1.5] text-ink">
              <IntentLink viewTransition to={`/story/${s.storyPublicId}`} className="transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-accent">
                {s.title}
              </IntentLink>
            </h2>
          </div>
          {s.summary && <p className="mt-1 line-clamp-2 text-[13px] leading-[1.65] text-ink-4">{s.summary}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-4">
            <span className="whitespace-nowrap"><span className="num">{s.editorialCount}</span> 家报道方</span>
            <span className="whitespace-nowrap">官方一手 <span className="num">{s.officialCount}</span> 家</span>
            <span className="whitespace-nowrap"><span className="num">{s.participantCount}</span> 位参与者</span>
            <span className="whitespace-nowrap">热度 <span className="num">{Math.round(s.heat)}</span></span>
            <Delta trend={s.trend} pct={s.trendPct} />
          </div>
          <Parts parts={s.confidence.parts} />
        </div>
      </div>
    </li>
  );
}

export default function SignalsPage() {
  const { signals } = useLoaderData<typeof loader>();
  const { stats, computedAt } = signals;
  return (
    <div className="pb-10">
      <PhoneBar
        title="信号置信度"
        large
        sub={<>{computedAt ? <><span className="num">{monthDayTime(computedAt)}</span> 更新 · </> : null}按可核查程度排序</>}
      />
      <header className="hidden flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5 pt-1 lg:flex">
        <div>
          <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">信号置信度榜</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-[1.7] text-ink-3">
            当前热点事件按来源分级、独立报道方数量与讨论佐证合成的 0–100 置信度。它衡量消息的可核查程度，不预测涨跌，也不是投资建议。
          </p>
        </div>
        {computedAt && (
          <p className="text-[12px] text-ink-4">
            <span className="num">{monthDayTime(computedAt)}</span> 更新
          </p>
        )}
      </header>

      <section aria-label="监测概览" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="监测信源" value={stats.sources} unit="个" />
        <StatCard label="官方一手信源" value={stats.officialSources} unit="个" />
        <StatCard label="今日新增收录" value={stats.todayItems} unit="条" />
        <StatCard label="48 小时活跃事件" value={stats.activeStories} unit="件" />
        <StatCard label="高置信度信号" value={stats.highConfidence} unit="条" />
      </section>

      {signals.signals.length === 0 ? (
        <div className="card mt-6 rounded-sheet">
          <EmptyState title="暂时没有可评信号">还没有足够多来源共同讨论的事件，先让信源跑一会儿。</EmptyState>
        </div>
      ) : (
        <section aria-label="信号列表" className="mt-6">
          <ol className="card divide-y divide-line-soft overflow-hidden">
            {signals.signals.map((s) => (
              <SignalRow key={s.storyPublicId} s={s} />
            ))}
          </ol>
        </section>
      )}

      <details className="disclosure group/method mt-8 text-[12px] text-ink-4">
        <summary className="flex items-center gap-1.5 py-1 transition-colors hover:text-ink-2">置信度是怎么算的？</summary>
        <div className="max-w-[760px] space-y-2 pb-2 pl-[21px] pt-2 leading-[1.75] text-ink-3">
          {CONFIDENCE_METHOD.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p>
            置信度随信源构成实时变化：同一件事，官方一手与多家独立报道方同时在时最高；只有转载、讨论或单一账号爆料时最低。它回答“这条消息有多可核查”，
            不回答“该不该交易”。
          </p>
          <p className="text-ink-4">
            本站聚合公开信源并生成中文摘要，内容可能有误，重要信息请以原文为准；本站不提供投资建议，不构成任何证券、基金或衍生品的买卖推荐。
          </p>
        </div>
      </details>
    </div>
  );
}
