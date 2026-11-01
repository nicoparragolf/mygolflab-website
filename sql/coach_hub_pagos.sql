-- ═══════════════════════════════════════════════════════════════════════════
-- Coach Hub · Pagos de clases con Flow
-- Archivo: sql/coach_hub_pagos.sql
-- Versión: 1.0 · 2026-11-01
--
-- Requiere haber corrido antes sql/coach_hub_clases.sql.
-- Cómo correrlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Es idempotente: se puede correr más de una vez.
--
-- Modelo de cobro:
--   · El alumno paga el precio de la clase + un cargo por servicio (5%)
--     que cubre la comisión de Flow.
--   · El coach paga una comisión escalonada según sus clases pagadas en el
--     mes (hora de Chile): 1–30 → 5% · 31–60 → 3% · 61+ → 2%.
--   · Si el alumno ya era del coach (su ficha existía antes de su primera
--     clase por la vitrina), el coach no paga comisión.
--   · Todo esto se cambia en la tabla mgl_pagos_config, sin tocar código.
--
-- Flujo:
--   alumno pide clase pagada  → 'por_pagar' (el coach NO la ve)
--   Flow confirma el pago     → 'pendiente' + payment_status 'pagado'
--                               (recién ahí le aparece al coach)
--   coach rechaza una pagada  → payment_status 'reembolso_pendiente'
--                               (el reembolso se hace desde el panel de Flow)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Configuración de comisiones (una sola fila)
create table if not exists public.mgl_pagos_config (
  id                int primary key default 1 check (id = 1),
  service_fee_pct   numeric(5,2) not null default 5,      -- cargo al alumno
  own_student_pct   numeric(5,2) not null default 0,      -- comisión con alumnos propios
  tiers             jsonb not null default '[{"hasta":30,"pct":5},{"hasta":60,"pct":3},{"hasta":null,"pct":2}]',
  usd_clp_fallback  numeric(10,2) not null default 950,   -- si mindicador.cl no responde
  updated_at        timestamptz not null default now()
);
insert into public.mgl_pagos_config (id) values (1) on conflict (id) do nothing;
alter table public.mgl_pagos_config enable row level security;
drop policy if exists "pagos_config_leer" on public.mgl_pagos_config;
create policy "pagos_config_leer" on public.mgl_pagos_config for select using (true);
grant select on public.mgl_pagos_config to anon, authenticated;

-- 2. Columnas de pago en las clases
alter table public.coach_lessons add column if not exists base_clp          integer;      -- precio de la clase en pesos
alter table public.coach_lessons add column if not exists service_fee_clp   integer;      -- cargo por servicio (alumno)
alter table public.coach_lessons add column if not exists amount_clp        integer;      -- total cobrado al alumno
alter table public.coach_lessons add column if not exists usd_clp_rate      numeric(10,2);
alter table public.coach_lessons add column if not exists commission_pct    numeric(5,2);
alter table public.coach_lessons add column if not exists commission_clp    integer;
alter table public.coach_lessons add column if not exists coach_payout_clp  integer;      -- lo que se le debe al coach
alter table public.coach_lessons add column if not exists is_own_student    boolean;
alter table public.coach_lessons add column if not exists flow_token        text;
alter table public.coach_lessons add column if not exists flow_order        bigint;
alter table public.coach_lessons add column if not exists payment_method    text;
alter table public.coach_lessons add column if not exists paid_at           timestamptz;
alter table public.coach_lessons add column if not exists payout_status     text not null default 'no_aplica';
alter table public.coach_lessons add column if not exists paid_out_at       timestamptz;

