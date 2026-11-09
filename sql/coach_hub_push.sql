-- ═══════════════════════════════════════════════════════════════════════════
-- Coach Hub · Avisos push (mensajes y clases)
-- Archivo: sql/coach_hub_push.sql · 2026-11-09
--
-- 1. Tabla push_tokens: el token de cada teléfono donde está instalada la app.
-- 2. Disparadores en coach_messages y coach_lessons: cuando llega un mensaje
--    o una clase, la base de datos avisa a https://mygolflab.golf/api/push,
--    que manda el aviso al teléfono de quien corresponda.
--
-- Se puede correr más de una vez sin problema.
-- ANTES de correrlo, reemplaza PEGAR_AQUI_LA_CLAVE (abajo) por la clave
-- secreta que también va en Vercel como PUSH_SECRET.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ── 1. Tokens ───────────────────────────────────────────────────────────────
create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null default 'ios' check (platform in ('ios','android')),
  lang        text not null default 'es' check (lang in ('es','en','pt')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

drop policy if exists push_tokens_propios on public.push_tokens;
create policy push_tokens_propios on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Si el mismo teléfono cambia de cuenta, el token pasa a la cuenta nueva
create or replace function public.mgl_push_registrar(p_token text, p_platform text, p_lang text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(p_token,'') = '' then return; end if;
  insert into public.push_tokens (token, user_id, platform, lang, updated_at)
  values (p_token, auth.uid(),
          case when p_platform = 'android' then 'android' else 'ios' end,
          case when p_lang in ('en','pt') then p_lang else 'es' end,
          now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform,
        lang = excluded.lang, updated_at = now();
end $$;
grant execute on function public.mgl_push_registrar(text, text, text) to authenticated;

-- ── 2. Clave compartida con Vercel (nadie la puede leer desde la app) ───────
create table if not exists public.mgl_config (
  clave  text primary key,
  valor  text not null
);
alter table public.mgl_config enable row level security;   -- sin políticas: solo el servidor
insert into public.mgl_config (clave, valor) values ('push_secret', 'PEGAR_AQUI_LA_CLAVE')
  on conflict (clave) do update set valor = excluded.valor;

-- ── 3. Disparador: avisar al servidor ───────────────────────────────────────
create or replace function public.mgl_push_avisar()
returns trigger language plpgsql security definer set search_path = public, net as $$
declare
  v_secret text;
begin
  select valor into v_secret from public.mgl_config where clave = 'push_secret';
  if v_secret is null or v_secret = 'PEGAR_AQUI_LA_CLAVE' then return new; end if;
  perform net.http_post(
    url     := 'https://mygolflab.golf/api/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body    := jsonb_build_object(
                 'tabla', tg_table_name,
                 'op',    tg_op,
                 'fila',  to_jsonb(new),
                 'antes', case when tg_op = 'UPDATE' then to_jsonb(old) else null end),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;   -- un aviso que falla nunca debe impedir guardar el mensaje o la clase
end $$;

drop trigger if exists mgl_push_mensajes on public.coach_messages;
create trigger mgl_push_mensajes after insert on public.coach_messages
  for each row execute function public.mgl_push_avisar();

drop trigger if exists mgl_push_clases on public.coach_lessons;
create trigger mgl_push_clases after insert or update of status, payment_status on public.coach_lessons
  for each row execute function public.mgl_push_avisar();
