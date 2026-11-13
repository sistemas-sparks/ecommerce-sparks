-- T-019 · Painel de pedidos: mudança de status pela lojista, rastreio, frete a combinar e
-- alertas de pagamento. NÃO altera create_order (as propostas S-02 e S-04 seguem pendentes).
-- Todas as funções são SECURITY DEFINER, com search_path fixo e EXECUTE só para service_role
-- (a API do Worker). Quem decide a transição é a máquina de estados do banco (order_status_allowed),
-- espelho de ORDER_TRANSITIONS em packages/shared/src/order.ts.

-- ---------------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------------
-- Link de pagamento do pedido liberado pela lojista (frete a combinar). Só HTTPS.
alter table public.orders
  add column mp_checkout_url text
  check (mp_checkout_url is null or (mp_checkout_url ~ '^https://' and char_length(mp_checkout_url) <= 500));

-- O webhook passa a registrar o resultado, para o painel mostrar pagamento duplicado, fora do
-- prazo e valor diferente (antes só havia o log). Sem dado pessoal: só ids do pagamento e valor.
alter table public.payment_events
  add column result text,
  add column amount_cents integer check (amount_cents >= 0),
  add column provider_payment_id text check (char_length(provider_payment_id) <= 64);
create index payment_events_attention_idx on public.payment_events (processed_at desc)
  where result in ('double_payment', 'late_payment', 'amount_mismatch');

