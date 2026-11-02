-- ═══════════════════════════════════════════════════════════════════════════
-- Coach Hub · Contenido exclusivo (colecciones de videos con tips)
-- Archivo: sql/coach_hub_contenido.sql
-- Versión: 1.0 · 2026-11-02
--
-- Requiere haber corrido antes: coach_hub_clases.sql y coach_hub_pagos.sql
-- (usa la misma configuración de comisiones: mgl_pagos_config).
--
-- Cómo correrlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Es idempotente: se puede correr más de una vez.
--
-- Modelo:
--   · El coach arma COLECCIONES (ej. "Putting bajo presión · 8 tips") con
--     precio único en USD o CLP (0 = gratis).
--   · Cada colección tiene VIDEOS. El coach puede marcar algunos como
--     "vista previa": esos los ve cualquiera, aunque no haya comprado.
--   · El alumno paga UNA vez y queda con acceso para siempre.
--   · Mismo cobro que las clases: el alumno paga un cargo por servicio (5%)
--     y el coach una comisión escalonada según sus ventas de contenido del
--     mes (5% → 3% → 2%). Con alumnos que ya eran suyos: 0%.
--   · Mientras Flow no esté activo, el coach puede DAR ACCESO a mano a un
--     correo (alumno propio, regalo o pago coordinado por fuera).
--
-- Archivos:
--   · Videos  → bucket PRIVADO coach-content: {coach_id}/{coleccion}/{archivo}
--               (solo lo ve el coach, quien compró, o cualquiera si es vista previa)
--   · Portadas y miniaturas → bucket público coach-public:
--               {coach_id}/contenido/{coleccion}/{archivo}
-- ═══════════════════════════════════════════════════════════════════════════


-- 1. Colecciones ─────────────────────────────────────────────────────────────
create table if not exists public.coach_collections (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 2 and 120),
  description   text check (char_length(description) <= 4000),
  area          text not null default 'full_swing'
                check (area in ('full_swing','juego_corto','putter','fisico','estrategia')),
  level         text not null default 'todos'
                check (level in ('todos','iniciacion','intermedio','avanzado')),
  price         numeric(12,2) not null default 0 check (price >= 0),
  currency      text not null default 'USD' check (currency in ('USD','CLP')),
  cover_path    text,
  is_published  boolean not null default false,
  sort_order    int not null default 0,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists coach_collections_coach_idx on public.coach_collections (coach_id, sort_order, created_at);
create index if not exists coach_collections_pub_idx   on public.coach_collections (is_published, published_at desc);


-- 2. Videos de cada colección ───────────────────────────────────────────────
create table if not exists public.coach_collection_items (
  id             uuid primary key default gen_random_uuid(),
  collection_id  uuid not null references public.coach_collections(id) on delete cascade,
  coach_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null default 'Video' check (char_length(btrim(title)) between 1 and 140),
  description    text check (char_length(description) <= 2000),
  video_path     text not null,                 -- bucket coach-content
  thumb_path     text,                          -- bucket coach-public
  duration_sec   int,
  size_bytes     bigint,
  is_preview     boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists coach_collection_items_col_idx on public.coach_collection_items (collection_id, sort_order, created_at);


-- 3. Compras / accesos ──────────────────────────────────────────────────────
--    (la columna del comprador se llama student_id, igual que en las clases,
--     para que "Eliminar cuenta" la encuentre sola)
create table if not exists public.content_purchases (
  id               uuid primary key default gen_random_uuid(),
  collection_id    uuid not null references public.coach_collections(id) on delete cascade,
  coach_id         uuid not null references auth.users(id) on delete cascade,
  student_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_name     text,
  student_email    text,
  title            text,                                   -- copia del título al comprar
  price            numeric(12,2) not null default 0,
  currency         text not null default 'USD' check (currency in ('USD','CLP')),
  student_country  text,
  status           text not null default 'por_pagar'
                   check (status in ('por_pagar','pagado','otorgado','fallido','reembolsado')),
  granted_by       uuid references auth.users(id) on delete set null,   -- si el coach dio acceso a mano
  base_clp         integer,
  service_fee_clp  integer,
  amount_clp       integer,
  usd_clp_rate     numeric(10,2),
  commission_pct   numeric(5,2),
  commission_clp   integer,
  coach_payout_clp integer,
  is_own_student   boolean,
  flow_token       text,
  flow_order       bigint,
  payment_method   text,
  paid_at          timestamptz,
  payout_status    text not null default 'no_aplica' check (payout_status in ('no_aplica','por_liquidar','liquidado')),
  paid_out_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists content_purchases_uniq   on public.content_purchases (collection_id, student_id);
create index        if not exists content_purchases_coach  on public.content_purchases (coach_id, paid_at);
create index        if not exists content_purchases_buyer  on public.content_purchases (student_id, created_at desc);


-- 4. Funciones de ayuda (security definer: no dependen del RLS de cada tabla)
create or replace function public.mgl_es_coach()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('coach','ambos'))
$$;

-- ¿El usuario actual tiene acceso completo a la colección? (dueño o compró)
create or replace function public.mgl_contenido_acceso(p_collection uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.coach_collections c where c.id = p_collection and c.coach_id = auth.uid())
    or exists (select 1 from public.content_purchases p
               where p.collection_id = p_collection and p.student_id = auth.uid()
                 and p.status in ('pagado','otorgado'))
  )
