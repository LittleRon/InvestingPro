-- 动态组合配置：管理员账户下的持仓与配置方案。不做读者账户，只有管理员本机演示。
CREATE TABLE IF NOT EXISTS macro_allocations (
  admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  total_assets numeric(14,2) NOT NULL DEFAULT 0,
  holdings jsonb NOT NULL DEFAULT '{}'::jsonb,
  horizon text NOT NULL DEFAULT 'medium',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id)
);
