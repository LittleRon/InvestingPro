// /dashboard/clock：中国版美林投资时钟。增长轴（PMI 趋势）× 通胀轴（PPI×0.6 + CPI×0.4）映射为
// 圆形时钟——12 点为顶（高通胀）、3 点为右（高增长）、6 点为底（低通胀）、9 点为左（低增长），
// 四个象限按 45° 边界划分，当前位置用指针标出。政策维度（货币松紧 + 财政积极/收缩）单独指示；
// 各资产大类阶段适配分条形展示；「该做 / 不该做」清单每条带分。纯计算、零模型成本。方法论与局限在
// 页面底部标注。
import { useLoaderData } from "react-router";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
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

/**
 * 圆形美林投资时钟。坐标映射：
 *   增长轴 → 水平方向（左低右高）：g = clamp(growthTrend/4, -1, 1)
 *   通胀轴 → 垂直方向（上高下低）：infl = clamp(inflation/6, -1, 1)
 *   位置 = (g, infl)，投影到圆上（半径 RIMG），用指针标出当前位置。
 *   四个象限沿 45° 对角线划分：复苏（右下 315°→360°/0°）、过热（右上 45°→135°）、
 *   滞胀（左上 135°→225°）、衰退（左下 225°→315°）。
 */
const DIAG = Math.SQRT1_2;

