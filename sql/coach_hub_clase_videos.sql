-- ═══════════════════════════════════════════════════════════════════════════
-- CoachYard · Videos de demostración al entregar una clase
-- Archivo: sql/coach_hub_clase_videos.sql · 2026-11-10 (ya aplicado en Supabase)
--
-- Al entregar, el coach puede subir videos de su galería. Se guardan como un
-- evento "Clase" en la ficha del alumno (player_events + player_media, bucket
-- player-media) y la clase guarda el id de ese evento para mostrarlos.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.coach_lessons
  add column if not exists delivery_event_id uuid references public.player_events(id) on delete set null;

create or replace function public.mgl_clase_entregar(p_id uuid, p_reply text, p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_event is not null and not exists (
    select 1 from public.player_events e
      join public.coach_lessons l on l.id = p_id
     where e.id = p_event and e.player_id = l.player_id and l.coach_id = auth.uid()
  ) then
    raise exception 'El evento no corresponde a esta clase';
  end if;
  update public.coach_lessons
     set status = 'entregada', delivered_at = now(), closed_at = now(),
         coach_reply = coalesce(nullif(btrim(coalesce(p_reply,'')),''), coach_reply),
         delivery_event_id = coalesce(p_event, delivery_event_id)
   where id = p_id and coach_id = auth.uid() and status = 'aceptada';
  if not found then raise exception 'Solo se pueden entregar clases aceptadas'; end if;
end;
$$;
revoke execute on function public.mgl_clase_entregar(uuid, text, uuid) from anon;
grant execute on function public.mgl_clase_entregar(uuid, text, uuid) to authenticated;
