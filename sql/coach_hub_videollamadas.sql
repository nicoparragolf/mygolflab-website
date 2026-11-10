-- ═══════════════════════════════════════════════════════════════════════════
-- CoachYard · Videollamadas en vivo 1 a 1
-- Archivo: sql/coach_hub_videollamadas.sql · 2026-11-10 (aplicado en Supabase)
-- Idempotente.
--
-- • El coach publica sus horarios semanales (coach_availability) en su zona
--   horaria (coach_profiles.timezone) y guarda su link de Zoom / Meet en
--   coach_call_settings, que es privado: solo lo ven él y sus alumnos con una
--   sesión reservada, a través de mgl_link_llamada().
-- • Las ofertas de tipo 'videollamada' tienen duración y cantidad de sesiones.
-- • Cada sesión es una fila en coach_bookings ligada a la clase (coach_lessons).
--   No se pueden pisar dos sesiones del mismo coach. Una reserva de una clase
--   que no se pagó en 1 hora deja libre el horario.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ofertas: duración y sesiones ──────────────────────────────────────────
alter table public.coach_offerings add column if not exists call_minutes      integer;
alter table public.coach_offerings add column if not exists sessions_included integer;

-- 2. Link privado del coach ────────────────────────────────────────────────
create table if not exists public.coach_call_settings (
  coach_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  call_link   text check (call_link is null or call_link ~* '^https://'),
  min_notice_hours integer not null default 4 check (min_notice_hours between 0 and 168),
  updated_at  timestamptz not null default now()
);
alter table public.coach_call_settings enable row level security;
drop policy if exists ccs_propio on public.coach_call_settings;
create policy ccs_propio on public.coach_call_settings for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
grant select, insert, update, delete on public.coach_call_settings to authenticated;

-- 3. Horarios semanales (minutos desde medianoche, hora del coach) ─────────
create table if not exists public.coach_availability (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),   -- 0 = domingo
  start_min  integer not null check (start_min between 0 and 1439),
  end_min    integer not null check (end_min between 1 and 1440),
  check (end_min > start_min)
);
create index if not exists coach_availability_coach_idx on public.coach_availability (coach_id);
alter table public.coach_availability enable row level security;
drop policy if exists cav_leer on public.coach_availability;
drop policy if exists cav_propio on public.coach_availability;
create policy cav_leer on public.coach_availability for select using (true);
create policy cav_propio on public.coach_availability for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
grant select on public.coach_availability to anon, authenticated;
grant insert, update, delete on public.coach_availability to authenticated;

