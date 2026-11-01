-- ═══════════════════════════════════════════════════════════════════════════
-- Coach Hub · Clases (solicitudes de alumnos desde la vitrina)
-- Archivo: sql/coach_hub_clases.sql
-- Versión: 1.0 · 2026-11-01
--
-- Cómo correrlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Es idempotente: se puede correr más de una vez.
--
-- Flujo (sin pago todavía; Mercado Pago se agrega después):
--   alumno pide una oferta de la vitrina + sube sus videos  → 'pendiente'
--   coach acepta (se crea/vincula la ficha del alumno)      → 'aceptada'
--   coach entrega su análisis                               → 'entregada'
--   coach rechaza                                           → 'rechazada'
--   alumno cancela mientras está pendiente                  → 'cancelada'
--
-- Precios: las ofertas guardan precio + moneda (coach_offerings.currency,
-- 'USD' o 'CLP'). La clase guarda una copia del precio al momento de pedir.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Si existiera una coach_lessons antigua con otra estructura → respaldo
do $$
declare respaldo text := 'coach_lessons_respaldo_' || to_char(now(), 'YYYYMMDD_HH24MI');
begin
  if to_regclass('public.coach_lessons') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'coach_lessons' and column_name = 'student_id'
     ) then
    execute format('alter table public.coach_lessons rename to %I', respaldo);
    raise notice 'Tabla coach_lessons antigua renombrada a %', respaldo;
  end if;
end $$;

-- 0b. Las ofertas ahora pueden tener precio en USD o CLP.
--     Si había una restricción que solo permitía 'CLP', se reemplaza.
do $$
declare r record;
begin
  if to_regclass('public.coach_offerings') is not null then
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='coach_offerings' and column_name='currency') then
      alter table public.coach_offerings add column currency text not null default 'CLP';
    end if;
    for r in
      select con.conname from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname='coach_offerings' and con.contype='c'
        and pg_get_constraintdef(con.oid) ilike '%currency%'
    loop
      execute format('alter table public.coach_offerings drop constraint %I', r.conname);
    end loop;
    alter table public.coach_offerings add constraint coach_offerings_currency_chk check (currency in ('USD','CLP'));
  end if;
end $$;

-- 1. Tabla
create table if not exists public.coach_lessons (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references auth.users(id) on delete cascade,
  student_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_name    text,
  student_email   text,
  offering_id     uuid references public.coach_offerings(id) on delete set null,
  offering        jsonb not null default '{}'::jsonb,     -- copia: título, tipo, qué grabar…
  price           numeric(12,2) not null default 0,
  currency        text not null default 'USD' check (currency in ('USD','CLP')),
  price_clp       integer,                                -- referencia en pesos al pedir
  student_country text,                                   -- 'CL' o 'XX' (detectado en el navegador)
  student_note    text check (char_length(student_note) <= 2000),
  video_paths     text[] not null default '{}',           -- bucket lesson-uploads
  status          text not null default 'pendiente'
                  check (status in ('pendiente','aceptada','entregada','rechazada','cancelada')),
  payment_status  text not null default 'sin_pago'
                  check (payment_status in ('sin_pago','pendiente','pagado','reembolsado')),
  coach_reply     text check (char_length(coach_reply) <= 2000),
  player_id       uuid references public.players(id) on delete set null,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  delivered_at    timestamptz,
  closed_at       timestamptz
);

create index if not exists coach_lessons_coach_idx   on public.coach_lessons (coach_id, created_at desc);
create index if not exists coach_lessons_student_idx on public.coach_lessons (student_id, created_at desc);

-- 2. RLS: el coach ve las clases que recibe; el alumno, las que pidió.
--    Los cambios de estado van SOLO por las funciones de abajo.
alter table public.coach_lessons enable row level security;

drop policy if exists "clases_leer" on public.coach_lessons;
create policy "clases_leer" on public.coach_lessons
  for select using ( coach_id = auth.uid() or student_id = auth.uid() );

grant select on public.coach_lessons to authenticated;

-- 3. Alumno: pedir una clase
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
  o   public.coach_offerings%rowtype;
  u   record;
  nid uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select * into o from public.coach_offerings where id = p_offering and is_active = true;
  if not found then raise exception 'Esta oferta ya no está disponible'; end if;
  if o.coach_id = auth.uid() then raise exception 'No puedes pedirte una clase a ti mismo'; end if;

  -- la evaluación inicial se puede pedir una sola vez por coach
  if o.is_trial and exists (
    select 1 from public.coach_lessons
    where student_id = auth.uid() and coach_id = o.coach_id
      and (offering->>'is_trial')::boolean is true
      and status <> 'cancelada'
  ) then
    raise exception 'Ya pediste la evaluación inicial con este coach';
  end if;

  -- los videos tienen que estar en la carpeta del propio alumno
  if exists (select 1 from unnest(coalesce(p_videos,'{}')) v where split_part(v,'/',1) <> auth.uid()::text) then
    raise exception 'Videos inválidos';
  end if;

  select coalesce(nullif(raw_user_meta_data->>'full_name',''),
                  nullif(trim(coalesce(raw_user_meta_data->>'first_name','')||' '||coalesce(raw_user_meta_data->>'last_name','')),''),
                  split_part(email,'@',1)) as name,
         email
    into u from auth.users where id = auth.uid();

  insert into public.coach_lessons
    (coach_id, student_id, student_name, student_email, offering_id, offering,
     price, currency, price_clp, student_country, student_note, video_paths)
  values
    (o.coach_id, auth.uid(), u.name, u.email, o.id,
     jsonb_build_object('title', o.title, 'kind', o.kind, 'is_trial', o.is_trial,
                        'description', o.description, 'analyses_included', o.analyses_included,
                        'duration_days', o.duration_days, 'capture_requirements', o.capture_requirements),
     coalesce(o.price,0), coalesce(nullif(o.currency,''),'CLP'), p_price_clp,
     left(coalesce(p_country,''),2), nullif(btrim(coalesce(p_note,'')),''), coalesce(p_videos,'{}'))
  returning id into nid;

  return nid;
