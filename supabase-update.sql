-- ============================================================
-- Supabase SQL Editor に貼って実行してください（更新版）
-- ※ すでにeventsテーブルがある場合は、下の「カラム追加」だけ実行
-- ============================================================

-- 新しいカラムを追加（すでにテーブルがある場合はこれだけ実行）
ALTER TABLE events ADD COLUMN IF NOT EXISTS tag text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS icon text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS repeat_type text DEFAULT 'none';
ALTER TABLE events ADD COLUMN IF NOT EXISTS reminder_min text DEFAULT 'none';
