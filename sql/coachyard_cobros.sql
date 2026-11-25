-- ═══════════════════════════════════════════════════════════════════════════
-- CoachYard · Cobro de suscripciones (Flow en la web, Apple en la app)
-- Archivo: sql/coachyard_cobros.sql   (idempotente; va después de coachyard_suscripciones.sql)
--
-- - coach_subscriptions guarda el cliente de Flow, el plan que eligió el coach
--   mientras inscribe su tarjeta y la tienda por la que paga.
-- - discount_codes guarda el cupón equivalente creado en Flow (se crea solo).
-- - Cupos de Coach Fundador: los primeros 50 coaches (sin contar cuentas de
--   cortesía) quedan como fundadores automáticamente y tienen 40% de descuento.
-- - mgl_cupos_fundador(): cuántos cupos quedan (para mostrar en la página de precios).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.coach_subscriptions add column if not exists flow_customer_id text;
alter table public.coach_subscriptions add column if not exists pending_plan text;
alter table public.coach_subscriptions add column if not exists pending_period text;
alter table public.coach_subscriptions add column if not exists card_last4 text;
alter table public.coach_subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.discount_codes add column if not exists flow_coupon_id text;

create table if not exists public.mgl_cobros_config (
  id                 int primary key default 1 check (id = 1),
  founder_cupos      int not null default 50,
  founder_pct        int not null default 40,
  founder_abierto    boolean not null default true,   -- se cierra a mano cuando termine la campaña
  flow_coupon_fundador text,
  updated_at         timestamptz not null default now()
);
insert into public.mgl_cobros_config (id) values (1) on conflict do nothing;
alter table public.mgl_cobros_config enable row level security;
drop policy if exists cobros_config_admin on public.mgl_cobros_config;
create policy cobros_config_admin on public.mgl_cobros_config
  for all using (public.mgl_es_admin()) with check (public.mgl_es_admin());

-- Cupos de fundador que quedan
create or replace function public.mgl_cupos_fundador()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'abierto', c.founder_abierto,
    'total',   c.founder_cupos,
    'usados',  (select count(*) from public.coach_subscriptions s where s.founder and s.plan <> 'cortesia'),
    'quedan',  greatest(0, c.founder_cupos - (select count(*) from public.coach_subscriptions s where s.founder and s.plan <> 'cortesia')),
    'pct',     c.founder_pct)
  from public.mgl_cobros_config c where c.id = 1
$$;
grant execute on function public.mgl_cupos_fundador() to anon, authenticated;

-- Coach nuevo: prueba + fundador si quedan cupos
create or replace function public.mgl_crear_prueba_coach()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cfg public.mgl_cobros_config;
  usados int;
begin
  if new.role in ('coach','ambos') then
    select * into cfg from public.mgl_cobros_config where id = 1;
    select count(*) into usados from public.coach_subscriptions where founder and plan <> 'cortesia';
    insert into public.coach_subscriptions (coach_id, plan, status, trial_ends_at, founder)
    values (new.id, 'prueba', 'trialing',
            -- Mientras el cobro no esté activo: prueba hasta el 31-01-2027 o 15 días, lo que sea más largo
            greatest(now() + interval '15 days', timestamptz '2027-01-31 23:59:00-03'),
            coalesce(cfg.founder_abierto, false) and usados < coalesce(cfg.founder_cupos, 0))
    on conflict (coach_id) do nothing;
  end if;
  return new;
end $$;

-- El estado que ve la pantalla ahora incluye la tienda, si cancela al final
-- del período y los últimos 4 dígitos de la tarjeta
create or replace function public.mgl_coach_estado()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  s public.coach_subscriptions;
  c public.discount_codes;
  uid uuid := auth.uid();
begin
  if uid is null then return null; end if;
  select * into s from public.coach_subscriptions where coach_id = uid;
  if not found then return json_build_object('tiene_plan', false); end if;
  if s.discount_code_id is not null then
    select * into c from public.discount_codes where id = s.discount_code_id;
  end if;
  return json_build_object(
    'tiene_plan',     true,
    'plan',           s.plan,
    'status',         s.status,
    'activo',         public.mgl_coach_activo(uid),
    'trial_ends_at',  s.trial_ends_at,
    'dias_prueba',    case when s.status = 'trialing' and s.trial_ends_at is not null
                           then greatest(0, ceil(extract(epoch from (s.trial_ends_at - now())) / 86400))::int end,
    'current_period_end', s.current_period_end,
    'provider',       s.provider,
    'billing_period', s.billing_period,
    'cancela_al_final', s.cancel_at_period_end,
    'tarjeta',        s.card_last4,
    'founder',        s.founder,
    'max_alumnos',    public.mgl_plan_max_alumnos(s.plan),
    'alumnos',        public.mgl_alumnos_activos(uid),
    'codigo',         c.code,
    'codigo_pct',     c.percent_off,
    'codigo_meses',   c.duration_months,
    'es_admin',       public.mgl_es_admin()
  );
end $$;

-- Activo: si el coach ya inscribió su forma de pago (provider no nulo) tiene
-- 2 días de gracia al terminar la prueba, mientras la tienda procesa el primer cobro.
create or replace function public.mgl_coach_activo(p_coach uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when s.plan = 'cortesia' and s.status = 'active' then true
      when s.status = 'trialing' then coalesce(s.trial_ends_at
             + case when s.provider in ('flow','apple') then interval '2 days' else interval '0' end > now(), false)
      when s.status = 'active'   then s.current_period_end is null or s.current_period_end > now()
      when s.status = 'past_due' then coalesce(s.current_period_end > now() - interval '3 days', false)
      when s.status = 'canceled' then coalesce(s.current_period_end > now(), false)
      else false
    end
    from public.coach_subscriptions s where s.coach_id = p_coach
  ), false)
$$;
