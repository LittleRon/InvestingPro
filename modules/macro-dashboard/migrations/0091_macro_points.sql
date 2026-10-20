-- 指标的观测值。一个指标一段时间内每个时点一个值；采集是幂等的，同一时点后来的值覆盖先前的。
CREATE TABLE IF NOT EXISTS macro_points (indicator_key text NOT NULL, at date NOT NULL, value double precision NOT NULL, PRIMARY KEY (indicator_key, at));
