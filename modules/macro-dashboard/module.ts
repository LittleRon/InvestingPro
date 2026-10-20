// 宏观仪表盘模块的地址：一个仪表盘页、一份每日 PEST 报告页，api 负责的三个接口。
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "macro-dashboard",
  pages: [
    { path: "dashboard", file: "web/dashboard.tsx", id: "dashboard" },
    { path: "dashboard/report", file: "web/report.tsx", id: "dashboard-report" },
  ],
  apiPaths: [/^\/api\/site\/dashboard/],
});
