// 本站模块的后端，由 api 和 worker 启动时安装（site/modules/index.ts）。
import type { ServerModule } from "@aihot/backend/modules";
import macroDashboard from "@aihot/macro-dashboard/server";
import investSignals from "@aihot/invest-signals/server";

export const SERVER_MODULES: readonly ServerModule[] = [macroDashboard, investSignals];
