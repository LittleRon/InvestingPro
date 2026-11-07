// 宏观仪表盘模块的地址：一个仪表盘页、一份每日 PEST 报告页，api 负责的三个接口
// （仪表盘数据、周期、每日报告）和管理员的「立即编写」入口。
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "macro-dashboard",
  pages: [
    { path: "dashboard", file: "web/dashboard.tsx", id: "dashboard" },
    { path: "dashboard/report", file: "web/report.tsx", id: "dashboard-report" },
    { path: "dashboard/clock", file: "web/clock.tsx", id: "dashboard-clock" },
    { path: "dashboard/allocation", file: "web/allocation.tsx", id: "dashboard-allocation" },
    { path: "dashboard/allocation/report", file: "web/interpretation-report.tsx", id: "dashboard-allocation-report" },
  ],
  apiPaths: [/^\/api\/site\/dashboard/, /^\/api\/admin\/macro\/(report|allocation)$/],
});
