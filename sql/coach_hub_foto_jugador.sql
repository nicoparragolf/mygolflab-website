-- ═══════════════════════════════════════════════════════════════════════════
--  CoachYard · Foto de perfil del jugador
--  Archivo: sql/coach_hub_foto_jugador.sql · 2026-11-23
--
--  El jugador sube su foto (bucket público coach-public, carpeta {su id}/avatar/)
--  y esta función la copia a su cuenta (profiles.avatar_url) y a todas sus fichas
--  (players.photo_url), para que su coach la vea en la lista de alumnos, en el
--  perfil y en Mensajes. Solo acepta fotos de la carpeta del propio usuario.
--  Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.mgl_set_mi_foto(p_url text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_pref text;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  v_pref := 'https://yulpqupmftdjbepqiscs.supabase.co/storage/v1/object/public/coach-public/' || auth.uid()::text || '/';
  if p_url is not null and left(p_url, length(v_pref)) <> v_pref then
    raise exception 'Foto no válida';
  end if;
  update public.profiles set avatar_url = p_url where id = auth.uid();
  update public.players  set photo_url  = p_url, updated_at = now() where user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;   -- cuántas fichas de coach se actualizaron
end $$;

revoke execute on function public.mgl_set_mi_foto(text) from anon;
grant  execute on function public.mgl_set_mi_foto(text) to authenticated;
