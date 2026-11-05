// /dashboard/clock：中国版美林投资时钟。增长轴（PMI 趋势）× 通胀轴（PPI×0.6 + CPI×0.4）的
// 四象限图，标当前位置；政策维度（货币松紧 + 财政积极/收缩）单独指示；各资产大类阶段适配分条形展示；
// 「该做 / 不该做」清单每条带分。纯计算、零模型成本。方法论与局限在页面底部标注。
import { useLoaderData } from "react-router";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import type { ClockResult, AssetKey } from "../clock.ts";

export const handle: Screen = { tab: "dashboard", name: "投资时钟" };
export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  return cachedPage(300, {
    clock: await loadOr404<ClockResult>("/api/site/dashboard/clock", { signal: request.signal }),
  });
}

export function meta() {
  return pageMeta({
    title: "投资时钟",
    description: "以制造业 PMI 趋势与 PPI/CPI 加权通胀定位当前经济象限，给出各资产大类的阶段适配参考与政策维度。中国综合版，不构成投资建议。",
    path: "/dashboard/clock",
  });
}

/** 象限的中文标签与坐标位置（用于在 2×2 图上标注）。 */
const QUAD_POS: Record<string, { x: number; y: number; label: string }> = {
  recovery: { x: 0.75, y: 0.78, label: "复苏" },
  overheat: { x: 0.25, y: 0.78, label: "过热" },
  stagflation: { x: 0.25, y: 0.22, label: "滞胀" },
  recession: { x: 0.75, y: 0.22, label: "衰退" },
};

/** 资产分条形图的颜色。 */
const BAR_TONES: Record<AssetKey, string> = {
  stocks: "text-hot",
  bonds: "text-accent",
  commodities: "text-ink-3",
  cash: "text-ink-4",
  gold: "text-amber",
};

/** 2×2 象限图：增长轴水平（左低右高），通胀轴垂直（上高下低）。当前位置用圆点标出。 */
function QuadrantChart({ clock }: { clock: ClockResult }) {
  const W = 560;
  const H = 420;
  const PAD = 40;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const cx = PAD + innerW * 0.5;
  const cy = PAD + innerH * 0.5;
  // 当前位置：growth trend 映射到水平（-4→0, +4→1），inflation 映射到垂直（+6→0.5, -6→1.5）。
  const g = Math.max(-1, Math.min(1, clock.growth.trend / 4));
  const infl = Math.max(-1, Math.min(1, clock.inflation.value / 6));
  // x: 0（左）到 1（右）；y: 0（上）到 1（下）。高通胀在上。
  const px = cx + g * (innerW / 2 - 8);
  const py = cy - infl * (innerH / 2 - 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="美林投资时钟四象限">
      {/* 象限背景 */}
      <rect x={PAD} y={PAD} width={innerW / 2} height={innerH / 2} fill="currentColor" className="text-bg-sunk" />
      <rect x={PAD + innerW / 2} y={PAD} width={innerW / 2} height={innerH / 2} fill="currentColor" className="text-bg-sunk dark:text-bg-muted" />
      <rect x={PAD} y={PAD + innerH / 2} width={innerW / 2} height={innerH / 2} fill="currentColor" className="text-bg-sunk dark:text-bg-muted" />
      <rect x={PAD + innerW / 2} y={PAD + innerH / 2} width={innerW / 2} height={innerH / 2} fill="currentColor" className="text-bg-sunk" />
      {/* 分割线 */}
      <line x1={cx} y1={PAD} x2={cx} y2={H - PAD} stroke="currentColor" className="text-line" strokeWidth={1.5} />
      <line x1={PAD} y1={cy} x2={W - PAD} y2={cy} stroke="currentColor" className="text-line" strokeWidth={1.5} />
      {/* 零轴（荣枯线 / 通胀中值） */}
      <line x1={cx} y1={cy} x2={cx + 30} y2={cy} stroke="currentColor" className="text-ink-4" strokeWidth={1} strokeDasharray="2 2" />
      <line x1={cx} y1={cy} x2={cx} y2={cy - 30} stroke="currentColor" className="text-ink-4" strokeWidth={1} strokeDasharray="2 2" />
      {/* 象限标签 */}
      {Object.entries(QUAD_POS).map(([key, pos]) => (
        <text key={key} x={(PAD + innerW) * pos.x} y={(PAD + innerH) * pos.y} textAnchor="middle" className="fill-ink-3 text-[15px] font-semibold">
          {pos.label}
        </text>
      ))}
      {/* 当前位置 */}
      <circle cx={px} cy={py} r={9} fill="currentColor" className="text-accent" />
      <circle cx={px} cy={py} r={9} fill="none" stroke="currentColor" className="text-accent" strokeWidth={2} opacity={0.4} />
      {/* 轴标签 */}
      <text x={cx} y={H - PAD + 24} textAnchor="middle" className="fill-ink-4 text-[11px]">高增长 →</text>
      <text x={cx} y={PAD - 12} textAnchor="middle" className="fill-ink-4 text-[11px]">← 高通胀</text>
      <text x={cx + innerW / 2 - 8} y={cy - 6} textAnchor="end" className="fill-ink-4 text-[10px]">高通胀 ↑</text>
      <text x={PAD + 8} y={cy - 6} className="fill-ink-4 text-[10px]">低通胀 ↑</text>
      <text x={PAD + innerW / 2 - 8} y={cy + innerH / 2 - 6} textAnchor="end" className="fill-ink-4 text-[10px]">低通胀 ↓</text>
      <text x={PAD + 8} y={cy + innerH / 2 - 6} className="fill-ink-4 text-[10px]">低通胀 ↓</text>
    </svg>
  );
}

