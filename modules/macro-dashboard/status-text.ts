// 「为什么还没有报告/解读」的解释文案：PEST 报告页、仪表盘、AI 解读报告页共用。
//
// 以前 report.tsx 和 dashboard.tsx 各写一份，AI 解读页干脆没有，导致同一种任务状态
// 在三个页面说法不一样、解读侧连失败原因都看不到。detail 由服务端用 safeJobDetail
// 归一化过（队列任务存数组、定时任务存对象），这里只读统一后的形状。
import type { SafeReportStatus } from "./normalize.ts";

export function explainRunStatus(status: SafeReportStatus | null, subject: "报告" | "解读" = "报告"): string {
  if (!status) return `还从未跑过${subject}任务（检查 worker 是否在跑、任务是否登记）。`;
  if (status.status === "running") return `${subject}任务正在跑，页面会自动跟进进度。`;
  if (status.status === "failed") {
    const reason = status.error ? status.error.split("\n")[0]!.slice(0, 120) : "未知错误";
    return `${subject}任务上次失败：${reason}`;
  }
  if (status.status === "ok") {
    if (status.detail.written === false) return status.detail.reason ?? `上次任务跳过了（数据不够或已有${subject}）。`;
    if (status.detail.written === true) return `${subject}已写出；若这里还没显示，稍等片刻刷新查看。`;
    return `上次任务已完成，可查看生成进度与结果。`;
  }
  return `${subject}任务最近一次状态：${status.status}`;
}
