-- AI 解读：对动态配置方案的 AI 解读文本，一天一份（按配置变更触发，存最新一条）。
-- 记录解读时的配置快照与数据快照，读者可以核对。
CREATE TABLE IF NOT EXISTS macro_interpretations (
  scope text NOT NULL DEFAULT 'CN',
  at date NOT NULL,
  model text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, at)
);
