// 仪表盘的折线图。手写 SVG，不引图表库：这些图只用来看走势和位置，
// 不需要缩放拖拽那一套。颜色交给 CSS 类（stroke 用 currentColor），深浅色外观都跟着变。
//
// 一条线可以被高亮（粗、不透明），其余的压成陪衬（细、半透明）；鼠标移到图上会读出
// 那一刻每条线的值。哪条线是哪条由调用方决定——叠加那条要高亮，它底下的三条要压下去，
// 否则四根线一样重，看的人分不出主次。
import { useState } from "react";
import type { Point } from "../logic.ts";

export interface Line {
  key: string;
  name: string;
  /** 折线的颜色类，比如 text-accent；stroke 取 currentColor。 */
  tone: string;
  points: Point[];
  /** 从这一天起末端是估计值，按虚线画。 */
  dashedFrom?: string | null;
  /** 线宽，默认 1.6。被高亮的那条给 2.6 左右才压得住其余的。 */
  width?: number;
  /** 压成陪衬：细一点、半透明，让被高亮的那条站出来。 */
  muted?: boolean;
}

const W = 820;
const PAD = { left: 46, right: 10, top: 12, bottom: 24 };
/** 读数的提示框：宽固定，高按行数算。 */
const TIP_W = 168;
const TIP_ROW = 15;

/** 值的写法：价格类两位小数，大额用千分位，百分比自己带符号。 */
export function fmtValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 10000) return Math.round(value).toLocaleString("zh-CN");
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(2);
}

