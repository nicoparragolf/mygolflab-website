-- ═══════════════════════════════════════════════════════════════════════════
-- CoachYard · Medios de pago (Flow y Mercado Pago)
-- Archivo: sql/coach_hub_medios_pago.sql · 2026-11-10 (ya aplicado en Supabase)
-- Guarda con qué medio se pagó cada clase / compra de contenido y el id del
-- pago en Mercado Pago. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.coach_lessons     add column if not exists payment_provider    text;
alter table public.coach_lessons     add column if not exists provider_payment_id text;
alter table public.content_purchases add column if not exists payment_provider    text;
alter table public.content_purchases add column if not exists provider_payment_id text;

update public.coach_lessons     set payment_provider = 'flow' where payment_provider is null and flow_token is not null;
update public.content_purchases set payment_provider = 'flow' where payment_provider is null and flow_token is not null;