end;
$$;

-- 4. Alumno: cancelar mientras está pendiente
create or replace function public.mgl_clase_cancelar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coach_lessons
     set status = 'cancelada', closed_at = now()
   where id = p_id and student_id = auth.uid() and status = 'pendiente';
  if not found then raise exception 'No se puede cancelar esta clase'; end if;
end;
$$;

-- 5. Coach: aceptar → crea (o reutiliza) la ficha del alumno en Coach Hub
create or replace function public.mgl_clase_aceptar(p_id uuid, p_reply text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  l    public.coach_lessons%rowtype;
  pid  uuid;
  fn   text;
  ln   text;
begin
  select * into l from public.coach_lessons where id = p_id and coach_id = auth.uid() for update;
  if not found then raise exception 'Clase no encontrada'; end if;
  if l.status <> 'pendiente' then raise exception 'Esta clase ya fue respondida'; end if;

  select id into pid from public.players
   where coach_id = l.coach_id and user_id = l.student_id
   limit 1;

  if pid is null then
    select id into pid from public.players
     where coach_id = l.coach_id and lower(email) = lower(l.student_email)
     limit 1;
    if pid is not null then
      update public.players set user_id = l.student_id where id = pid and user_id is null;
    end if;
  end if;

  if pid is null then
    fn := split_part(coalesce(l.student_name,'Alumno'),' ',1);
    ln := nullif(btrim(substr(coalesce(l.student_name,''), length(fn)+1)),'');
    insert into public.players (coach_id, first_name, last_name, email, user_id, category, stats_tier, coaching_since)
    values (l.coach_id, fn, coalesce(ln,'(online)'), l.student_email, l.student_id, 'amateur', 'basico', current_date)
    returning id into pid;
  end if;

  update public.coach_lessons
     set status = 'aceptada', accepted_at = now(), player_id = pid,
         coach_reply = nullif(btrim(coalesce(p_reply,'')),'')
   where id = p_id;

  return pid;
end;
$$;

-- 6. Coach: rechazar
create or replace function public.mgl_clase_rechazar(p_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coach_lessons
     set status = 'rechazada', closed_at = now(), coach_reply = nullif(btrim(coalesce(p_reply,'')),'')
   where id = p_id and coach_id = auth.uid() and status = 'pendiente';
  if not found then raise exception 'No se puede rechazar esta clase'; end if;
end;
$$;

-- 7. Coach: marcar entregada
create or replace function public.mgl_clase_entregar(p_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coach_lessons
     set status = 'entregada', delivered_at = now(), closed_at = now(),
         coach_reply = coalesce(nullif(btrim(coalesce(p_reply,'')),''), coach_reply)
   where id = p_id and coach_id = auth.uid() and status = 'aceptada';
  if not found then raise exception 'Solo se pueden entregar clases aceptadas'; end if;
end;
$$;

grant execute on function public.mgl_clase_pedir(uuid, text, text[], text, integer) to authenticated;
grant execute on function public.mgl_clase_cancelar(uuid)        to authenticated;
grant execute on function public.mgl_clase_aceptar(uuid, text)   to authenticated;
grant execute on function public.mgl_clase_rechazar(uuid, text)  to authenticated;
grant execute on function public.mgl_clase_entregar(uuid, text)  to authenticated;

-- 8. Storage: videos que sube el alumno al pedir la clase
--    Ruta: {student_id}/{carpeta}/{archivo}. Privado, 500 MB por archivo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('lesson-uploads', 'lesson-uploads', false, 524288000)
on conflict (id) do nothing;

drop policy if exists "lesson_uploads_subir"  on storage.objects;
drop policy if exists "lesson_uploads_leer"   on storage.objects;
drop policy if exists "lesson_uploads_borrar" on storage.objects;

create policy "lesson_uploads_subir" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'lesson-uploads' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "lesson_uploads_leer" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lesson-uploads' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.coach_lessons l
        where l.coach_id = auth.uid() and name = any(l.video_paths)
      )
    )
  );

create policy "lesson_uploads_borrar" on storage.objects
  for delete to authenticated
  using ( bucket_id = 'lesson-uploads' and (storage.foldername(name))[1] = auth.uid()::text );

-- 9. Tiempo real (para que la clase nueva aparezca sin recargar)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coach_lessons') then
    alter publication supabase_realtime add table public.coach_lessons;
  end if;
end $$;