$$;

-- ¿Puede ver la ficha de la colección? (publicada, o tiene acceso)
create or replace function public.mgl_contenido_visible(p_collection uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.coach_collections c where c.id = p_collection and c.is_published)
      or public.mgl_contenido_acceso(p_collection)
$$;

-- ¿Puede reproducir este archivo del bucket coach-content?
create or replace function public.mgl_contenido_puede_ver_video(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.coach_collection_items i
    join public.coach_collections c on c.id = i.collection_id
    where i.video_path = p_name
      and ( (i.is_preview and c.is_published) or public.mgl_contenido_acceso(c.id) )
  )
$$;

-- ¿La colección ya tiene compradores? (entonces no se puede borrar, solo ocultar)
create or replace function public.mgl_contenido_tiene_ventas(p_collection uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.content_purchases p
                 where p.collection_id = p_collection and p.status in ('pagado','otorgado','reembolsado'))
$$;

grant execute on function public.mgl_es_coach()                     to anon, authenticated;
grant execute on function public.mgl_contenido_acceso(uuid)         to anon, authenticated;
grant execute on function public.mgl_contenido_visible(uuid)        to anon, authenticated;
grant execute on function public.mgl_contenido_puede_ver_video(text) to anon, authenticated;
grant execute on function public.mgl_contenido_tiene_ventas(uuid)   to anon, authenticated;


-- 5. RLS ─────────────────────────────────────────────────────────────────────
alter table public.coach_collections      enable row level security;
alter table public.coach_collection_items enable row level security;
alter table public.content_purchases      enable row level security;

-- colecciones
drop policy if exists "colecciones_leer"    on public.coach_collections;
drop policy if exists "colecciones_crear"   on public.coach_collections;
drop policy if exists "colecciones_editar"  on public.coach_collections;
drop policy if exists "colecciones_borrar"  on public.coach_collections;
create policy "colecciones_leer" on public.coach_collections
  for select using ( is_published or coach_id = auth.uid() or public.mgl_contenido_acceso(id) );
create policy "colecciones_crear" on public.coach_collections
  for insert to authenticated with check ( coach_id = auth.uid() and public.mgl_es_coach() );
create policy "colecciones_editar" on public.coach_collections
  for update to authenticated using ( coach_id = auth.uid() ) with check ( coach_id = auth.uid() );
create policy "colecciones_borrar" on public.coach_collections
  for delete to authenticated using ( coach_id = auth.uid() and not public.mgl_contenido_tiene_ventas(id) );

-- videos (la lista con títulos se ve en colecciones publicadas; el archivo lo protege Storage)
drop policy if exists "contenido_items_leer"   on public.coach_collection_items;
drop policy if exists "contenido_items_crear"  on public.coach_collection_items;
drop policy if exists "contenido_items_editar" on public.coach_collection_items;
drop policy if exists "contenido_items_borrar" on public.coach_collection_items;
create policy "contenido_items_leer" on public.coach_collection_items
  for select using ( coach_id = auth.uid() or public.mgl_contenido_visible(collection_id) );
create policy "contenido_items_crear" on public.coach_collection_items
  for insert to authenticated with check (
    coach_id = auth.uid()
    and exists (select 1 from public.coach_collections c where c.id = collection_id and c.coach_id = auth.uid())
  );
create policy "contenido_items_editar" on public.coach_collection_items
  for update to authenticated using ( coach_id = auth.uid() ) with check ( coach_id = auth.uid() );
create policy "contenido_items_borrar" on public.coach_collection_items
  for delete to authenticated using ( coach_id = auth.uid() );

