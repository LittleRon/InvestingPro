-- 仪表盘的指标目录：一条指标 = 一条序列的元数据（FRED 的 series id 或世界银行的（国家, 指标））。
CREATE TABLE IF NOT EXISTS macro_indicators (key text PRIMARY KEY, block text NOT NULL, country text NOT NULL, name text NOT NULL, unit text NOT NULL, frequency text NOT NULL, source text NOT NULL, series text NOT NULL, cycle text, updated_at timestamptz NOT NULL DEFAULT now());
