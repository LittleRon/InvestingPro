// 投资信号与趋势模块的地址：两个公开页面，api 负责的两个接口。
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "invest-signals",
  pages: [
    { path: "signals", file: "web/signals.tsx", id: "signals" },
    { path: "trends", file: "web/trends.tsx", id: "trends" },
  ],
  // /api/ 前缀本来就归 api 进程；这里写明本模块的两个接口，便于核对。
  apiPaths: [/^\/api\/site\/signals/, /^\/api\/site\/trends/],
});
