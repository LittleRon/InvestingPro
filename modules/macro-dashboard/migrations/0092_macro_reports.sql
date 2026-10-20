-- 每日 AI 报告：一个国家一天的 PEST 分析一份。payload 是报告的四象限正文与用到的数据快照。
CREATE TABLE IF NOT EXISTS macro_reports (scope text NOT NULL, at date NOT NULL, model text, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
