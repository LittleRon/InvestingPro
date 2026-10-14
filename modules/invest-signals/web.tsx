// 投资信号与趋势模块接进网页的地方：桌面侧栏“分析”一组、手机“我的”页两个入口、
// 主题页（公司与板块）页脚的近期走势部件。
import { defineWebModule } from "@aihot/web/modules";
import { IconChart, IconTrendUp } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "invest-signals",
  sidebar: {
    section: "分析",
    items: [
      { to: "/signals", label: "信号置信度", icon: IconChart },
      { to: "/trends", label: "行业趋势", icon: IconTrendUp },
    ],
  },
  // 手机底栏保持精选/热点/日报/我的四格不变；分析入口放在“我的”页，符合常规阅读动线。
  tools: [
    { to: "/signals", label: "信号置信度", icon: <IconChart size={18} /> },
    { to: "/trends", label: "行业趋势", icon: <IconTrendUp size={18} /> },
  ],
  topicPage: () => import("./web/topic-trend.tsx"),
});