function CircularClock({ clock }: { clock: ClockResult }) {
  const W = 440;
  const H = 440;
  const cx = 220;
  const cy = 220;
  const R = 168; // 外环半径
  const RIMG = 130; // 指针最大长度（单位圆映射半径）

  // 当前位置计算
  const g = Number.isFinite(clock.growth.trend) ? Math.max(-1, Math.min(1, clock.growth.trend / 4)) : 0;
  const infl = Number.isFinite(clock.inflation.value) ? Math.max(-1, Math.min(1, clock.inflation.value / 6)) : 0;
  const mag = Math.hypot(g, infl);
  const gc = mag > 1 ? g / mag : g;
  const ic = mag > 1 ? infl / mag : infl;
  const px = cx + gc * RIMG;
  const py = cy - ic * RIMG;

  // 用弧度坐标直接画扇形
  function arcSector(r1: number, r2: number, r = R): string {
    const p1 = [cx + Math.cos(r1) * r, cy - Math.sin(r1) * r];
    const p2 = [cx + Math.cos(r2) * r, cy - Math.sin(r2) * r];
    const largeArc = Math.abs(r2 - r1) > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} Z`;
  }

  // 四个象限扇形（45° 对角线边界）：单位圆上四个角坐标
  // 复苏（右下）：(DIAG, -DIAG)，角度 -45° = 315°
  // 过热（右上）：(DIAG, DIAG)，角度 45°
  // 滞胀（左上）：(-DIAG, DIAG)，角度 135°
  // 衰退（左下）：(-DIAG, -DIAG)，角度 225°

  // 角度（度数）转弧度
  const degToRad = (d: number) => (d * Math.PI) / 180;

  // 象限扇形边界角度（以 atan2 为基准，0°=右，90°=上，180°=左，270°=下）
  // 复苏：270° → 360°/0°（右下）
  // 过热：0° → 90°（右上）
  // 滞胀：90° → 180°（左上）
  // 衰退：180° → 270°（左下）

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="美林投资时钟圆形表">
      {/* 四象限扇形区域 */}
      <path d={arcSector(degToRad(270), degToRad(360))} fill="currentColor" className="fill-accent/8" />
      <path d={arcSector(degToRad(0), degToRad(90))} fill="currentColor" className="fill-amber/8" />
      <path d={arcSector(degToRad(90), degToRad(180))} fill="currentColor" className="fill-ink-4/8" />
      <path d={arcSector(degToRad(180), degToRad(270))} fill="currentColor" className="fill-hot/8" />

      {/* 外环 */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="currentColor" className="stroke-line" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={R - 6} fill="none" stroke="currentColor" className="stroke-line/50" strokeWidth={0.75} strokeDasharray="2 3" />

      {/* 12 只刻度线（时钟风格） */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = degToRad(i * 30 - 90); // 从 12 点开始顺时针
        const long = i % 3 === 0;
        const len = long ? 12 : 6;
        const start = [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
        const end = [cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len)];
        return (
          <line key={i} x1={start[0].toFixed(1)} y1={start[1].toFixed(1)} x2={end[0].toFixed(1)} y2={end[1].toFixed(1)}
            stroke="currentColor" className={long ? "fill-ink-3" : "fill-ink-4/60"} strokeWidth={long ? 2 : 1} strokeLinecap="round" />
        );
      })}

      {/* 四个主象限标记点（3/6/9/12 点的大块） */}
      {[0, 90, 180, 270].map((angle) => {
        const a = degToRad(angle);
        return (
          <circle key={angle} cx={(cx + Math.cos(a) * (R - 22)).toFixed(1)} cy={(cy + Math.sin(a) * (R - 22)).toFixed(1)}
            r={4} fill="currentColor" className="fill-ink-3" />
        );
      })}

      {/* 十字轴虚线 */}
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="currentColor" className="fill-ink-4/30" strokeWidth={0.75} strokeDasharray="3 3" />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="currentColor" className="fill-ink-4/30" strokeWidth={0.75} strokeDasharray="3 3" />

      {/* 对角线分界虚线（45° 轴） */}
      <line x1={cx - R * DIAG} y1={cy - R * DIAG} x2={cx + R * DIAG} y2={cy + R * DIAG} stroke="currentColor" className="fill-ink-4/20" strokeWidth={0.5} strokeDasharray="2 4" />
      <line x1={cx + R * DIAG} y1={cy - R * DIAG} x2={cx - R * DIAG} y2={cy + R * DIAG} stroke="currentColor" className="fill-ink-4/20" strokeWidth={0.5} strokeDasharray="2 4" />

      {/* 象限标签（对角位置，48% 半径处） */}
      {[
        { gx: DIAG, gy: -DIAG, label: "复 苏", cls: "fill-accent/50" },
        { gx: DIAG, gy: DIAG, label: "过 热", cls: "fill-amber/50" },
        { gx: -DIAG, gy: DIAG, label: "滞 胀", cls: "fill-ink-4/60" },
        { gx: -DIAG, gy: -DIAG, label: "衰 退", cls: "fill-hot/50" },
      ].map(({ gx, gy, label, cls }) => (
        <text key={label} x={cx + gx * R * 0.48} y={cy - gy * R * 0.48 + 5} textAnchor="middle"
          className={`text-[13px] font-semibold tracking-[0.1em] ${cls}`}>{label}</text>
      ))}

      {/* 轴标签（外环外侧） */}
      <text x={cx + R + 10} y={cy + 4} className="fill-ink-4 text-[11px]">高增长 →</text>
      <text x={cx - R - 10} y={cy + 4} textAnchor="end" className="fill-ink-4 text-[11px]">← 低增长</text>
      <text x={cx} y={cy - R - 8} textAnchor="middle" className="fill-ink-4 text-[11px]">↑ 高通胀</text>
      <text x={cx} y={cy + R + 16} textAnchor="middle" className="fill-ink-4 text-[11px]">低通胀 ↓</text>

      {/* 指针线（从中心到当前位置） */}
      <line x1={cx} y1={cy} x2={px.toFixed(1)} y2={py.toFixed(1)} stroke="currentColor"
        className="fill-accent" strokeWidth={1.5} strokeLinecap="round" opacity={0.4} />
      {/* 当前位置外耀 */}
      <circle cx={px.toFixed(1)} cy={py.toFixed(1)} r={10} fill="currentColor" className="fill-accent" opacity={0.15} />
      {/* 当前位置主点 */}
      <circle cx={px.toFixed(1)} cy={py.toFixed(1)} r={6} fill="currentColor" className="fill-accent" stroke="currentColor" strokeWidth={1.5} className="stroke-bg" />
      {/* 中心点 */}
      <circle cx={cx} cy={cy} r={3} fill="currentColor" className="fill-ink-4" />
    </svg>
  );
}

/** 资产大类适配分条形图。 */
const BAR_TONES_COLOR: Record<AssetKey, string> = {
  stocks: "bg-hot",
  bonds: "bg-accent",
  commodities: "bg-amber",
  cash: "bg-ink-4",
  gold: "bg-yellow-500",
};

function ScoreBars({ scores }: { scores: { key: AssetKey; name: string; score: number }[] }) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  return (
    <div className="space-y-2.5">
      {sorted.map((s) => {
        const w = Math.max(10, (s.score / 100) * 100);
        return (
          <div key={s.key} className="flex items-center gap-2.5">
            <span className="w-20 shrink-0 text-[12.5px] text-ink-3">{s.name}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-bg-sunk dark:bg-bg-muted">
              <div
                className={`flex h-full items-center justify-end rounded-md px-2 ${BAR_TONES_COLOR[s.key]}/25`}
                style={{ width: `${w}%` }}
              >
                <span className="text-[11px] font-medium text-ink">{s.score.toFixed(0)}</span>
              </div>
            </div>
          </div>
        );
      })}
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
            <CircularClock clock={clock} />
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