-- compras: el alumno ve las suyas; el coach, las ventas confirmadas y los accesos que dio.
-- Nadie escribe directo: todo pasa por las funciones de abajo o por el servidor de pagos.
drop policy if exists "compras_leer" on public.content_purchases;
create policy "compras_leer" on public.content_purchases
  for select using (
    student_id = auth.uid()
    or (coach_id = auth.uid() and status in ('pagado','otorgado','reembolsado'))
  );

grant select on public.coach_collections, public.coach_collection_items to anon, authenticated;
grant insert, update, delete on public.coach_collections, public.coach_collection_items to authenticated;
grant select on public.content_purchases to authenticated;

-- updated_at automático
create or replace function public.mgl_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists coach_collections_touch on public.coach_collections;
create trigger coach_collections_touch before update on public.coach_collections
  for each row execute function public.mgl_touch_updated_at();
drop trigger if exists content_purchases_touch on public.content_purchases;
create trigger content_purchases_touch before update on public.content_purchases
  for each row execute function public.mgl_touch_updated_at();

-- fecha de publicación (la primera vez que se publica)
create or replace function public.mgl_coleccion_publicada()
returns trigger language plpgsql as $$
begin
  if new.is_published and (tg_op = 'INSERT' or not coalesce(old.is_published,false)) and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists coach_collections_pub on public.coach_collections;
create trigger coach_collections_pub before insert or update on public.coach_collections
  for each row execute function public.mgl_coleccion_publicada();


