-- ═══════════════════════════════════════════════════════════════════════════
-- CoachYard · Aviso push al alumno cuando el coach sube videos o fotos
-- Archivo: sql/coach_hub_push_videos.sql · 2026-11-11
--
-- Usa el mismo envío de avisos de sql/coach_hub_push.sql (mgl_push_avisar →
-- https://mygolflab.golf/api/push). El servidor decide a quién avisar:
-- solo al alumno, y solo si lo subió el coach (no si lo subió él mismo).
-- Se puede correr más de una vez sin problema.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists mgl_push_media on public.player_media;
create trigger mgl_push_media after insert on public.player_media
  for each row execute function public.mgl_push_avisar();