-- 4. Sesiones reservadas ───────────────────────────────────────────────────
create table if not exists public.coach_bookings (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.coach_lessons(id) on delete cascade,
  coach_id    uuid not null references auth.users(id) on delete cascade,
  student_id  uuid not null references auth.users(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'reservada' check (status in ('reservada','cancelada','realizada')),
  cancelled_by uuid,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists coach_bookings_coach_idx on public.coach_bookings (coach_id, starts_at);
create index if not exists coach_bookings_lesson_idx on public.coach_bookings (lesson_id);
alter table public.coach_bookings enable row level security;
drop policy if exists cbk_leer on public.coach_bookings;
create policy cbk_leer on public.coach_bookings for select
  using (coach_id = auth.uid() or student_id = auth.uid());
grant select on public.coach_bookings to authenticated;
-- (sin insert/update directos: todo pasa por las funciones de abajo)

-- ¿La reserva ocupa el horario? Sí si está reservada y la clase está pagada,
-- es gratis, o se creó hace menos de 1 hora (el alumno está pagando).
create or replace function public.mgl_reserva_activa(b public.coach_bookings)
returns boolean language sql stable security definer set search_path = public as $$
  select b.status = 'reservada' and exists (
    select 1 from public.coach_lessons l
     where l.id = b.lesson_id
       and l.status not in ('cancelada','rechazada')
       and (l.payment_status in ('pagado','sin_pago') or b.created_at > now() - interval '1 hour')
  );
$$;

-- 5. Horarios ocupados de un coach (solo horas, sin datos de nadie) ─────────
create or replace function public.mgl_horarios_ocupados(p_coach uuid, p_desde timestamptz, p_hasta timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.starts_at, b.ends_at from public.coach_bookings b
   where b.coach_id = p_coach and b.starts_at < p_hasta and b.ends_at > p_desde
     and public.mgl_reserva_activa(b);
$$;

-- 6. Reservar una sesión de una clase de videollamada ──────────────────────
create or replace function public.mgl_reservar(p_lesson uuid, p_starts timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.coach_lessons%rowtype;
  dur integer; ses integer; tz text; aviso integer;
  loc timestamp; dow integer; mins integer; usadas integer; nid uuid;
begin
  select * into l from public.coach_lessons where id = p_lesson;
  if not found or l.student_id <> auth.uid() then raise exception 'Clase no encontrada'; end if;
  if coalesce(l.offering->>'kind','') <> 'videollamada' then raise exception 'Esta clase no es una videollamada'; end if;
  if l.status in ('cancelada','rechazada','entregada') then raise exception 'Esta clase ya está cerrada'; end if;

  dur := coalesce((l.offering->>'call_minutes')::int, 60);
  ses := greatest(coalesce((l.offering->>'sessions_included')::int, 1), 1);
  select coalesce(nullif(timezone,''),'America/Santiago') into tz from public.coach_profiles where coach_id = l.coach_id;
  tz := coalesce(tz, 'America/Santiago');
  select coalesce(min_notice_hours, 4) into aviso from public.coach_call_settings where coach_id = l.coach_id;
  aviso := coalesce(aviso, 4);

  if p_starts < now() + make_interval(hours => aviso) then
    raise exception 'Elige un horario con al menos % horas de anticipación', aviso;
  end if;
  if p_starts > now() + interval '60 days' then raise exception 'Ese horario está muy lejos'; end if;

  select count(*) into usadas from public.coach_bookings b
   where b.lesson_id = l.id and b.status in ('reservada','realizada');
  if usadas >= ses then raise exception 'Ya reservaste todas las sesiones de esta clase'; end if;

  -- dentro del horario publicado por el coach (en su zona horaria)
  loc  := p_starts at time zone tz;
  dow  := extract(dow from loc)::int;
  mins := extract(hour from loc)::int * 60 + extract(minute from loc)::int;
  if not exists (select 1 from public.coach_availability a
                  where a.coach_id = l.coach_id and a.weekday = dow
                    and a.start_min <= mins and mins + dur <= a.end_min) then
    raise exception 'Ese horario no está disponible';
  end if;

  -- sin choques con otra sesión del coach (bloqueo para reservas simultáneas)
  perform pg_advisory_xact_lock(hashtext(l.coach_id::text));
  if exists (select 1 from public.coach_bookings b
              where b.coach_id = l.coach_id
                and b.starts_at < p_starts + make_interval(mins => dur)
                and b.ends_at > p_starts
                and public.mgl_reserva_activa(b)) then
    raise exception 'Alguien acaba de reservar ese horario. Elige otro.';
  end if;

  insert into public.coach_bookings (lesson_id, coach_id, student_id, starts_at, ends_at)
  values (l.id, l.coach_id, l.student_id, p_starts, p_starts + make_interval(mins => dur))
  returning id into nid;
  return nid;
end $$;

-- 7. Cancelar una sesión (alumno con 12 h de anticipación; coach cuando sea)
create or replace function public.mgl_cancelar_reserva(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b public.coach_bookings%rowtype;
begin
  select * into b from public.coach_bookings where id = p_booking;
  if not found or (b.coach_id <> auth.uid() and b.student_id <> auth.uid()) then raise exception 'Sesión no encontrada'; end if;
  if b.status <> 'reservada' then raise exception 'Esta sesión ya no está reservada'; end if;
  if b.student_id = auth.uid() and b.coach_id <> auth.uid() and b.starts_at < now() + interval '12 hours' then
    raise exception 'Solo puedes cancelar hasta 12 horas antes. Escríbele a tu coach.';
  end if;
  update public.coach_bookings set status = 'cancelada', cancelled_by = auth.uid() where id = b.id;
end $$;

-- 8. El coach marca una sesión como realizada ─────────────────────────────
create or replace function public.mgl_sesion_realizada(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.coach_bookings set status = 'realizada'
   where id = p_booking and coach_id = auth.uid() and status = 'reservada' and starts_at < now();
  if not found then raise exception 'No se pudo marcar la sesión'; end if;
end $$;

-- 9. Link de la llamada: solo coach o alumno de una sesión activa y pagada ─
create or replace function public.mgl_link_llamada(p_booking uuid)
returns text language sql stable security definer set search_path = public as $$
  select s.call_link
    from public.coach_bookings b
    join public.coach_lessons l on l.id = b.lesson_id
    left join public.coach_call_settings s on s.coach_id = b.coach_id
   where b.id = p_booking and b.status = 'reservada'
     and (b.coach_id = auth.uid() or b.student_id = auth.uid())
     and l.payment_status in ('pagado','sin_pago');
$$;

-- ¿El coach tiene todo listo para videollamadas? (para la vitrina pública)
create or replace function public.mgl_videollamada_lista(p_coach uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.coach_call_settings where coach_id = p_coach and call_link is not null)
     and exists (select 1 from public.coach_availability where coach_id = p_coach);
$$;

revoke execute on function public.mgl_reserva_activa(public.coach_bookings) from anon, public;
revoke execute on function public.mgl_reservar(uuid, timestamptz) from anon, public;
revoke execute on function public.mgl_cancelar_reserva(uuid) from anon, public;
revoke execute on function public.mgl_sesion_realizada(uuid) from anon, public;
revoke execute on function public.mgl_link_llamada(uuid) from anon, public;
grant execute on function public.mgl_horarios_ocupados(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.mgl_videollamada_lista(uuid) to anon, authenticated;
grant execute on function public.mgl_reservar(uuid, timestamptz) to authenticated;
grant execute on function public.mgl_cancelar_reserva(uuid) to authenticated;
grant execute on function public.mgl_sesion_realizada(uuid) to authenticated;
grant execute on function public.mgl_link_llamada(uuid) to authenticated;

-- 10. mgl_clase_pedir copia también duración y sesiones de la oferta ───────
create or replace function public.mgl_clase_pedir(p_offering uuid, p_note text, p_videos text[], p_country text, p_price_clp integer)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
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
                        'duration_days', o.duration_days, 'capture_requirements', o.capture_requirements,
                        'call_minutes', o.call_minutes, 'sessions_included', o.sessions_included),
     coalesce(o.price,0), coalesce(nullif(o.currency,''),'CLP'), p_price_clp,
     left(coalesce(p_country,''),2), nullif(btrim(coalesce(p_note,'')),''), coalesce(p_videos,'{}'),
     case when paga then 'por_pagar' else 'pendiente' end,
     case when paga then 'pendiente' else 'sin_pago' end)
  returning id into nid;

  return nid;
end;
$function$;

-- 11. Tiempo real para que el coach vea reservas nuevas ────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coach_bookings') then
    alter publication supabase_realtime add table public.coach_bookings;
  end if;
end $$;

-- 12. Volver a elegir horario de una clase aún no pagada ───────────────────
create or replace function public.mgl_renovar_reserva(p_lesson uuid, p_starts timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.coach_lessons%rowtype;
begin
  select * into l from public.coach_lessons where id = p_lesson;
  if not found or l.student_id <> auth.uid() then raise exception 'Clase no encontrada'; end if;
  if l.payment_status = 'pagado' then raise exception 'Esta clase ya está pagada: reserva o cancela desde tus sesiones'; end if;
  update public.coach_bookings set status = 'cancelada', cancelled_by = auth.uid()
   where lesson_id = l.id and status = 'reservada';
  return public.mgl_reservar(p_lesson, p_starts);
end $$;
revoke execute on function public.mgl_renovar_reserva(uuid, timestamptz) from anon, public;
grant execute on function public.mgl_renovar_reserva(uuid, timestamptz) to authenticated;
