// 仪表盘的折线图。手写 SVG，不引图表库：这些图只用来看走势和位置，
// 不需要缩放拖拽那一套。颜色交给 CSS 类（stroke 用 currentColor），深浅色外观都跟着变。
import type { Point } from "../logic.ts";

export interface Line {
  key: string;
  name: string;
  /** 折线的颜色类，比如 text-accent；stroke 取 currentColor。 */
  tone: string;
  points: Point[];
  /** 从这一天起末端是估计值，按虚线画。 */
  dashedFrom?: string | null;
}

const W = 820;
const PAD = { left: 46, right: 10, top: 12, bottom: 24 };

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

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={lines.map((l) => l.name).join("、")}>
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
        return (
          <g key={line.key} className={line.tone}>
            <path d={path(later.length ? earlier : all)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
            {later.length > 1 && <path d={path(later)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="4 3" strokeLinejoin="round" />}
          </g>
        );
      })}
      {dateLabels(range.from, range.to).map((d) => (
        <text key={d.at} x={x(new Date(d.at).toISOString().slice(0, 10))} y={height - 8} textAnchor="middle" className="fill-ink-4 text-[10px]">
          {d.label}
        </text>
      ))}
    </svg>
  );
}