function extent(lines: Line[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const line of lines) {
    for (const p of line.points) {
      if (!Number.isFinite(p.value)) continue;
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  }
  if (min === Infinity) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** 日期之间按真实间隔排布（月度年度的点间距不等，按时间戳线性映射才不会挤在一起）。 */
function timeRange(lines: Line[]): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  for (const line of lines) {
    for (const p of line.points) {
      const t = Date.parse(p.at);
      if (!Number.isFinite(t)) continue;
      if (t < from) from = t;
      if (t > to) to = t;
    }
  }
  return from === Infinity ? null : { from, to };
}

function ticks(min: number, max: number, count = 4): number[] {
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

/** x 轴上的几个日期标签：首、末和中间两个，多了会挤。 */
function dateLabels(from: number, to: number): { at: number; label: string }[] {
  const span = to - from;
  const sameYear = new Date(from).getUTCFullYear() === new Date(to).getUTCFullYear();
  const label = (t: number) => {
    const d = new Date(t);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    return span > 5 * 365 * 86_400_000 || sameYear === false && span > 365 * 86_400_000 ? `${year}` : span > 90 * 86_400_000 ? `${year}-${month}` : `${month}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  return [0, 1 / 3, 2 / 3, 1].map((f) => ({ at: from + span * f, label: label(from + span * f) }));
}

export function LineChart({
  lines,
  height = 190,
  /** 在 0 上画一条基准线（周期图看正负位置时有用）。 */
  zero = false,
  emptyText = "还没有数据",
}: { lines: Line[]; height?: number; zero?: boolean; emptyText?: string }): React.ReactElement {
  // 鼠标落在哪个时点上；null 是不悬停。悬停只影响读数，不改变画什么。
  const [hoverAt, setHoverAt] = useState<string | null>(null);
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const range = timeRange(lines);
  const { min, max } = extent(lines);
  if (!range) {
    return (
      <div className="flex h-[120px] items-center justify-center text-[12.5px] text-ink-4">{emptyText}</div>
    );
  }
  const x = (at: string) => PAD.left + ((Date.parse(at) - range.from) / (range.to - range.from || 1)) * innerW;
  const y = (value: number) => PAD.top + (1 - (value - min) / (max - min)) * innerH;

  const solid = (line: Line) => line.points.filter((p) => Number.isFinite(p.value));
  const dashed = (line: Line) => (line.dashedFrom ? solid(line).filter((p) => p.at >= line.dashedFrom!) : []);
  const path = (points: Point[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");

  // 所有线上出现过的日期，排序后用来找离鼠标最近的那个时点。
  const dates = [...new Set(lines.flatMap((l) => solid(l).map((p) => p.at)))].sort();
  const pick = (clientX: number, box: DOMRect) => {
    // 页面上的宽度是缩放过的：先换回 viewBox 的坐标，再扣掉左边的轴。
    const svgX = ((clientX - box.left) / (box.width || 1)) * W;
    const t = range.from + ((svgX - PAD.left) / (innerW || 1)) * (range.to - range.from);
    let best: string | null = null;
    let bestGap = Infinity;
    for (const at of dates) {
      const gap = Math.abs(Date.parse(at) - t);
      if (gap < bestGap) { bestGap = gap; best = at; }
    }
    return best;
  };

  // 提示框贴着读数那一列，右边放不下就翻到左边。
  const tipX = hoverAt ? (x(hoverAt) + 12 + TIP_W > W - PAD.right ? x(hoverAt) - 12 - TIP_W : x(hoverAt) + 12) : 0;
  const tipRows = hoverAt ? lines.map((l) => ({ line: l, point: solid(l).find((p) => p.at === hoverAt) })) : [];
  const tipH = 22 + tipRows.length * TIP_ROW + 6;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full touch-none"
      role="img"
      aria-label={lines.map((l) => l.name).join("、")}
      onMouseMove={(e) => setHoverAt(pick(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onMouseLeave={() => setHoverAt(null)}
    >
      {ticks(min, max).map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line-soft" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" className="fill-ink-4 text-[10px]">
            {fmtValue(t)}
          </text>
        </g>
      ))}
      {zero && min < 0 && max > 0 && (
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-ink-4" strokeWidth={1} strokeDasharray="3 3" />
      )}
      {lines.map((line) => {
        const all = solid(line);
        const later = dashed(line);
        const earlier = later.length ? all.slice(0, all.length - later.length + 1) : all;
        const width = line.muted ? Math.min(line.width ?? 1.6, 1.2) : (line.width ?? 1.6);
        return (
          <g key={line.key} className={line.tone} opacity={line.muted ? 0.5 : 1}>
            <path d={path(later.length ? earlier : all)} fill="none" stroke="currentColor" strokeWidth={width} strokeLinejoin="round" />
            {later.length > 1 && <path d={path(later)} fill="none" stroke="currentColor" strokeWidth={width} strokeDasharray="4 3" strokeLinejoin="round" />}
          </g>
        );
      })}
      {dateLabels(range.from, range.to).map((d) => (
        <text key={d.at} x={x(new Date(d.at).toISOString().slice(0, 10))} y={height - 8} textAnchor="middle" className="fill-ink-4 text-[10px]">
          {d.label}
        </text>
      ))}
      {hoverAt && (
        <g pointerEvents="none">
          <line x1={x(hoverAt)} x2={x(hoverAt)} y1={PAD.top} y2={height - PAD.bottom} stroke="currentColor" className="text-ink-3" strokeWidth={0.8} strokeDasharray="2 2" />
          {tipRows.map(({ line, point }) => (point
            ? <circle key={line.key} cx={x(hoverAt)} cy={y(point.value)} r={line.muted ? 2.2 : 3} fill="currentColor" className={line.tone} />
            : null))}
          <rect x={tipX} y={PAD.top + 2} width={TIP_W} height={tipH} rx={6} fill="var(--color-background-primary)" stroke="var(--color-border-secondary)" strokeWidth={0.6} />
          <text x={tipX + 8} y={PAD.top + 17} className="fill-ink-2 text-[10.5px]">{hoverAt}</text>
          {tipRows.map(({ line, point }, i) => (
            <g key={line.key}>
              <rect x={tipX + 8} y={PAD.top + 24 + i * TIP_ROW} width={7} height={2.5} rx={1.2} fill="currentColor" className={line.tone} />
              <text x={tipX + 20} y={PAD.top + 28 + i * TIP_ROW} className="fill-ink-3 text-[10px]">{line.name}</text>
              <text x={tipX + TIP_W - 8} y={PAD.top + 28 + i * TIP_ROW} textAnchor="end" className="fill-ink-2 text-[10.5px]">
                {point ? fmtValue(point.value) : "—"}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/**
 * 图例：点一下把那条线收起来或放出来（收起的线不画，也不参与纵轴范围）。
 * `note` 给每条线补一句状态，比如「上升」「末端为估计」。
 */
export function LineLegend({
  lines,
  hidden,
  onToggle,
  note,
}: {
  lines: Line[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  note?: (line: Line) => string | null;
}): React.ReactElement {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px]">
      {lines.map((l) => {
        const off = hidden.has(l.key);
        const extra = note?.(l) ?? null;
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => onToggle(l.key)}
            aria-pressed={!off}
            title={off ? `显示「${l.name}」` : `隐藏「${l.name}」`}
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors ${off ? "opacity-45" : "hover:bg-bg-sunk"}`}
          >
            <span className={`h-1.5 w-3 rounded-full bg-current ${l.tone} ${off ? "opacity-50" : ""}`} />
            <span className={off ? "text-ink-4 line-through" : "text-ink-3"}>{l.name}</span>
            {extra && !off && <span className="text-[10.5px] text-ink-4">{extra}</span>}
          </button>
        );
      })}
    </div>
  );
}
