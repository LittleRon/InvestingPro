// /dashboard/allocation/report：AI 解读的独立报告页，与 PEST 报告页逐项对齐——
// 空状态能直接生成、能看到任务失败或跳过的原因、生成中显示进度、完成后有查看入口。
import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { safeInterpretation, safeReportStatus, type SafeInterpretation, type SafeReportStatus } from "../normalize.ts";
import { explainRunStatus } from "../status-text.ts";
import { InterpretationNowButton } from "./report-now.tsx";

export const handle: Screen = { tab: "dashboard", name: "AI 解读报告" };
export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

const BTN = "inline-flex items-center gap-1.5 rounded-full border border-line-soft px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-accent";

/** 解读接口和报告接口一样附带任务运行记录，空状态才能解释「为什么还没有」。 */
function statusOf(raw: unknown): SafeReportStatus | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? safeReportStatus((raw as Record<string, unknown>).status)
    : null;
}

export async function loader({ request }: { request: Request }) {
  // 解读接口 no-store，页面 HTML 也不缓存（cachedPage(0)）；生成完点进来就能看到最新一版。
  const raw = await loadOr404<unknown>("/api/site/dashboard/allocation/interpretation", { signal: request.signal }).catch(() => null);
  return cachedPage(0, {
    interpretation: safeInterpretation(raw),
    status: statusOf(raw),
  });
}

export function meta() {
  return pageMeta({
    title: "AI 解读报告",
    description: "动态组合配置的 AI 解读全文、关注要点与生成依据快照。工具参考，不构成投资建议。",
    path: "/dashboard/allocation/report",
  });
}

const EMPTY_SNAPSHOT = {
  quadrant: "", cycles: "", shortWeights: "", mediumWeights: "", longWeights: "", holdings: "", totalAssets: "", notes: [] as string[],
};

export default function InterpretationReportPage() {
  const loaderData = useLoaderData<typeof loader>();
  // 生成完立刻点进来时，hydration 后补拉一次（接口 no-store），保证看到最新一版和最新状态。
  const [interpretation, setInterpretation] = useState<SafeInterpretation | null>(loaderData.interpretation);
  const [status, setStatus] = useState<SafeReportStatus | null>(loaderData.status);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/site/dashboard/allocation/interpretation", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok || cancelled) return;
        const raw = await res.json() as unknown;
        if (cancelled) return;
        setStatus(statusOf(raw));
        const fresh = safeInterpretation(raw);
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
        <header className="hidden pb-5 pt-1 lg:block">
          <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">AI 解读报告</h1>
        </header>
        <div className="card rounded-sheet">
          <EmptyState
            title="还没有生成 AI 解读报告"
            action={<div className="flex flex-col items-center gap-2"><InterpretationNowButton /></div>}
          >
            每天可生成一版；管理员在这里就能直接生成，不必回到组合配置页。
            <span className="block mt-1 text-ink-3">{explainRunStatus(status, "解读")}</span>
            <span className="block mt-1 text-ink-4">点「生成 AI 解读」后，这里会显示预计等待时间和生成进度；写好后会自动提示并给出查看入口。</span>
          </EmptyState>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <IntentLink to="/dashboard/allocation" className={BTN}>返回组合配置</IntentLink>
        </div>
      </div>
    );
  }

  // 与 PEST 报告页一致：渲染体不直接解引用任何一级字段，缺数据就降级为空。
  const p = interpretation.payload;
  const s = p?.snapshot ?? EMPTY_SNAPSHOT;
  const watchpoints = p?.watchpoints ?? [];
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
          <p className="mt-4 whitespace-pre-wrap text-[13px] leading-[1.85] text-ink-2">{p?.interpretation ?? ""}</p>
        </section>

        {watchpoints.length > 0 && (
          <section className="card p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-ink">关注要点</h2>
            <ul className="mt-3 space-y-2 text-[13px] leading-[1.8] text-ink-2">
              {watchpoints.map((w, i) => (
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
{`当前象限：${s.quadrant ?? ""}

周期位置：${s.cycles ?? ""}

短期权重：${s.shortWeights ?? ""}

中期权重：${s.mediumWeights ?? ""}

长期权重：${s.longWeights ?? ""}

当前持仓：${s.holdings ?? ""}

总资产：${s.totalAssets ?? ""} 元

${(s.notes ?? []).join("\n")}`}
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
