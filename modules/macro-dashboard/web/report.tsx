// /dashboard/report：每天的 PEST 分析。四个象限的正文由模型写，依据（当天的数据快照）
// 一并给出，读者能自己核对；不写买卖指向、目标价和收益承诺。
import { useLoaderData } from "react-router";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "dashboard", name: "PEST 分析" };
export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

interface ReportResponse {
  scope: string;
  at: string | null;
  model?: string | null;
  payload?: {
    political: string;
    economic: string;
    social: string;
    technological: string;
    watchpoints: string[];
    snapshot: string;
  };
  missing?: string;
}

const SCOPE_NAME: Record<string, string> = { CN: "中国", US: "美国" };

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "US" ? "US" : "CN";
  const at = url.searchParams.get("at");
  const query = new URLSearchParams({ scope });
  if (at && /^\d{4}-\d{2}-\d{2}$/.test(at)) query.set("at", at);
  return cachedPage(300, {
    report: await loadOr404<ReportResponse>(`/api/site/dashboard/report?${query}`, { signal: request.signal }),
    scope: scope as "CN" | "US",
  });
}

export function meta() {
  return pageMeta({ title: "每日 PEST 分析", description: "按政治、经济、社会、技术四个象限记录当天宏观与市场数据变化的每日分析。", path: "/dashboard/report" });
}

const QUADRANTS = [
  { key: "political" as const, letter: "P", name: "政治", note: "财政、货币、监管、贸易与产业政策的当期变化" },
  { key: "economic" as const, letter: "E", name: "经济", note: "价格、能源与大宗商品、指数基金与贵金属，以及三个周期的位置" },
  { key: "social" as const, letter: "S", name: "社会", note: "就业、收入、人口与消费结构" },
  { key: "technological" as const, letter: "T", name: "技术", note: "全要素生产率、研发投入强度、专利申请量" },
];

export default function ReportPage() {
  const { report, scope } = useLoaderData<typeof loader>();
  const at = report.at;
  return (
    <div className="pb-10">
      <PhoneBar title="每日 PEST 分析" large sub={at ? <><span className="num">{at}</span> · {SCOPE_NAME[scope]}</> : SCOPE_NAME[scope]} />
      <header className="hidden pb-5 pt-1 lg:block">
        <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">每日 PEST 分析</h1>
        <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-[1.7] text-ink-3">
          按政治、经济、社会、技术四个象限记录当天的宏观与市场数据变化。写的是事实与观察，不是投资建议。
        </p>
      </header>

      {!at || !report.payload ? (
        <div className="card rounded-sheet">
          <EmptyState title="还没有这一天的报告">{report.missing ?? "每天 06:40 写一次，采集到足够数据才有。"}</EmptyState>
        </div>
      ) : (
        <article className="space-y-4">
          <div className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-[15px] font-semibold text-ink">
                {SCOPE_NAME[scope]} · <span className="num">{at}</span>
              </h2>
              <span className="text-[11.5px] text-ink-4">
                <IntentLink to={`/dashboard?country=${scope}`} className="transition-colors hover:text-accent">仪表盘</IntentLink>
                {report.model && <> · 模型 <span className="num">{report.model}</span></>}
              </span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {QUADRANTS.map((q) => (
                <section key={q.key} aria-label={q.name} className="rounded-sheet bg-bg-sunk px-4 py-3 dark:bg-bg-muted">
                  <h3 className="flex items-baseline gap-2 text-[13.5px] font-semibold text-ink">
                    <span className="num text-[11px] text-ink-4">{q.letter}</span>
                    {q.name}
                  </h3>
                  <p className="mt-1 text-[11px] text-ink-4">{q.note}</p>
                  <p className="mt-2 text-[13px] leading-[1.85] text-ink-2">{report.payload![q.key]}</p>
                </section>
              ))}
            </div>
            {report.payload.watchpoints.length > 0 && (
              <section aria-label="关注要点" className="mt-4">
                <h3 className="text-[13.5px] font-semibold text-ink">关注要点</h3>
                <ul className="mt-2 space-y-1.5 text-[13px] leading-[1.8] text-ink-2">
                  {report.payload.watchpoints.map((w) => (
                    <li key={w} className="flex gap-2">
                      <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-4" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <details className="card disclosure group/basis p-4 sm:p-5">
            <summary className="flex cursor-pointer items-center gap-1.5 text-[13.5px] font-semibold text-ink transition-colors hover:text-accent">
              这份报告依据的数据
            </summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[12px] leading-[1.8] text-ink-3">{report.payload.snapshot}</pre>
          </details>
        </article>
      )}

      <p className="mt-6 text-[11.5px] leading-[1.8] text-ink-4">
        报告由模型基于当天采集到的公开数据写成，可能有误，重要信息请以原始来源为准。它是事实记录与观察清单，不预测涨跌，也不构成投资建议。
      </p>
    </div>
  );
}
