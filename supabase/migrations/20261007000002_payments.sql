-- T-015 · Confirmação de pagamento (webhook do Mercado Pago) e expiração de pedidos (cron).
-- R3.4: cada evento é processado uma única vez (payment_events.provider_event_id UNIQUE) e o valor
-- pago é conferido com o total do pedido antes de marcar como pago.

-- ---------------------------------------------------------------------------
-- mark_order_paid
-- Resultado (texto):
--   paid             pedido marcado como pago agora
--   duplicate        evento já processado antes (nada muda)
--   already_paid     pedido já estava pago com este mesmo pagamento
--   double_payment   pedido já pago por OUTRO pagamento: a lojista precisa estornar um deles
--   late_payment     pagamento chegou com o pedido expirado/cancelado: a lojista decide
--   amount_mismatch  valor pago diferente do total: não marca como pago
--   order_not_found  external_reference não corresponde a nenhum pedido
-- ---------------------------------------------------------------------------
create function public.mark_order_paid(
  p_order_id uuid,
  p_mp_payment_id text,
  p_amount_cents integer,
  p_payment_method text,
  p_event_id text,
  p_payload_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_event_id bigint;
  v_result text;
begin
  perform set_config('app.actor', 'webhook', true);

  insert into public.payment_events (provider_event_id, payload_hash, order_id)
  values (p_event_id, p_payload_hash, null)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    return 'duplicate';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if not found then
    v_result := 'order_not_found';
  elsif v_order.status in ('paid', 'preparing', 'shipped', 'delivered', 'returned') then
    v_result := case when v_order.mp_payment_id = p_mp_payment_id then 'already_paid'
                     else 'double_payment' end;
  elsif v_order.status <> 'awaiting_payment' then
    v_result := 'late_payment';
  elsif p_amount_cents is distinct from v_order.total_cents then
    v_result := 'amount_mismatch';
  else
    update public.orders
       set status = 'paid',
           mp_payment_id = p_mp_payment_id,
           payment_method = case when p_payment_method in ('pix', 'credit_card', 'debit_card')
                                 then p_payment_method end,
           paid_at = now(),
           reserved_until = null
     where id = p_order_id;
    update public.coupon_redemptions
       set status = 'confirmed'
     where order_id = p_order_id and status = 'pending';
    v_result := 'paid';
  end if;

  update public.payment_events
     set processed_at = now(), order_id = case when v_order.id is not null then v_order.id end
   where id = v_event_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_unpaid_orders: expira pedidos aguardando pagamento cuja reserva venceu e devolve o estoque.
-- Folga de 10 minutos depois do vencimento, para um Pix pago no último instante ainda ser aceito.
-- Pedido aguardando frete (rural) não expira: só a lojista cancela.
-- ---------------------------------------------------------------------------
create function public.expire_unpaid_orders(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.orders
     where status = 'awaiting_payment' and reserved_until < now() - interval '10 minutes'
     order by reserved_until
     limit greatest(1, least(p_limit, 1000))
  loop
    if public.release_order(v_id, 'expired', 'cron') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.mark_order_paid(uuid, text, integer, text, text, text)
  from public, anon, authenticated;
revoke all on function public.expire_unpaid_orders(integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, integer, text, text, text) to service_role;
grant execute on function public.expire_unpaid_orders(integer) to service_role;
