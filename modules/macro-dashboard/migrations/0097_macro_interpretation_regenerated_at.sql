-- AI 解读最后重新生成的时间，读者能看到这份解读是新写的而不是早上那版。
ALTER TABLE macro_interpretations
  ADD COLUMN IF NOT EXISTS regenerated_at timestamptz;
