// 本站模块接进网页的部分（site/modules/index.ts）。
import type { WebModule } from "@aihot/web/modules";
import macroDashboard from "@aihot/macro-dashboard/web";
import investSignals from "@aihot/invest-signals/web";

export const WEB_MODULES: readonly WebModule[] = [macroDashboard, investSignals];
