-- ═══════════════════════════════════════════════════════════════════════════
-- Coach Hub · Mensajes (coach ↔ jugador)
-- Archivo: sql/coach_hub_mensajes.sql
-- Versión: 1.1 · 2026-11-01
--   1.1: si ya existía una tabla coach_messages antigua (con otras columnas),
--        se renombra a coach_messages_respaldo_YYYYMMDD (no se borra nada)
--        y se crea la nueva.
--
-- Cómo correrlo: Supabase → SQL Editor → New query → pegar todo → Run.
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- Modelo: cada ficha de jugador (players) es una conversación entre
--   - el coach de la ficha   (players.coach_id)
--   - el jugador vinculado   (players.user_id)
-- Nadie más puede leer ni escribir en esa conversación (RLS).
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. ¿Hay una coach_messages antigua con otra estructura? → respaldo
do $$
declare respaldo text := 'coach_messages_respaldo_' || to_char(now(), 'YYYYMMDD_HH24MI');
begin
  if to_regclass('public.coach_messages') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'coach_messages' and column_name = 'player_id'
     ) then
    -- sacarla de tiempo real antes de renombrar (si estaba)
    if exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coach_messages') then
      execute 'alter publication supabase_realtime drop table public.coach_messages';
    end if;
    execute format('alter table public.coach_messages rename to %I', respaldo);
    raise notice 'Tabla coach_messages antigua renombrada a %', respaldo;
  end if;
end $$;

-- 1. Tabla
create table if not exists public.coach_messages (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  sender_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists coach_messages_player_created_idx
  on public.coach_messages (player_id, created_at desc);
create index if not exists coach_messages_unread_idx
  on public.coach_messages (player_id) where read_at is null;

-- 2. ¿El usuario actual es parte de la conversación de esta ficha?
--    security definer para que funcione aunque el RLS de players cambie.
create or replace function public.mgl_msg_puede(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.players
    where id = p_player
      and (coach_id = auth.uid() or user_id = auth.uid())
  );
$$;

-- 3. RLS
alter table public.coach_messages enable row level security;

drop policy if exists "msg_leer"     on public.coach_messages;
drop policy if exists "msg_escribir" on public.coach_messages;
drop policy if exists "msg_borrar"   on public.coach_messages;

-- Leer: solo coach y jugador de la ficha
create policy "msg_leer" on public.coach_messages
  for select using ( public.mgl_msg_puede(player_id) );

-- Escribir: solo como uno mismo y en una conversación propia
create policy "msg_escribir" on public.coach_messages
  for insert with check ( sender_id = auth.uid() and public.mgl_msg_puede(player_id) );

-- Borrar: cada uno solo sus propios mensajes
create policy "msg_borrar" on public.coach_messages
  for delete using ( sender_id = auth.uid() );

-- (Sin política de update: "leído" se marca solo con la función de abajo)

-- 4. Marcar como leídos los mensajes que me mandaron en una conversación
create or replace function public.mgl_msg_marcar_leidos(p_player uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.mgl_msg_puede(p_player) then
    return 0;
  end if;
  update public.coach_messages
     set read_at = now()
   where player_id = p_player
     and sender_id <> auth.uid()
     and read_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.mgl_msg_puede(uuid)          to authenticated;
grant execute on function public.mgl_msg_marcar_leidos(uuid)  to authenticated;
grant select, insert, delete on public.coach_messages         to authenticated;

-- 5. Tiempo real: que los mensajes nuevos lleguen sin recargar la página
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'coach_messages'
  ) then
    alter publication supabase_realtime add table public.coach_messages;
  end if;
end $$;

-- 6. Nombre del coach para el jugador.
--    El jugador no puede leer el perfil del coach, así que esta función
--    devuelve solo el nombre (y foto si tiene) de los coaches de sus fichas.
create or replace function public.mgl_msg_mis_coaches()
returns table (player_id uuid, coach_id uuid, coach_name text, coach_avatar text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.coach_id,
         coalesce(
           nullif(cp.display_name, ''),
           nullif(u.raw_user_meta_data->>'full_name', ''),
           'Tu coach'
         ),
         coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
    from public.players p
    left join public.coach_profiles cp on cp.coach_id = p.coach_id
    left join auth.users u on u.id = p.coach_id
   where p.user_id = auth.uid();
$$;

grant execute on function public.mgl_msg_mis_coaches() to authenticated;