-- 6. Alumno: comprar (o tomar gratis) una colección ─────────────────────────
--    Devuelve { id, status }:
--      'otorgado'  → colección gratis o ya tenía acceso: puede ver todo
--      'pagado'    → ya la había comprado
--      'por_pagar' → hay que llamar a /api/contenido-pagar para ir a Flow
create or replace function public.mgl_contenido_comprar(p_collection uuid, p_country text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c   public.coach_collections%rowtype;
  p   public.content_purchases%rowtype;
  u   record;
  st  text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select * into c from public.coach_collections where id = p_collection;
  if not found then raise exception 'Esta colección no existe'; end if;
  if c.coach_id = auth.uid() then raise exception 'Esta colección es tuya'; end if;

  select * into p from public.content_purchases where collection_id = c.id and student_id = auth.uid();
  if found and p.status in ('pagado','otorgado') then
    return jsonb_build_object('id', p.id, 'status', p.status);
  end if;

  if not c.is_published then raise exception 'Esta colección ya no está a la venta'; end if;

  select coalesce(nullif(raw_user_meta_data->>'full_name',''),
                  nullif(trim(coalesce(raw_user_meta_data->>'first_name','')||' '||coalesce(raw_user_meta_data->>'last_name','')),''),
                  split_part(email,'@',1)) as name,
         email
    into u from auth.users where id = auth.uid();

  st := case when coalesce(c.price,0) > 0 then 'por_pagar' else 'otorgado' end;

  insert into public.content_purchases
    (collection_id, coach_id, student_id, student_name, student_email, title, price, currency, student_country, status)
  values
    (c.id, c.coach_id, auth.uid(), u.name, u.email, c.title, coalesce(c.price,0), c.currency, left(coalesce(p_country,''),2), st)
  on conflict (collection_id, student_id) do update
    set status = excluded.status, title = excluded.title, price = excluded.price, currency = excluded.currency,
        student_name = excluded.student_name, student_email = excluded.student_email,
        student_country = excluded.student_country,
        flow_token = null, base_clp = null, service_fee_clp = null, amount_clp = null
  returning * into p;

  return jsonb_build_object('id', p.id, 'status', p.status);
end;
$$;


-- 7. Coach: dar acceso a mano a un correo ───────────────────────────────────
create or replace function public.mgl_contenido_otorgar(p_collection uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c   public.coach_collections%rowtype;
  u   record;
  p   public.content_purchases%rowtype;
  em  text := lower(btrim(coalesce(p_email,'')));
begin
  select * into c from public.coach_collections where id = p_collection and coach_id = auth.uid();
  if not found then raise exception 'Colección no encontrada'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo inválido'; end if;

  select id, email,
         coalesce(nullif(raw_user_meta_data->>'full_name',''),
                  nullif(trim(coalesce(raw_user_meta_data->>'first_name','')||' '||coalesce(raw_user_meta_data->>'last_name','')),''),
                  split_part(email,'@',1)) as name
    into u from auth.users where lower(email) = em limit 1;
  if u.id is null then
    raise exception 'Ese correo todavía no tiene cuenta. Pídele que se registre gratis en Coach Hub y vuelve a intentarlo.';
  end if;
  if u.id = auth.uid() then raise exception 'Ya tienes acceso: la colección es tuya'; end if;

  select * into p from public.content_purchases where collection_id = c.id and student_id = u.id;
  if found and p.status in ('pagado','otorgado') then
    return jsonb_build_object('id', p.id, 'status', p.status, 'name', u.name, 'ya_tenia', true);
  end if;

  insert into public.content_purchases
    (collection_id, coach_id, student_id, student_name, student_email, title, price, currency, status, granted_by)
  values
    (c.id, c.coach_id, u.id, u.name, u.email, c.title, 0, c.currency, 'otorgado', auth.uid())
  on conflict (collection_id, student_id) do update
    set status = 'otorgado', granted_by = auth.uid(), price = 0,
        flow_token = null, base_clp = null, service_fee_clp = null, amount_clp = null
  returning * into p;

  return jsonb_build_object('id', p.id, 'status', p.status, 'name', u.name, 'ya_tenia', false);
end;
$$;

-- 8. Coach: quitar un acceso que dio a mano (las compras pagadas no se pueden quitar)
create or replace function public.mgl_contenido_quitar(p_purchase uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.content_purchases
   where id = p_purchase and coach_id = auth.uid() and status = 'otorgado';
  if not found then raise exception 'Solo puedes quitar accesos que diste tú (no compras pagadas)'; end if;
end;
$$;

grant execute on function public.mgl_contenido_comprar(uuid, text)  to authenticated;
grant execute on function public.mgl_contenido_otorgar(uuid, text)  to authenticated;
grant execute on function public.mgl_contenido_quitar(uuid)         to authenticated;


-- 9. Storage ─────────────────────────────────────────────────────────────────
-- 9a. Videos: bucket privado, 1 GB por archivo
insert into storage.buckets (id, name, public, file_size_limit)
values ('coach-content', 'coach-content', false, 1073741824)
on conflict (id) do nothing;

drop policy if exists "contenido_subir"  on storage.objects;
drop policy if exists "contenido_leer"   on storage.objects;
drop policy if exists "contenido_borrar" on storage.objects;

create policy "contenido_subir" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'coach-content' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "contenido_leer" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'coach-content' and (
      (storage.foldername(name))[1] = coalesce(auth.uid()::text, '-')
      or public.mgl_contenido_puede_ver_video(name)
    )
  );

create policy "contenido_borrar" on storage.objects
  for delete to authenticated
  using ( bucket_id = 'coach-content' and (storage.foldername(name))[1] = auth.uid()::text );

-- 9b. Portadas y miniaturas en el bucket público coach-public (carpeta contenido/)
insert into storage.buckets (id, name, public)
values ('coach-public', 'coach-public', true)
on conflict (id) do nothing;

drop policy if exists "contenido_portadas_subir"  on storage.objects;
drop policy if exists "contenido_portadas_borrar" on storage.objects;
drop policy if exists "contenido_portadas_editar" on storage.objects;

create policy "contenido_portadas_subir" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'coach-public' and (storage.foldername(name))[1] = auth.uid()::text
               and (storage.foldername(name))[2] = 'contenido' );
create policy "contenido_portadas_editar" on storage.objects
  for update to authenticated
  using ( bucket_id = 'coach-public' and (storage.foldername(name))[1] = auth.uid()::text
          and (storage.foldername(name))[2] = 'contenido' );
create policy "contenido_portadas_borrar" on storage.objects
  for delete to authenticated
  using ( bucket_id = 'coach-public' and (storage.foldername(name))[1] = auth.uid()::text
          and (storage.foldername(name))[2] = 'contenido' );


-- 10. Resumen para liquidar a cada coach (solo para ti, desde Supabase) ───────
create or replace view public.v_liquidaciones_contenido as
select
  p.coach_id,
  coalesce(cp.display_name, 'Coach') as coach,
  to_char(p.paid_at at time zone 'America/Santiago', 'YYYY-MM') as mes,
  count(*)                    as ventas,
  sum(p.amount_clp)           as cobrado_clp,
  sum(p.service_fee_clp)      as cargo_servicio_clp,
  sum(p.commission_clp)       as comision_clp,
  sum(p.coach_payout_clp)     as a_pagar_al_coach_clp,
  sum(case when p.payout_status = 'por_liquidar' then p.coach_payout_clp else 0 end) as pendiente_de_liquidar_clp
from public.content_purchases p
left join public.coach_profiles cp on cp.coach_id = p.coach_id
where p.status = 'pagado' and p.paid_at is not null
group by p.coach_id, cp.display_name, 3
order by mes desc, coach;

revoke all on public.v_liquidaciones_contenido from anon, authenticated;
