-- T-010 · "Publicar alterações": no máximo 1 build a cada intervalo mínimo (docs/arquitetura.md §4).
-- A trava é atômica (UPDATE condicional na linha única de settings): dois cliques simultâneos não
-- disparam dois builds.

alter table public.settings add column last_publish_at timestamptz;

-- Reserva a vez de publicar. Devolve { ok, previous, claimed_at, next_allowed_at }.
create function public.claim_publish(p_min_interval_seconds integer, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous timestamptz;
  v_claimed timestamptz;
  v_interval interval := make_interval(secs => p_min_interval_seconds);
begin
  if p_min_interval_seconds not between 60 and 86400 or coalesce(p_actor, '') = '' then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;

  select last_publish_at into v_previous from public.settings where id = 1 for update;

  if v_previous is not null and v_previous > now() - v_interval then
    return jsonb_build_object(
      'ok', false,
      'previous', v_previous,
      'claimed_at', null,
      'next_allowed_at', v_previous + v_interval
    );
  end if;

  update public.settings set last_publish_at = now() where id = 1
  returning last_publish_at into v_claimed;

  insert into public.audit_log (actor, action, entity, entity_id, diff)
  values (p_actor, 'publish', 'site', null, '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'previous', v_previous,
    'claimed_at', v_claimed,
    'next_allowed_at', v_claimed + v_interval
  );
end;
$$;

-- Desfaz a reserva quando o deploy hook falhou, para a lojista poder tentar de novo na hora.
-- Só desfaz se ninguém publicou depois (compara com o horário reservado).
create function public.revert_publish(p_claimed_at timestamptz, p_previous timestamptz)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with reverted as (
    update public.settings set last_publish_at = p_previous
     where id = 1 and last_publish_at = p_claimed_at
    returning 1
  )
  select exists (select 1 from reverted);
$$;

revoke all on function public.claim_publish(integer, text) from public, anon, authenticated;
revoke all on function public.revert_publish(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_publish(integer, text) to service_role;
grant execute on function public.revert_publish(timestamptz, timestamptz) to service_role;
