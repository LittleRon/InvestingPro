// 主题页（公司与板块）页脚的“近期走势”部件：这个主题近 7 天与前 7 天的收录对比，
// 由模块后端在主题页数据里算出（modules/invest-signals/server.ts 的 topics.page）。
import type { TopicPagePart } from "@aihot/web/modules";
import type { TopicSummary } from "@aihot/contracts/site";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { IconTrendDown, IconTrendUp, IconMinus } from "@aihot/web/components/icons";
import { trendOf } from "../logic.ts";

interface Part {
  current: number;
  prior: number;
  today: number;
  top: { title: string; href: string } | null;
}

const ICON = { up: IconTrendUp, down: IconTrendDown, flat: IconMinus } as const;
const TONE = { up: "text-hot", down: "text-ink-4", flat: "text-ink-4" } as const;

const part: TopicPagePart = {
  name: "近期走势",
  shows: (data) => Boolean(data && (data as Part).current + (data as Part).prior > 0),
  Block({ data }: { data: unknown; topic: TopicSummary }) {
    const p = data as Part;
    const trend = trendOf(p);
    const Icon = ICON[trend];
    const pct = p.prior === 0 ? null : Math.round(((p.current - p.prior) / p.prior) * 100);
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-3">
        <span className={`inline-flex items-center gap-1 font-medium ${TONE[trend]}`}>
          <Icon size={14} />
          {trend === "flat" ? "收录走平" : pct === null ? "近 7 天有新收录" : `较前 7 天${p.current >= p.prior ? "升" : "降"} ${Math.abs(pct)}%`}
        </span>
        <span>
          近 7 天 <span className="num text-ink-2">{p.current}</span> 条
        </span>
        <span>
          前 7 天 <span className="num text-ink-2">{p.prior}</span> 条
        </span>
        {p.today > 0 && <span>今日 <span className="num text-ink-2">{p.today}</span> 条</span>}
        {p.top && (
          <span className="min-w-0">
            最新：
            <IntentLink viewTransition to={p.top.href} className="transition-colors hover:text-accent">
              {p.top.title}
            </IntentLink>
          </span>
        )}
      </div>
    );
  },
  entries: (data) => {
    const p = data as Part | null;
    return p?.top ? [{ title: p.top.title, href: p.top.href }] : [];
  },
  news: (data) => {
    const p = data as Part | null;
    return p?.top ? [`近 7 天收录 ${p.current} 条，前 7 天 ${p.prior} 条`] : [];
  },
};

export default part;
