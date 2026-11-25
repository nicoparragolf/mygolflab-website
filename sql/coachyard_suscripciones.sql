-- ═══════════════════════════════════════════════════════════════════════════
-- CoachYard · Suscripciones de coaches, prueba de 15 días y códigos de descuento
-- Archivo: sql/coachyard_suscripciones.sql   (idempotente: se puede correr de nuevo)
--
-- Qué hace:
--   1. coach_subscriptions: un registro por coach con su plan y estado.
--      Todo coach nuevo parte con prueba de 15 días y máximo 3 alumnos.
--   2. Límites por plan: prueba 3 · starter 8 · pro 25 · pro+ 40 · academia/cortesía sin límite.
--   3. Bloqueo real en la base de datos (no solo en pantalla):
--      - crear o reactivar alumnos sobre el límite → error CY_LIMITE_ALUMNOS
--      - el coach sin plan activo no puede crear eventos, videos, notas,
--        planes ni metas → error CY_PLAN_INACTIVO
--      - los alumnos SIEMPRE pueden ver su ficha y seguir aportando lo suyo.
--   4. Códigos de descuento (círculo, embajador, promo) con canje por RPC
--      y panel para administradores.
--   5. Coaches que ya existían: no se les corta nada (ver sección 7).
--
-- El cobro (Apple / Flow) solo actualiza coach_subscriptions desde el servidor
-- (service role). Desde el navegador nadie puede escribir esta tabla.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Administradores ─────────────────────────────────────────────────────
create table if not exists public.mgl_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.mgl_admins enable row level security;
drop policy if exists mgl_admins_ver_propio on public.mgl_admins;
create policy mgl_admins_ver_propio on public.mgl_admins
  for select using (user_id = auth.uid());

create or replace function public.mgl_es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mgl_admins where user_id = auth.uid())
$$;

-- ── 2. Códigos de descuento ────────────────────────────────────────────────
create table if not exists public.discount_codes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,30}$'),
  tipo             text not null default 'circulo' check (tipo in ('circulo','embajador','promo')),
  nombre           text,                 -- a quién se le dio (ej. nombre del embajador)
  nota             text,
  percent_off      int  not null default 0 check (percent_off between 0 and 100),
  duration_months  int  check (duration_months is null or duration_months > 0), -- null = mientras siga suscrito
  extra_trial_days int  not null default 0 check (extra_trial_days between 0 and 180),
  planes           text[],               -- null = todos los planes
  max_redemptions  int  check (max_redemptions is null or max_redemptions > 0),
  expires_at       timestamptz,
  active           boolean not null default true,
  apple_offer_ref  text,                 -- nombre del código de oferta en App Store Connect (para la app)
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);
alter table public.discount_codes enable row level security;
drop policy if exists discount_codes_admin on public.discount_codes;
create policy discount_codes_admin on public.discount_codes
  for all using (public.mgl_es_admin()) with check (public.mgl_es_admin());

create table if not exists public.code_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code_id     uuid not null references public.discount_codes(id) on delete restrict,
  coach_id    uuid not null unique references auth.users(id) on delete cascade, -- un código por coach
  redeemed_at timestamptz not null default now()
);
alter table public.code_redemptions enable row level security;
drop policy if exists code_redemptions_ver on public.code_redemptions;
create policy code_redemptions_ver on public.code_redemptions
  for select using (coach_id = auth.uid() or public.mgl_es_admin());

