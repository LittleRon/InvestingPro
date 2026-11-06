-- AI 解读改成「覆盖式重新生成」：同一天重新生成时更新原来的那条，记下这是第几次生成。
ALTER TABLE macro_interpretations
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1;
