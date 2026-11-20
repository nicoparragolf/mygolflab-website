-- ═══════════════════════════════════════════════════════════════════════════
--  CoachYard · Reportar y bloquear usuarios (requisito App Store, guía 1.2)
--  Archivo: sql/coach_hub_moderacion.sql · 2026-11-19
--
--  · user_blocks   → quién bloqueó a quién. Bloquear corta los mensajes
--                    directos en ambos sentidos y oculta sus mensajes de grupo.
--  · user_reports  → reportes de mensajes, grupos y perfiles de coach.
--                    Cada reporte le manda un aviso push al admin (api/push.js).
--  Idempotente: se puede correr varias veces.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Bloqueos ────────────────────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;

drop policy if exists "bloqueos: veo los mios" on public.user_blocks;
create policy "bloqueos: veo los mios" on public.user_blocks
  for select using (blocker_id = auth.uid());
drop policy if exists "bloqueos: creo los mios" on public.user_blocks;
create policy "bloqueos: creo los mios" on public.user_blocks
  for insert with check (blocker_id = auth.uid());
drop policy if exists "bloqueos: borro los mios" on public.user_blocks;
create policy "bloqueos: borro los mios" on public.user_blocks
  for delete using (blocker_id = auth.uid());

-- ── 2. Reportes ────────────────────────────────────────────────────────────
create table if not exists public.user_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid default auth.uid() references auth.users(id) on delete set null,
  reported_id uuid references auth.users(id) on delete set null,
  context     text not null check (context in ('mensaje', 'grupo', 'perfil_coach', 'contenido')),
  ref_id      text,
  reason      text not null,
  details     text,
  evidence    text,
  status      text not null default 'nuevo' check (status in ('nuevo', 'revisado', 'accion_tomada', 'descartado')),
  created_at  timestamptz not null default now()
);
alter table public.user_reports enable row level security;

drop policy if exists "reportes: veo los mios" on public.user_reports;
create policy "reportes: veo los mios" on public.user_reports
  for select using (reporter_id = auth.uid());
-- (se insertan solo con mgl_reportar, que valida y completa los datos)

-- ── 3. La otra persona de un chat directo ─────────────────────────────────
create or replace function public.mgl_conv_otro(p_player uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case when p.coach_id = auth.uid() then p.user_id
              when p.user_id  = auth.uid() then p.coach_id end
    from public.players p
   where p.id = p_player;
$$;

-- ── 4. Bloquear / desbloquear ─────────────────────────────────────────────
create or replace function public.mgl_bloquear(p_user uuid, p_on boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() then return false; end if;
  if p_on then
    insert into public.user_blocks (blocker_id, blocked_id) values (auth.uid(), p_user)
      on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_user;
  end if;
  return true;
end $$;

-- Bloquear a la otra persona de un chat directo (sin exponer su id)
create or replace function public.mgl_bloquear_conv(p_player uuid, p_on boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_otro uuid;
begin
  v_otro := public.mgl_conv_otro(p_player);
  if v_otro is null then return false; end if;
  return public.mgl_bloquear(v_otro, p_on);
end $$;

-- ¿Bloqueé a la otra persona de este chat?
create or replace function public.mgl_conv_bloqueada(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks
                  where blocker_id = auth.uid() and blocked_id = public.mgl_conv_otro(p_player));
$$;

-- ── 5. Reportar ───────────────────────────────────────────────────────────
--  p_context 'mensaje'      → p_ref = player_id del chat directo
--            'grupo'        → p_ref = group_id (p_reported opcional: autor del mensaje)
--            'perfil_coach' → p_ref = coach_id
--            'contenido'    → p_ref = collection_id
create or replace function public.mgl_reportar(p_context text, p_ref text, p_reason text,
                                               p_details text default null, p_evidence text default null,
                                               p_reported uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_rep uuid := p_reported; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para reportar'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Falta el motivo'; end if;
  if v_rep is null then
    if p_context = 'mensaje' then
      v_rep := public.mgl_conv_otro(p_ref::uuid);
    elsif p_context = 'grupo' then
      select coach_id into v_rep from public.coach_groups where id = p_ref::uuid;
    elsif p_context = 'perfil_coach' then
      v_rep := p_ref::uuid;
    elsif p_context = 'contenido' then
      select coach_id into v_rep from public.coach_collections where id = p_ref::uuid;
    end if;
  end if;
  insert into public.user_reports (reporter_id, reported_id, context, ref_id, reason, details, evidence)
    values (auth.uid(), v_rep, p_context, p_ref, left(p_reason, 80), left(p_details, 2000), left(p_evidence, 4000))
    returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.mgl_conv_otro(uuid)                      from anon;
revoke execute on function public.mgl_bloquear(uuid, boolean)              from anon;
revoke execute on function public.mgl_bloquear_conv(uuid, boolean)         from anon;
revoke execute on function public.mgl_conv_bloqueada(uuid)                 from anon;
revoke execute on function public.mgl_reportar(text, text, text, text, text, uuid) from anon;
grant execute on function public.mgl_conv_otro(uuid)                       to authenticated;
grant execute on function public.mgl_bloquear(uuid, boolean)               to authenticated;
grant execute on function public.mgl_bloquear_conv(uuid, boolean)          to authenticated;
grant execute on function public.mgl_conv_bloqueada(uuid)                  to authenticated;
grant execute on function public.mgl_reportar(text, text, text, text, text, uuid) to authenticated;

-- ── 6. Un bloqueo corta los mensajes directos (en ambos sentidos) ─────────
create or replace function public.mgl_msg_respetar_bloqueo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_coach uuid; v_user uuid; v_otro uuid;
begin
  select coach_id, user_id into v_coach, v_user from public.players where id = new.player_id;
  v_otro := case when new.sender_id = v_coach then v_user else v_coach end;
  if v_otro is not null and exists (
       select 1 from public.user_blocks
        where (blocker_id = v_otro and blocked_id = new.sender_id)
           or (blocker_id = new.sender_id and blocked_id = v_otro)) then
    raise exception 'No puedes enviar mensajes en este chat' using errcode = 'P0001', hint = 'bloqueado';
  end if;
  return new;
end $$;

drop trigger if exists mgl_msg_bloqueo on public.coach_messages;
create trigger mgl_msg_bloqueo before insert on public.coach_messages
  for each row execute function public.mgl_msg_respetar_bloqueo();

-- ── 7. Aviso push al admin con cada reporte ───────────────────────────────
drop trigger if exists mgl_push_reportes on public.user_reports;
create trigger mgl_push_reportes after insert on public.user_reports
  for each row execute function public.mgl_push_avisar();
