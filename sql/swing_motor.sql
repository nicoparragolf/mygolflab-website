-- ═══════════════════════════════════════════════════════════════════════════
-- MyGolfLab · Motor de swing · columnas nuevas en swing_analyses
-- Archivo: /sql/swing_motor.sql · 2026-11-23
--
-- Qué guarda:
--   metricas       mediciones del motor (sway, early extension, tempo, etc.)
--   fases          vista detectada, segundos de cada fase P1…P10, calidad
--   video_hash     huella del archivo: mismo video → mismo análisis
--   motor_version  versión del motor que hizo la medición
--
-- Todas son opcionales (pueden quedar vacías), así que los análisis
-- antiguos no se ven afectados. Se puede correr más de una vez sin problema.
--
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.swing_analyses add column if not exists metricas      jsonb;
alter table public.swing_analyses add column if not exists fases         jsonb;
alter table public.swing_analyses add column if not exists video_hash    text;
alter table public.swing_analyses add column if not exists motor_version text;

create index if not exists swing_analyses_user_hash_idx
  on public.swing_analyses (user_id, video_hash);