/** 资产大类适配分条形图。 */
function ScoreBars({ scores }: { scores: { key: AssetKey; name: string; score: number }[] }) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  return (
    <div className="space-y-2.5">
      {sorted.map((s) => (
        <div key={s.key} className="flex items-center gap-2.5">
          <span className="w-20 shrink-0 text-[12.5px] text-ink-3">{s.name}</span>
          <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-bg-sunk dark:bg-bg-muted">
            <div
              className={`flex h-full items-center justify-end rounded-md px-2 ${BAR_TONES[s.key]}`}
              style={{ width: `${Math.max(8, (s.score / 100) * 100)}%` }}
            >
              <span className="text-[11px] font-medium text-white dark:text-bg">{s.score.toFixed(0)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 货币政策松紧指示条。 */
function MonetaryGauge({ score, label, value, at }: { score: number; label: string; value: number | null; at: string | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink">货币政策</span>
        <span className={`text-[12.5px] font-medium ${score >= 60 ? "text-hot" : score <= 40 ? "text-ink-3" : "text-ink-2"}`}>
          {label}{value !== null && `（M0 同比 ${value.toFixed(1)}%）`}
        </span>
      </div>
      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-bg-sunk dark:bg-bg-muted">
        <div
          className={`h-full rounded-full ${score >= 60 ? "bg-hot/30" : score >= 40 ? "bg-accent/30" : "bg-ink-4/30"}`}
          style={{ width: `${score}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-4">
          <span>收紧</span>
          <span className="mx-auto">中性</span>
          <span className="ml-auto">宽松</span>
        </div>
      </div>
      {at && <span className="mt-1 block text-[11px] text-ink-4">截至 {at}</span>}
    </div>
  );
}

/** 该做 / 不该做清单。 */
function DoDont({ clock }: { clock: ClockResult }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-sheet bg-bg-sunk p-4 dark:bg-bg-muted">
        <h3 className="text-[13px] font-semibold text-hot">该做（阶段偏好）</h3>
        <ul className="mt-2 space-y-1.5">
          {clock.doDont.do.map((d) => (
            <li key={d.asset} className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-2">{d.name}</span>
              <span className="num text-hot">{d.score.toFixed(0)} 分</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-sheet bg-bg-sunk p-4 dark:bg-bg-muted">
        <h3 className="text-[13px] font-semibold text-ink-3">谨慎（阶段偏低）</h3>
        <ul className="mt-2 space-y-1.5">
          {clock.doDont.dont.map((d) => (
            <li key={d.asset} className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-2">{d.name}</span>
              <span className="num text-ink-3">{d.score.toFixed(0)} 分</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function ClockPage() {
  const { clock } = useLoaderData<typeof loader>();

  return (
    <div className="pb-10">
      <PhoneBar title="投资时钟" large sub={<>中国综合版 · <span className="num">{clock.quadrantName}</span></>} />
      <header className="hidden pb-5 pt-1 lg:block">
        <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">投资时钟</h1>
        <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-[1.7] text-ink-3">
          以制造业 PMI 趋势定增长、PPI 与 CPI 加权定通胀，定位当前经济象限。纯计算，零模型成本。
        </p>
      </header>

      <div className="space-y-4">
        {/* 当前象限 + 读数 */}
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-semibold text-ink">当前位置：<span className="text-accent">{clock.quadrantName}</span></h2>
            <IntentLink to="/dashboard" className="text-[11.5px] text-ink-4 transition-colors hover:text-accent">仪表盘 →</IntentLink>
          </div>
          <div className="mt-3 grid gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
            <span>
              增长 <span className="num font-medium text-ink-2">{clock.growth.trend !== null && Number.isFinite(clock.growth.trend) ? `${clock.growth.trend > 0 ? "+" : ""}${clock.growth.trend} 点` : "—"}</span>
              <span className="ml-2 text-ink-4">{clock.growth.label}</span>
              {clock.growth.at && <span className="ml-2 text-ink-4">（PMI {clock.growth.at}）</span>}
            </span>
            <span>
              通胀 <span className="num font-medium text-ink-2">{clock.inflation.value !== null ? `${clock.inflation.value > 0 ? "+" : ""}${clock.inflation.value}%` : "—"}</span>
              <span className="ml-2 text-ink-4">{clock.inflation.label}</span>
              {clock.inflation.at && <span className="ml-2 text-ink-4">（{clock.inflation.at}）</span>}
            </span>
          </div>
          <div className="mt-4">
            <QuadrantChart clock={clock} />
          </div>
        </section>

        {/* 资产适配分 */}
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-semibold text-ink">资产大类阶段适配分</h2>
            <span className="text-[11.5px] text-ink-4">0–100，越高越适配当前阶段</span>
          </div>
          <div className="mt-4">
            <ScoreBars scores={clock.assetScores} />
          </div>
        </section>

        {/* 该做 / 不该做 */}
        <section className="card p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink">该做 / 谨慎</h2>
          <p className="mt-1 text-[12px] text-ink-4">阶段适配偏好，不是买卖指令。</p>
          <div className="mt-4">
            <DoDont clock={clock} />
          </div>
        </section>

        {/* 政策维度 */}
        <section className="card p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink">政策维度</h2>
          <div className="mt-4 space-y-5">
            <MonetaryGauge
              score={clock.policy.monetary.score}
              label={clock.policy.monetary.label}
              value={clock.policy.monetary.value}
              at={clock.policy.monetary.at}
            />
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-ink">财政政策</span>
                <span className={`text-[12.5px] font-medium ${clock.policy.fiscal.score >= 60 ? "text-hot" : clock.policy.fiscal.score <= 40 ? "text-ink-3" : "text-ink-2"}`}>
                  {clock.policy.fiscal.label}{clock.policy.fiscal.value !== null && `（收入同比 ${clock.policy.fiscal.value.toFixed(1)}%）`}
                </span>
              </div>
              <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-bg-sunk dark:bg-bg-muted">
                <div
                  className={`h-full rounded-full ${clock.policy.fiscal.score >= 60 ? "bg-hot/30" : clock.policy.fiscal.score >= 40 ? "bg-accent/30" : "bg-ink-4/30"}`}
                  style={{ width: `${clock.policy.fiscal.score}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-4">
                  <span>收缩</span>
                  <span className="mx-auto">中性</span>
                  <span className="ml-auto">积极</span>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-ink-4">{clock.policy.fiscal.note}{clock.policy.fiscal.at && ` · 截至 ${clock.policy.fiscal.at}`}</p>
            </div>
          </div>
        </section>

        {/* 方法论说明 */}
        <details className="card disclosure p-4 sm:p-5">
          <summary className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink transition-colors hover:text-accent">
            方法论与局限
          </summary>
          <div className="mt-3 space-y-2 text-[12px] leading-[1.8] text-ink-3">
            {clock.notes.map((n) => <p key={n}>{n}</p>)}
            <p className="text-ink-4">
              时钟是回顾性定位工具：用历史数据判断当前所处阶段，不预测未来走势。象限边界上的资产分平滑变化（重心插值），不是非此即彼。
              数据来自公开统计源，可能有误或滞后，重要信息以原始来源为准。不构成投资建议。
            </p>
          </div>
        </details>
      </div>

      <p className="mt-6 text-[11.5px] leading-[1.8] text-ink-4">
        本页为工具参考，给框架与阶段偏好，不构成投资建议，不预测涨跌。数据取自公开统计源并按中国实际调整口径。
      </p>
    </div>
  );
}