-- ── 3. Suscripciones ───────────────────────────────────────────────────────
create table if not exists public.coach_subscriptions (
  coach_id           uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'prueba'
                       check (plan in ('prueba','starter','pro','pro_plus','academia','cortesia')),
  status             text not null default 'trialing'
                       check (status in ('trialing','active','past_due','canceled','expired')),
  trial_ends_at      timestamptz,
  current_period_end timestamptz,      -- hasta cuándo está pagado (Apple / Flow)
  provider           text check (provider is null or provider in ('apple','flow','manual')),
  provider_ref       text,              -- id de la suscripción en Apple/RevenueCat o Flow
  billing_period     text check (billing_period is null or billing_period in ('mensual','anual')),
  founder            boolean not null default false,
  discount_code_id   uuid references public.discount_codes(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.coach_subscriptions enable row level security;
drop policy if exists coach_subs_ver on public.coach_subscriptions;
create policy coach_subs_ver on public.coach_subscriptions
  for select using (coach_id = auth.uid() or public.mgl_es_admin());
-- (sin políticas de escritura: solo el servidor con service role o funciones security definer)

-- ── 4. Reglas del plan ─────────────────────────────────────────────────────
create or replace function public.mgl_plan_max_alumnos(p_plan text)
returns int language sql immutable as $$
  select case p_plan
    when 'prueba'  then 3
    when 'starter' then 8
    when 'pro'     then 25
    when 'pro_plus' then 40
    else null      -- academia y cortesía: sin límite
  end
$$;

-- ¿El coach puede crear contenido hoy?
create or replace function public.mgl_coach_activo(p_coach uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when s.plan = 'cortesia' and s.status = 'active' then true
      when s.status = 'trialing' then coalesce(s.trial_ends_at > now(), false)
      when s.status = 'active'   then s.current_period_end is null or s.current_period_end > now()
      when s.status = 'past_due' then coalesce(s.current_period_end > now() - interval '3 days', false) -- 3 días de gracia
      when s.status = 'canceled' then coalesce(s.current_period_end > now(), false) -- usa lo ya pagado
      else false
    end
    from public.coach_subscriptions s where s.coach_id = p_coach
  ), false)
$$;

create or replace function public.mgl_alumnos_activos(p_coach uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.players
  where coach_id = p_coach and coalesce(status, 'activo') = 'activo'
$$;

-- Estado completo para la pantalla (banner, Mi cuenta, bloqueos)
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
    'founder',        s.founder,
    'max_alumnos',    public.mgl_plan_max_alumnos(s.plan),
    'alumnos',        public.mgl_alumnos_activos(uid),
    'codigo',         c.code,
    'codigo_pct',     c.percent_off,
    'codigo_meses',   c.duration_months,
    'es_admin',       public.mgl_es_admin()
  );
end $$;

-- ── 5. Bloqueos en la base de datos ────────────────────────────────────────
-- 5a. Alumnos: tope del plan y plan activo
create or replace function public.mgl_check_limite_alumnos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s public.coach_subscriptions;
  tope int;
begin
  if auth.uid() is null then return new; end if;                 -- servidor / SQL directo
  if new.coach_id is null then return new; end if;
  if coalesce(new.status, 'activo') <> 'activo' then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.status, 'activo') = 'activo'
     and old.coach_id = new.coach_id then return new; end if;      -- no cambia nada del cupo

  select * into s from public.coach_subscriptions where coach_id = new.coach_id;
  if not found then return new; end if;                          -- coach sin registro (no debería pasar)

  if not public.mgl_coach_activo(new.coach_id) then
    raise exception 'CY_PLAN_INACTIVO' using hint = 'El plan del coach no está activo';
  end if;
  tope := public.mgl_plan_max_alumnos(s.plan);
  if tope is not null and public.mgl_alumnos_activos(new.coach_id) >= tope then
    raise exception 'CY_LIMITE_ALUMNOS' using hint = 'Llegaste al máximo de alumnos de tu plan (' || tope || ')';
  end if;
  return new;
end $$;

drop trigger if exists trg_cy_limite_alumnos on public.players;
create trigger trg_cy_limite_alumnos
  before insert or update of status, coach_id on public.players
  for each row execute function public.mgl_check_limite_alumnos();