-- estados nuevos: 'por_pagar' (clase) y 'fallido' / 'reembolso_pendiente' (pago)
do $$
declare r record;
begin
  for r in
    select con.conname from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    where c.relname = 'coach_lessons' and con.contype = 'c'
      and (pg_get_constraintdef(con.oid) ilike '%status%')
  loop
    execute format('alter table public.coach_lessons drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.coach_lessons add constraint coach_lessons_status_chk
  check (status in ('por_pagar','pendiente','aceptada','entregada','rechazada','cancelada'));
alter table public.coach_lessons add constraint coach_lessons_payment_chk
  check (payment_status in ('sin_pago','pendiente','pagado','fallido','reembolso_pendiente','reembolsado'));
alter table public.coach_lessons add constraint coach_lessons_payout_chk
  check (payout_status in ('no_aplica','por_liquidar','liquidado'));

create index if not exists coach_lessons_paid_idx on public.coach_lessons (coach_id, paid_at);

-- 3. RLS: el coach NO ve las clases que todavía no se pagan
drop policy if exists "clases_leer" on public.coach_lessons;
create policy "clases_leer" on public.coach_lessons
  for select using (
    student_id = auth.uid()
    or (coach_id = auth.uid() and status <> 'por_pagar')
  );

-- 4. Pedir clase: si la oferta tiene precio, queda 'por_pagar'
create or replace function public.mgl_clase_pedir(
  p_offering   uuid,
  p_note       text,
  p_videos     text[],
  p_country    text,
  p_price_clp  integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o    public.coach_offerings%rowtype;
  u    record;
  nid  uuid;
  paga boolean;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select * into o from public.coach_offerings where id = p_offering and is_active = true;
  if not found then raise exception 'Esta oferta ya no está disponible'; end if;
  if o.coach_id = auth.uid() then raise exception 'No puedes pedirte una clase a ti mismo'; end if;

  if o.is_trial and exists (
    select 1 from public.coach_lessons
    where student_id = auth.uid() and coach_id = o.coach_id
      and (offering->>'is_trial')::boolean is true
      and status not in ('cancelada','por_pagar')
  ) then
    raise exception 'Ya pediste la evaluación inicial con este coach';
  end if;

  if exists (select 1 from unnest(coalesce(p_videos,'{}')) v where split_part(v,'/',1) <> auth.uid()::text) then
    raise exception 'Videos inválidos';
  end if;

  select coalesce(nullif(raw_user_meta_data->>'full_name',''),
                  nullif(trim(coalesce(raw_user_meta_data->>'first_name','')||' '||coalesce(raw_user_meta_data->>'last_name','')),''),
                  split_part(email,'@',1)) as name,
         email
    into u from auth.users where id = auth.uid();

  paga := coalesce(o.price,0) > 0;

  insert into public.coach_lessons
    (coach_id, student_id, student_name, student_email, offering_id, offering,
     price, currency, price_clp, student_country, student_note, video_paths,
     status, payment_status)
  values
    (o.coach_id, auth.uid(), u.name, u.email, o.id,
     jsonb_build_object('title', o.title, 'kind', o.kind, 'is_trial', o.is_trial,
                        'description', o.description, 'analyses_included', o.analyses_included,
                        'duration_days', o.duration_days, 'capture_requirements', o.capture_requirements),
     coalesce(o.price,0), coalesce(nullif(o.currency,''),'CLP'), p_price_clp,
     left(coalesce(p_country,''),2), nullif(btrim(coalesce(p_note,'')),''), coalesce(p_videos,'{}'),
     case when paga then 'por_pagar' else 'pendiente' end,
     case when paga then 'pendiente' else 'sin_pago' end)
  returning id into nid;

  return nid;
end;
$$;

-- 5. Cancelar: solo si no está pagada
create or replace function public.mgl_clase_cancelar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coach_lessons
     set status = 'cancelada', closed_at = now()
   where id = p_id and student_id = auth.uid()
     and status in ('pendiente','por_pagar')
     and payment_status <> 'pagado';
  if not found then raise exception 'Esta clase ya está pagada: pídele a tu coach que la gestione'; end if;
end;
$$;

-- 6. Rechazar: si estaba pagada, queda marcada para reembolso
create or replace function public.mgl_clase_rechazar(p_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coach_lessons
     set status = 'rechazada', closed_at = now(),
         coach_reply = nullif(btrim(coalesce(p_reply,'')),''),
         payment_status = case when payment_status = 'pagado' then 'reembolso_pendiente' else payment_status end,
         payout_status  = case when payment_status = 'pagado' then 'no_aplica' else payout_status end
   where id = p_id and coach_id = auth.uid() and status = 'pendiente';
  if not found then raise exception 'No se puede rechazar esta clase'; end if;
end;
$$;

grant execute on function public.mgl_clase_pedir(uuid, text, text[], text, integer) to authenticated;
grant execute on function public.mgl_clase_cancelar(uuid)       to authenticated;
grant execute on function public.mgl_clase_rechazar(uuid, text) to authenticated;

-- 7. Resumen para liquidar a cada coach (para ti, en el Table Editor de Supabase)
create or replace view public.v_liquidaciones_coach as
select
  l.coach_id,
  coalesce(cp.display_name, 'Coach') as coach,
  to_char(l.paid_at at time zone 'America/Santiago', 'YYYY-MM') as mes,
  count(*)                                   as clases_pagadas,
  sum(l.amount_clp)                          as cobrado_clp,
  sum(l.service_fee_clp)                     as cargo_servicio_clp,
  sum(l.commission_clp)                      as comision_clp,
  sum(l.coach_payout_clp)                    as a_pagar_al_coach_clp,
  sum(case when l.payout_status = 'por_liquidar' then l.coach_payout_clp else 0 end) as pendiente_de_liquidar_clp
from public.coach_lessons l
left join public.coach_profiles cp on cp.coach_id = l.coach_id
where l.paid_at is not null and l.payment_status = 'pagado'
group by l.coach_id, cp.display_name, 3
order by mes desc, coach;

-- la vista no se expone a los usuarios de la app (solo tú, desde Supabase)
revoke all on public.v_liquidaciones_coach from anon, authenticated;