-- ---------------------------------------------------------------------------
-- mark_order_paid: igual à T-015, mais o registro de result, amount_cents e provider_payment_id.
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_paid(
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
     set processed_at = now(),
         order_id = case when v_order.id is not null then v_order.id end,
         result = v_result,
         amount_cents = case when p_amount_cents >= 0 then p_amount_cents end,
         provider_payment_id = left(p_mp_payment_id, 64)
   where id = v_event_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_order_status
-- Resultado: ok | not_found | invalid_transition | invalid_tracking | tracking_not_allowed
-- Rastreio junto com o status só vale ao marcar enviado ou entregue (audit_log como no
-- admin_set_order_tracking). Cancelar pedido PAGO grava audit_log 'order_cancel_paid' com quem,
-- quando, valor e id do pagamento no Mercado Pago: o estorno é manual e precisa de rastro.
-- Só os status que a lojista escolhe: em separação, enviado, entregue, devolvido e cancelado.
-- (pago vem do webhook, expirado do cron e aguardando pagamento da confirmação do frete.)
-- Cancelar devolve o estoque: pedido ainda sem pagamento usa release_order (também solta o
-- cupom); pedido pago ou em separação devolve os itens aqui (o estorno é feito no Mercado Pago).
-- O autor e a data ficam em order_events, gravados pelo trigger de status.
-- ---------------------------------------------------------------------------
create function public.admin_set_order_status(
  p_order_id uuid,
  p_status text,
  p_actor text,
  p_tracking text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_tracking text := nullif(btrim(p_tracking), '');
begin
  if p_status not in ('preparing', 'shipped', 'delivered', 'returned', 'canceled') then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  if v_tracking is not null and v_tracking !~ '^[A-Za-z0-9-]{4,40}$' then
    return 'invalid_tracking';
  end if;
  if v_tracking is not null and p_status not in ('shipped', 'delivered') then
    return 'tracking_not_allowed';
  end if;
  perform set_config('app.actor', coalesce(nullif(p_actor, ''), 'admin'), true);

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if not public.order_status_allowed(v_order.status, p_status) then
    return 'invalid_transition';
  end if;

  if v_tracking is not null then
    update public.orders set tracking_code = upper(v_tracking) where id = p_order_id;
    insert into public.audit_log (actor, action, entity, entity_id, diff)
    values (
      coalesce(nullif(p_actor, ''), 'admin'), 'update', 'order_tracking', p_order_id::text,
      jsonb_build_object(
        'code', v_order.code, 'tracking_code', upper(v_tracking), 'status', p_status
      )
    );
  end if;

  if p_status = 'canceled' and v_order.status in ('awaiting_payment', 'awaiting_shipping_quote') then
    perform public.release_order(p_order_id, 'canceled', p_actor);
  elsif p_status = 'canceled' then
    -- Pago ou em separação: o estoque foi baixado na compra e os itens não saíram.
    perform 1 from public.products pr
     where pr.id in (
       select oi.product_id from public.order_items oi where oi.order_id = p_order_id
       union select v_order.gift_wrap_product_id where v_order.gift_wrap_product_id is not null
     )
     order by pr.id
     for update;
    update public.orders set status = 'canceled' where id = p_order_id;
    update public.products pr
       set stock = pr.stock + oi.qty
      from public.order_items oi
     where oi.order_id = p_order_id and pr.id = oi.product_id;
    if v_order.gift_wrap_product_id is not null then
      update public.products set stock = stock + 1 where id = v_order.gift_wrap_product_id;
    end if;
    -- Rastro do estorno manual: o dinheiro só volta se a lojista estornar no Mercado Pago.
    insert into public.audit_log (actor, action, entity, entity_id, diff)
    values (
      coalesce(nullif(p_actor, ''), 'admin'), 'cancel', 'order_cancel_paid', p_order_id::text,
      jsonb_build_object(
        'code', v_order.code, 'refund_cents', v_order.total_cents,
        'mp_payment_id', v_order.mp_payment_id, 'paid_at', v_order.paid_at,
        'canceled_at', now(), 'from_status', v_order.status
      )
    );
  else
    update public.orders set status = p_status where id = p_order_id;
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_order_tracking
-- Resultado: ok | not_found | invalid_status | invalid_tracking
-- Rastreio digitado pela lojista (a etiqueta é comprada no Melhor Envio, nunca pela API: R2.5).
-- Vazio apaga. Só vale com o pedido em separação, enviado ou entregue.
-- ---------------------------------------------------------------------------
create function public.admin_set_order_tracking(
  p_order_id uuid,
  p_tracking text,
  p_actor text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_tracking text := nullif(btrim(p_tracking), '');
begin
  if v_tracking is not null and v_tracking !~ '^[A-Za-z0-9-]{4,40}$' then
    return 'invalid_tracking';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_order.status not in ('preparing', 'shipped', 'delivered') then
    return 'invalid_status';
  end if;
  update public.orders set tracking_code = upper(v_tracking) where id = p_order_id;
  insert into public.audit_log (actor, action, entity, entity_id, diff)
  values (
    coalesce(nullif(p_actor, ''), 'admin'), 'update', 'order_tracking', p_order_id::text,
    jsonb_build_object('code', v_order.code, 'tracking_code', upper(v_tracking))
  );
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_quote_order: a lojista informou valor e prazo do frete a combinar.
-- Resultado: ok | not_found | invalid_status | totals_changed
-- O total é recalculado AQUI, com os valores do banco (subtotal conferido com os itens
-- gravados), e precisa bater com o total que a API calculou. A preferência de pagamento já foi
-- criada pela API (link válido por p_expires_at). Só depois disto o pedido pode ser cobrado:
-- passa a aguardando pagamento com a reserva do estoque até p_expires_at.
-- ---------------------------------------------------------------------------
create function public.admin_quote_order(
  p_order_id uuid,
  p_shipping_cents integer,
  p_days_min integer,
  p_days_max integer,
  p_label text,
  p_carrier text,
  p_expected_total_cents integer,
  p_preference_id text,
  p_checkout_url text,
  p_expires_at timestamptz,
  p_actor text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_items_sum integer;
  v_total integer;
begin
  if p_shipping_cents is null or p_shipping_cents < 0
     or p_days_min is null or p_days_min < 0
     or p_days_max is null or p_days_max < p_days_min
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '72 hours'
     or p_checkout_url !~ '^https://' then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  perform set_config('app.actor', coalesce(nullif(p_actor, ''), 'admin'), true);

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_order.status <> 'awaiting_shipping_quote' then
    return 'invalid_status';
  end if;

  select coalesce(sum(unit_price_cents * qty), 0) into v_items_sum
    from public.order_items where order_id = p_order_id;
  v_total := v_order.subtotal_cents - v_order.discount_cents + p_shipping_cents
             + v_order.gift_wrap_cents;
  if v_items_sum <> v_order.subtotal_cents or v_total <> p_expected_total_cents then
    return 'totals_changed';
  end if;

  update public.orders
     set shipping_cents = p_shipping_cents,
         shipping_days_min = p_days_min,
         shipping_days_max = p_days_max,
         shipping_label = nullif(btrim(p_label), ''),
         shipping_carrier = nullif(btrim(p_carrier), ''),
         total_cents = v_total,
         mp_preference_id = p_preference_id,
         mp_checkout_url = p_checkout_url,
         reserved_until = p_expires_at,
         status = 'awaiting_payment'
   where id = p_order_id;

  insert into public.audit_log (actor, action, entity, entity_id, diff)
  values (
    coalesce(nullif(p_actor, ''), 'admin'), 'update', 'order_quote', p_order_id::text,
    jsonb_build_object(
      'code', v_order.code, 'shipping_cents', p_shipping_cents, 'total_cents', v_total,
      'days_min', p_days_min, 'days_max', p_days_max
    )
  );
  return 'ok';
end;
$$;

revoke all on function public.mark_order_paid(uuid, text, integer, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_set_order_status(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_set_order_tracking(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_quote_order(
  uuid, integer, integer, integer, text, text, integer, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, integer, text, text, text)
  to service_role;
grant execute on function public.admin_set_order_status(uuid, text, text, text) to service_role;
grant execute on function public.admin_set_order_tracking(uuid, text, text) to service_role;
grant execute on function public.admin_quote_order(
  uuid, integer, integer, integer, text, text, integer, text, text, timestamptz, text
) to service_role;
