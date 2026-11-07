// /dashboard/allocation/report：AI 解读的独立报告页。与 PEST 报告的「查看报告」对齐，
// 读者和管理员生成完成后可以直接点进去，不必在组合配置页里往下找。
import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { safeInterpretation, type SafeInterpretation } from "../normalize.ts";

export const handle: Screen = { tab: "dashboard", name: "AI 解读报告" };
export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

const BTN = "inline-flex items-center gap-1.5 rounded-full border border-line-soft px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-accent";

export async function loader({ request }: { request: Request }) {
  // 解读接口是 no-store，页面自身也不缓存，生成完点进来就能看到最新一版。
  const raw = await loadOr404<unknown>("/api/site/dashboard/allocation/interpretation", { signal: request.signal }).catch(() => null);
  return cachedPage(0, { interpretation: safeInterpretation(raw) });
}

export function meta() {
  return pageMeta({
    title: "AI 解读报告",
    description: "动态组合配置的 AI 解读全文、关注要点与生成依据快照。工具参考，不构成投资建议。",
    path: "/dashboard/allocation/report",
  });
}

export default function InterpretationReportPage() {
  const loaderData = useLoaderData<typeof loader>();
  // 生成完立刻点进来时，hydration 后补拉一次（接口 no-store），保证看到最新一版。
  const [interpretation, setInterpretation] = useState<SafeInterpretation | null>(loaderData.interpretation);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/site/dashboard/allocation/interpretation", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok || cancelled) return;
        const fresh = safeInterpretation(await res.json());
        if (fresh && (!interpretation || fresh.generation > interpretation.generation)) setInterpretation(fresh);
      } catch { /* 网络抖动，用 SSR 那份 */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!interpretation) {
    return (
      <div className="pb-10">
        <PhoneBar title="AI 解读报告" large sub="动态组合配置" />
        <div className="card rounded-sheet">
          <EmptyState title="还没有生成 AI 解读报告" action={<IntentLink to="/dashboard/allocation" className={BTN}>去组合配置生成</IntentLink>}>
            每天可生成一版；需要管理员登录后在组合配置页点「生成 AI 解读」。
          </EmptyState>
        </div>
      </div>
    );
  }

  const p = interpretation.payload;
  const s = p.snapshot;
  return (
    <div className="pb-10">
      <PhoneBar title="AI 解读报告" large sub={<>生成于 <span className="num">{interpretation.at}</span></>} />
      <header className="hidden pb-5 pt-1 lg:block">
        <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink">AI 解读报告</h1>
        <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-[1.7] text-ink-3">
          基于投资时钟与经济周期位置撰写的组合配置解读。规则引擎算权重，AI 只写解读，不重算权重。
        </p>
      </header>

      <div className="space-y-4">
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-semibold text-ink">解读正文</h2>
            <span className="text-[11.5px] text-ink-4">
              第 {interpretation.generation} 版{interpretation.model ? <> · 模型 <span className="num">{interpretation.model}</span></> : null}
            </span>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-[13px] leading-[1.85] text-ink-2">{p.interpretation}</p>
        </section>

        {p.watchpoints.length > 0 && (
          <section className="card p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-ink">关注要点</h2>
            <ul className="mt-3 space-y-2 text-[13px] leading-[1.8] text-ink-2">
              {p.watchpoints.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <details className="card disclosure p-4 sm:p-5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[13.5px] font-semibold text-ink transition-colors hover:text-accent">
            这份解读依据的数据
          </summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[12px] leading-[1.8] text-ink-3">
{`当前象限：${s.quadrant}

周期位置：${s.cycles}

短期权重：${s.shortWeights}

中期权重：${s.mediumWeights}

长期权重：${s.longWeights}

当前持仓：${s.holdings}

总资产：${s.totalAssets} 元

${s.notes.join("\n")}`}
          </pre>
        </details>

        <div className="flex flex-wrap gap-3">
          <IntentLink to="/dashboard/allocation" className={BTN}>返回组合配置</IntentLink>
          <IntentLink to="/dashboard/report?scope=CN" className={BTN}>查看 PEST 报告</IntentLink>
        </div>
      </div>

      <p className="mt-6 text-[11.5px] leading-[1.8] text-ink-4">
        本页为工具参考，不构成投资建议，不预测涨跌。解读由模型生成，可能有误，重要信息请以原始来源为准。
      </p>
    </div>
  );
}
