-- ═══════════════════════════════════════════════════════════════════════════
--  MyGolfLab / Coach Hub · Eliminar cuenta (requisito de App Store y Google Play)
--  Archivo: sql/borrar_cuenta.sql
--  Versión: 1.0 · 2026-11-02
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente (se puede repetir).
--
--  Crea dos funciones que SOLO puede llamar el servidor (/api/borrar-cuenta.js,
--  con la llave service_role). Nadie desde el navegador puede ejecutarlas.
--
--   mgl_archivos_de_usuario(uid)  → lista los archivos en Storage del usuario
--                                    (para borrarlos antes que la cuenta)
--   mgl_borrar_cuenta(uid)        → borra sus datos en todas las tablas
--
--  Qué se borra:
--   · Si es COACH: sus fichas de jugadores con todo lo que cuelga de ellas
--     (eventos, videos, métricas, metas, planes, notas, rondas, mensajes),
--     su vitrina, ofertas, clases y reseñas.
--   · Si es JUGADOR: todo lo que subió él mismo (eventos, videos, metas…),
--     sus análisis de MyGolfLab, clases y mensajes. La ficha que su coach
--     armó con él NO se borra (es información del coach): solo se desvincula
--     su cuenta y se quita su email.
--   · Al final el servidor borra el usuario de Auth.
--
--  La función recorre las tablas por nombre de columna (player_id, user_id,
--  coach_id, created_by…), así que cubre tablas futuras sin tener que editarla.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Archivos del usuario en Storage ──────────────────────────────────────
create or replace function public.mgl_archivos_de_usuario(p_uid uuid)
returns table(bucket_id text, name text)
language sql
security definer
set search_path = public, storage
as $$
  select o.bucket_id::text, o.name::text
  from storage.objects o
  where (to_jsonb(o) ->> 'owner')    = p_uid::text
     or (to_jsonb(o) ->> 'owner_id') = p_uid::text
     or o.name like p_uid::text || '/%'
$$;

revoke all on function public.mgl_archivos_de_usuario(uuid) from public, anon, authenticated;
grant execute on function public.mgl_archivos_de_usuario(uuid) to service_role;


-- ── 2. Borrar los datos del usuario ─────────────────────────────────────────
create or replace function public.mgl_borrar_cuenta(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_players uuid[] := '{}';
  v_events  uuid[] := '{}';
  v_sql     text[] := '{}';
  v_pend    text[];
  v_fallas  text[];
  v_stmt    text;
  v_n       int;
  v_total   int := 0;
  v_pasada  int := 0;
  r         record;
begin
  if p_uid is null then
    raise exception 'Falta el usuario';
  end if;

  -- Fichas que este usuario creó como coach
  if to_regclass('public.players') is not null then
    select coalesce(array_agg(id), '{}') into v_players
    from public.players where coach_id = p_uid;
  end if;

  -- Eventos que este usuario creó (como coach o como alumno)
  if to_regclass('public.player_events') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'player_events'
                   and column_name = 'created_by') then
    select coalesce(array_agg(id), '{}') into v_events
    from public.player_events where created_by = p_uid;
  end if;

  -- 0) Fichas que otros coaches tienen de este alumno: se desvinculan
  --    (antes de borrar nada, para que su perfil quede libre de referencias)
  if to_regclass('public.players') is not null then
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'players' and column_name = 'email') then
      update public.players set user_id = null, email = null where user_id = p_uid;
    else
      update public.players set user_id = null where user_id = p_uid;
    end if;
  end if;

  -- a) Todo lo que cuelga de sus fichas de coach
  if array_length(v_players, 1) is not null then
    for r in
      select c.table_name from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.column_name = 'player_id' and c.data_type = 'uuid'
        and c.table_name <> 'players'
    loop
      v_sql := v_sql || format('delete from public.%I where player_id = any(%L::uuid[])',
                               r.table_name, v_players);
    end loop;
  end if;

  -- b) Lo que cuelga de los eventos que creó
  if array_length(v_events, 1) is not null then
    for r in
      select c.table_name from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.column_name = 'event_id' and c.data_type = 'uuid'
    loop
      v_sql := v_sql || format('delete from public.%I where event_id = any(%L::uuid[])',
                               r.table_name, v_events);
    end loop;
  end if;

  -- c) Filas que le pertenecen por columna de dueño
  for r in
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type = 'uuid'
      and c.column_name in ('created_by', 'user_id', 'coach_id', 'student_id',
                            'sender_id', 'recipient_id', 'owner_id', 'viewer_id',
                            'reviewer_id', 'author_id')
      and not (c.table_name = 'players' and c.column_name = 'user_id')
  loop
    v_sql := v_sql || format('delete from public.%I where %I = %L::uuid',
                             r.table_name, r.column_name, p_uid);
  end loop;

  -- d) El perfil
  if to_regclass('public.profiles') is not null then
    v_sql := v_sql || format('delete from public.profiles where id = %L::uuid', p_uid);
  end if;

  -- Ejecutar. Si una fila todavía está referenciada por otra tabla (llave
  -- foránea sin cascada), se reintenta en la pasada siguiente, cuando la
  -- fila hija ya se borró.
  v_pend := v_sql;
  while array_length(v_pend, 1) is not null and v_pasada < 8 loop
    v_pasada := v_pasada + 1;
    v_fallas := '{}';
    foreach v_stmt in array v_pend loop
      begin
        execute v_stmt;
        get diagnostics v_n = row_count;
        v_total := v_total + v_n;
      exception when foreign_key_violation then
        v_fallas := v_fallas || v_stmt;
      end;
    end loop;
    exit when array_length(v_fallas, 1) is not null
          and array_length(v_fallas, 1) = array_length(v_pend, 1);
    v_pend := v_fallas;
  end loop;

  if array_length(v_fallas, 1) is not null then
    raise exception 'No se pudieron borrar algunos datos: %', array_to_string(v_fallas, ' | ');
  end if;

  return jsonb_build_object('ok', true, 'filas_borradas', v_total,
                            'fichas_de_coach', coalesce(array_length(v_players, 1), 0));
end;
$$;

revoke all on function public.mgl_borrar_cuenta(uuid) from public, anon, authenticated;
grant execute on function public.mgl_borrar_cuenta(uuid) to service_role;
