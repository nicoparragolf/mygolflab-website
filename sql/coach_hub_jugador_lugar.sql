-- ═══════════════════════════════════════════════════════════════════════════
-- Coach Hub · Ciudad y país del jugador
-- Archivo: sql/coach_hub_jugador_lugar.sql
-- Versión: 1.0 · 2026-11-02
--
-- Al crear un jugador ya no se pregunta el club, sino de dónde es
-- (ciudad y país). La columna home_club se mantiene (no se borra nada).
--
-- Cómo correrlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Es idempotente: se puede correr más de una vez.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.players add column if not exists city    text check (char_length(city) <= 80);
alter table public.players add column if not exists country text check (char_length(country) <= 60);
