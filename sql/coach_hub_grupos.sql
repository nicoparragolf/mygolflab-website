-- ═══════════════════════════════════════════════════════════════════════════
-- CoachYard · Grupos de mensajes (coach → varios alumnos)
-- Archivo: sql/coach_hub_grupos.sql
-- Versión: 1.0 · 2026-11-10
--
-- Cómo correrlo: Supabase → SQL Editor → New query → pegar todo → Run.
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- Requiere haber corrido antes sql/coach_hub_mensajes.sql.
--
-- Modelo:
--   coach_groups          un grupo creado por un coach (nombre, descripción,
--                         y si es solo de anuncios o los alumnos pueden responder)
--   coach_group_members   qué fichas de alumno (players) están en el grupo.
--                         Si el alumno aún no vincula su cuenta, igual queda
--                         en el grupo y verá todo cuando se vincule.
--   coach_group_messages  los mensajes del grupo
--   coach_group_reads     hasta dónde leyó cada persona (para "no leídos" y "Visto por")
-- Nadie fuera del grupo puede leer ni escribir (RLS).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Tablas ─────────────────────────────────────────────────────────────────
create table if not exists public.coach_groups (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  description  text check (description is null or char_length(description) <= 300),
  solo_coach   boolean not null default true,   -- true = anuncios (solo escribe el coach)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists coach_groups_coach_idx on public.coach_groups (coach_id);

create table if not exists public.coach_group_members (
  group_id   uuid not null references public.coach_groups(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (group_id, player_id)
);
create index if not exists coach_group_members_player_idx on public.coach_group_members (player_id);

create table if not exists public.coach_group_messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.coach_groups(id) on delete cascade,
  sender_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists coach_group_messages_group_created_idx
  on public.coach_group_messages (group_id, created_at desc);

create table if not exists public.coach_group_reads (
  group_id      uuid not null references public.coach_groups(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 2. Ayudantes (security definer para no depender del RLS de players) ──────
create or replace function public.mgl_grp_es_coach(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.coach_groups where id = p_group and coach_id = auth.uid());
$$;

create or replace function public.mgl_grp_es_miembro(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.coach_group_members m
      join public.players p on p.id = m.player_id
     where m.group_id = p_group and p.user_id = auth.uid()
  );
$$;

create or replace function public.mgl_grp_puede_ver(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mgl_grp_es_coach(p_group) or public.mgl_grp_es_miembro(p_group);
$$;

-- ¿Puedo escribir? El coach siempre; el alumno solo si el grupo no es de anuncios
create or replace function public.mgl_grp_puede_escribir(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mgl_grp_es_coach(p_group)
      or (public.mgl_grp_es_miembro(p_group)
          and exists (select 1 from public.coach_groups where id = p_group and not solo_coach));
$$;

-- 3. RLS ────────────────────────────────────────────────────────────────────
alter table public.coach_groups         enable row level security;
alter table public.coach_group_members  enable row level security;
alter table public.coach_group_messages enable row level security;
alter table public.coach_group_reads    enable row level security;

-- Grupos: los ve el coach y sus miembros; solo el coach crea, edita y borra
drop policy if exists grp_leer      on public.coach_groups;
drop policy if exists grp_crear     on public.coach_groups;
drop policy if exists grp_editar    on public.coach_groups;
drop policy if exists grp_borrar    on public.coach_groups;
create policy grp_leer   on public.coach_groups for select using ( coach_id = auth.uid() or public.mgl_grp_es_miembro(id) );
create policy grp_crear  on public.coach_groups for insert with check ( coach_id = auth.uid() );
create policy grp_editar on public.coach_groups for update using ( coach_id = auth.uid() ) with check ( coach_id = auth.uid() );
create policy grp_borrar on public.coach_groups for delete using ( coach_id = auth.uid() );

-- Miembros: el coach del grupo los maneja, y solo puede agregar fichas suyas.
-- El alumno puede ver la fila de su propia ficha.
drop policy if exists grpm_leer    on public.coach_group_members;
drop policy if exists grpm_agregar on public.coach_group_members;
drop policy if exists grpm_quitar  on public.coach_group_members;
create policy grpm_leer on public.coach_group_members for select using (
  public.mgl_grp_es_coach(group_id)
  or exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid())
);
create policy grpm_agregar on public.coach_group_members for insert with check (
  public.mgl_grp_es_coach(group_id)
  and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
);
create policy grpm_quitar on public.coach_group_members for delete using ( public.mgl_grp_es_coach(group_id) );

-- Mensajes
drop policy if exists grpmsg_leer     on public.coach_group_messages;
drop policy if exists grpmsg_escribir on public.coach_group_messages;
drop policy if exists grpmsg_borrar   on public.coach_group_messages;
create policy grpmsg_leer on public.coach_group_messages for select using ( public.mgl_grp_puede_ver(group_id) );
create policy grpmsg_escribir on public.coach_group_messages for insert with check (
  sender_id = auth.uid() and public.mgl_grp_puede_escribir(group_id)
);
-- Cada uno borra lo suyo; el coach puede borrar cualquier mensaje de su grupo (moderar)
create policy grpmsg_borrar on public.coach_group_messages for delete using (
  sender_id = auth.uid() or public.mgl_grp_es_coach(group_id)
);

-- Lecturas: cada uno ve las suyas; el coach ve las de su grupo (para "Visto por")
drop policy if exists grpr_leer on public.coach_group_reads;
create policy grpr_leer on public.coach_group_reads for select using (
  user_id = auth.uid() or public.mgl_grp_es_coach(group_id)
);
-- (sin insert/update directo: se marca con mgl_grp_marcar_leido)

grant select, insert, update, delete on public.coach_groups         to authenticated;
grant select, insert, delete         on public.coach_group_members  to authenticated;
grant select, insert, delete         on public.coach_group_messages to authenticated;
grant select                         on public.coach_group_reads    to authenticated;

-- 4. Funciones para la app ──────────────────────────────────────────────────

-- Marcar un grupo como leído hasta ahora
create or replace function public.mgl_grp_marcar_leido(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.mgl_grp_puede_ver(p_group) then return; end if;
  insert into public.coach_group_reads (group_id, user_id, last_read_at)
  values (p_group, auth.uid(), now())
  on conflict (group_id, user_id) do update set last_read_at = now();
end $$;

-- Mis grupos (como coach o como alumno) con datos para la lista
create or replace function public.mgl_grp_mis_grupos()
returns table (group_id uuid, name text, description text, solo_coach boolean, coach_id uuid,
               coach_name text, coach_avatar text, members int, soy_coach boolean,
               last_read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.description, g.solo_coach, g.coach_id,
         coalesce(nullif(cp.display_name, ''), nullif(u.raw_user_meta_data->>'full_name', ''), 'Tu coach'),
         coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'),
         (select count(*)::int from public.coach_group_members m where m.group_id = g.id),
         g.coach_id = auth.uid(),
         (select r.last_read_at from public.coach_group_reads r where r.group_id = g.id and r.user_id = auth.uid()),
         g.created_at
    from public.coach_groups g
    left join public.coach_profiles cp on cp.coach_id = g.coach_id
    left join auth.users u on u.id = g.coach_id
   where g.coach_id = auth.uid() or public.mgl_grp_es_miembro(g.id);
$$;

-- Mensajes sin leer por grupo (para la lista y el contador del menú)
create or replace function public.mgl_grp_no_leidos()
returns table (group_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select g.id, count(msg.id)::int
    from public.coach_groups g
    join public.coach_group_messages msg on msg.group_id = g.id
    left join public.coach_group_reads r on r.group_id = g.id and r.user_id = auth.uid()
   where (g.coach_id = auth.uid() or public.mgl_grp_es_miembro(g.id))
     and msg.sender_id <> auth.uid()
     and msg.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
   group by g.id;
$$;

-- Nombres de quienes participan en un grupo (para mostrar quién escribió).
-- El alumno no puede leer las fichas de sus compañeros: solo recibe nombre y foto.
create or replace function public.mgl_grp_personas(p_group uuid)
returns table (user_id uuid, name text, avatar text, es_coach boolean)
language sql stable security definer set search_path = public as $$
  select g.coach_id,
         coalesce(nullif(cp.display_name, ''), nullif(u.raw_user_meta_data->>'full_name', ''), 'Coach'),
         coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'),
         true
    from public.coach_groups g
    left join public.coach_profiles cp on cp.coach_id = g.coach_id
    left join auth.users u on u.id = g.coach_id
   where g.id = p_group and public.mgl_grp_puede_ver(p_group)
  union all
  select p.user_id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         p.photo_url,
         false
    from public.coach_group_members m
    join public.players p on p.id = m.player_id
   where m.group_id = p_group and p.user_id is not null and public.mgl_grp_puede_ver(p_group);
$$;

grant execute on function public.mgl_grp_es_coach(uuid)        to authenticated;
grant execute on function public.mgl_grp_es_miembro(uuid)      to authenticated;
grant execute on function public.mgl_grp_puede_ver(uuid)       to authenticated;
grant execute on function public.mgl_grp_puede_escribir(uuid)  to authenticated;
grant execute on function public.mgl_grp_marcar_leido(uuid)    to authenticated;
grant execute on function public.mgl_grp_mis_grupos()          to authenticated;
grant execute on function public.mgl_grp_no_leidos()           to authenticated;
grant execute on function public.mgl_grp_personas(uuid)        to authenticated;

-- 5. updated_at del grupo al editarlo ───────────────────────────────────────
create or replace function public.mgl_grp_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists mgl_grp_touch on public.coach_groups;
create trigger mgl_grp_touch before update on public.coach_groups
  for each row execute function public.mgl_grp_touch();

-- 6. Tiempo real: mensajes de grupo llegan sin recargar ─────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coach_group_messages') then
    alter publication supabase_realtime add table public.coach_group_messages;
  end if;
end $$;

-- 7. Avisos push (solo si ya corriste sql/coach_hub_push.sql) ───────────────
do $$
begin
  if to_regprocedure('public.mgl_push_avisar()') is not null then
    execute 'drop trigger if exists mgl_push_grupos on public.coach_group_messages';
    execute 'create trigger mgl_push_grupos after insert on public.coach_group_messages
               for each row execute function public.mgl_push_avisar()';
  end if;
end $$;
