-- T-002 · Regras no banco: transições de status, logs só de inserção e limite de requisições.

-- ---------------------------------------------------------------------------
-- Transições de status do pedido.
-- ESPELHO de ORDER_TRANSITIONS em packages/shared/src/order.ts: mude os dois juntos.
-- Quem fez a mudança vem de set_config('app.actor', ..., true); sem isso, 'system'.
-- ---------------------------------------------------------------------------
create function public.order_status_allowed(from_status text, to_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_status
    when 'awaiting_shipping_quote' then to_status in ('awaiting_payment', 'canceled')
    when 'awaiting_payment' then to_status in ('paid', 'expired', 'canceled')
    when 'paid' then to_status in ('preparing', 'canceled')
    when 'preparing' then to_status in ('shipped', 'canceled')
    when 'shipped' then to_status in ('delivered', 'returned')
    when 'delivered' then to_status in ('returned')
    else false
  end;
$$;

create function public.orders_guard_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('awaiting_payment', 'awaiting_shipping_quote') then
      raise exception 'pedido novo não pode começar em %', new.status
        using errcode = 'check_violation';
    end if;
  elsif new.status is distinct from old.status
        and not public.order_status_allowed(old.status, new.status) then
    raise exception 'transição de status inválida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.orders_log_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events (order_id, from_status, to_status, actor)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      coalesce(nullif(current_setting('app.actor', true), ''), 'system')
    );
  end if;
  return null;
end;
$$;

create trigger orders_guard_status
  before insert or update of status on public.orders
  for each row execute function public.orders_guard_status();

create trigger orders_log_status
  after insert or update of status on public.orders
  for each row execute function public.orders_log_status();

-- ---------------------------------------------------------------------------
-- Logs só de inserção: audit_log e order_events não aceitam UPDATE, DELETE nem TRUNCATE.
-- Dupla proteção: privilégio revogado e trigger que bloqueia até o dono da tabela.
-- ---------------------------------------------------------------------------
create function public.reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% é só de inserção', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.reject_change();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_change();

create trigger order_events_append_only
  before update or delete on public.order_events
  for each row execute function public.reject_change();
create trigger order_events_no_truncate
  before truncate on public.order_events
  for each statement execute function public.reject_change();

revoke update, delete, truncate on public.audit_log from service_role;
revoke update, delete, truncate on public.order_events from service_role;

-- ---------------------------------------------------------------------------
-- Limite de requisições (T-005): janela fixa, contagem atômica.
-- Devolve true se a requisição está dentro do limite.
-- ---------------------------------------------------------------------------
create function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200
     or p_window_seconds not between 1 and 86400 or p_max < 1 then
    raise exception 'parâmetros inválidos' using errcode = 'invalid_parameter_value';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  return v_count <= p_max;
end;
$$;

-- Limpeza das janelas antigas (chamada pelo cron diário).
create function public.rate_limit_cleanup()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.rate_limits where window_start < now() - interval '1 day' returning 1
  )
  select count(*)::integer from deleted;
$$;

-- Funções: EXECUTE só para service_role (as de trigger não precisam de grant).
revoke all on function public.order_status_allowed(text, text) from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.rate_limit_cleanup() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.orders_guard_status() from public, anon, authenticated;
revoke all on function public.orders_log_status() from public, anon, authenticated;
revoke all on function public.reject_change() from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.rate_limit_cleanup() to service_role;