-- 5b. Contenido creado por el coach (eventos, videos, notas, planes, metas)
create or replace function public.mgl_exigir_plan_activo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_coach uuid;
begin
  if auth.uid() is null then return new; end if;
  select coach_id into v_coach from public.players where id = new.player_id;
  -- solo aplica cuando quien escribe es el coach de esa ficha; el alumno siempre puede aportar
  if v_coach is not null and v_coach = auth.uid()
     and exists (select 1 from public.coach_subscriptions where coach_id = v_coach)
     and not public.mgl_coach_activo(v_coach) then
    raise exception 'CY_PLAN_INACTIVO' using hint = 'El plan del coach no está activo';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['player_events','player_media','player_notes','player_plans','player_goals'] loop
    execute format('drop trigger if exists trg_cy_plan_activo on public.%I', t);
    execute format('create trigger trg_cy_plan_activo before insert on public.%I
                    for each row execute function public.mgl_exigir_plan_activo()', t);
  end loop;
end $$;

-- ── 6. Prueba automática para cada coach nuevo ─────────────────────────────
create or replace function public.mgl_crear_prueba_coach()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('coach','ambos') then
    insert into public.coach_subscriptions (coach_id, plan, status, trial_ends_at)
    -- Mientras el cobro no esté listo: prueba hasta el 31-01-2027 o 15 días, lo que sea más largo
    values (new.id, 'prueba', 'trialing',
            greatest(now() + interval '15 days', timestamptz '2027-01-31 23:59:00-03'))
    on conflict (coach_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_cy_prueba_coach on public.profiles;
create trigger trg_cy_prueba_coach
  after insert or update of role on public.profiles
  for each row execute function public.mgl_crear_prueba_coach();

-- ── 7. Coaches que ya existían ─────────────────────────────────────────────
-- Todos parten como Coach Fundador con prueba hasta el 31-01-2027 (no se corta a nadie
-- durante el lanzamiento). Nico y la cuenta de revisión de Apple quedan en cortesía
-- (sin límite y sin vencimiento: la revisión de Apple nunca debe toparse con un bloqueo).
insert into public.coach_subscriptions (coach_id, plan, status, trial_ends_at, founder)
select p.id, 'prueba', 'trialing', timestamptz '2027-01-31 23:59:00-03', true
from public.profiles p
where p.role in ('coach','ambos')
on conflict (coach_id) do nothing;

update public.coach_subscriptions s
set plan = 'cortesia', status = 'active', trial_ends_at = null, provider = 'manual', founder = true, updated_at = now()
from auth.users u
where u.id = s.coach_id and lower(u.email) in ('n.parrarecart@gmail.com', 'revision@coachyard.golf');

insert into public.mgl_admins (user_id)
select id from auth.users where lower(email) = 'n.parrarecart@gmail.com'
on conflict do nothing;

-- ── 8. Códigos: consultar y canjear ────────────────────────────────────────
-- Validación interna (devuelve el código si sirve, o un motivo)
create or replace function public.mgl_codigo_valido(p_code text, out c public.discount_codes, out motivo text)
language plpgsql stable security definer set search_path = public as $$
declare usados int;
begin
  select * into c from public.discount_codes where code = upper(trim(p_code));
  if not found then motivo := 'no_existe'; return; end if;
  if not c.active then motivo := 'inactivo'; c := null; return; end if;
  if c.expires_at is not null and c.expires_at < now() then motivo := 'vencido'; c := null; return; end if;
  if c.max_redemptions is not null then
    select count(*) into usados from public.code_redemptions where code_id = c.id;
    if usados >= c.max_redemptions then motivo := 'agotado'; c := null; return; end if;
  end if;
  motivo := null;
end $$;

-- Ver qué da un código antes de canjearlo (sirve también sin sesión, en la página de precios)
create or replace function public.mgl_codigo_info(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.mgl_codigo_valido(p_code);
  if r.motivo is not null then return json_build_object('ok', false, 'motivo', r.motivo); end if;
  return json_build_object('ok', true, 'code', (r.c).code, 'percent_off', (r.c).percent_off,
    'duration_months', (r.c).duration_months, 'extra_trial_days', (r.c).extra_trial_days,
    'planes', (r.c).planes);
end $$;

-- Canjear: el coach logueado aplica un código a su suscripción
create or replace function public.mgl_canjear_codigo(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  r record;
  uid uuid := auth.uid();
  s public.coach_subscriptions;
begin
  if uid is null then return json_build_object('ok', false, 'motivo', 'sin_sesion'); end if;
  select * into s from public.coach_subscriptions where coach_id = uid;
  if not found then return json_build_object('ok', false, 'motivo', 'no_es_coach'); end if;
  if exists (select 1 from public.code_redemptions where coach_id = uid) then
    return json_build_object('ok', false, 'motivo', 'ya_uso_codigo');
  end if;

  select * into r from public.mgl_codigo_valido(p_code);
  if r.motivo is not null then return json_build_object('ok', false, 'motivo', r.motivo); end if;

  insert into public.code_redemptions (code_id, coach_id) values ((r.c).id, uid);
  update public.coach_subscriptions
     set discount_code_id = (r.c).id,
         trial_ends_at = case when status = 'trialing' and (r.c).extra_trial_days > 0
                              then trial_ends_at + make_interval(days => (r.c).extra_trial_days)
                              else trial_ends_at end,
         updated_at = now()
   where coach_id = uid;

  return json_build_object('ok', true, 'code', (r.c).code, 'percent_off', (r.c).percent_off,
    'duration_months', (r.c).duration_months, 'extra_trial_days', (r.c).extra_trial_days);
end $$;

-- ── 9. Panel de administrador ──────────────────────────────────────────────
-- Lista de códigos con cuántos coaches lo usaron y cuántos de ellos ya pagan
create or replace function public.mgl_admin_codigos()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mgl_es_admin() then raise exception 'solo_admin'; end if;
  return coalesce((
    select json_agg(x order by x.created_at desc) from (
      select c.*,
        (select count(*) from public.code_redemptions r where r.code_id = c.id) as canjes,
        (select count(*) from public.code_redemptions r
           join public.coach_subscriptions s on s.coach_id = r.coach_id
          where r.code_id = c.id and s.status = 'active' and s.plan not in ('prueba','cortesia')) as pagando
      from public.discount_codes c
    ) x), '[]'::json);
end $$;

-- Resumen de coaches por estado (para el panel)
create or replace function public.mgl_admin_resumen()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mgl_es_admin() then raise exception 'solo_admin'; end if;
  return json_build_object(
    'en_prueba',  (select count(*) from public.coach_subscriptions where status = 'trialing' and trial_ends_at > now()),
    'pagando',    (select count(*) from public.coach_subscriptions where status = 'active' and plan not in ('prueba','cortesia')),
    'vencidos',   (select count(*) from public.coach_subscriptions s where not public.mgl_coach_activo(s.coach_id)),
    'fundadores', (select count(*) from public.coach_subscriptions where founder)
  );
end $$;

grant execute on function public.mgl_coach_estado()        to authenticated;
grant execute on function public.mgl_codigo_info(text)     to anon, authenticated;
grant execute on function public.mgl_canjear_codigo(text)  to authenticated;
grant execute on function public.mgl_admin_codigos()       to authenticated;
grant execute on function public.mgl_admin_resumen()       to authenticated;
revoke execute on function public.mgl_codigo_valido(text)  from anon, authenticated, public;

-- Para cambiar si el plan existente ya tenía la regla antigua:
alter table public.coach_subscriptions drop constraint if exists coach_subscriptions_plan_check;
alter table public.coach_subscriptions add constraint coach_subscriptions_plan_check
  check (plan in ('prueba','starter','pro','pro_plus','academia','cortesia'));
