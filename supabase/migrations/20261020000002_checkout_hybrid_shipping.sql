-- T-028 · Checkout com frete híbrido: create_order passa a gravar o snapshot do serviço (R4.3).
-- Mesma função da T-014 (20261007000001_checkout.sql); mudam só o comentário do payload e as
-- colunas shipping_label e shipping_carrier no insert de orders.
-- Erros de negócio saem com errcode P0001 e a MENSAGEM é um código fixo que a API traduz:
--   invalid_payload, too_many_pending, product_unavailable, out_of_stock, gift_wrap_unavailable,
--   coupon_invalid, coupon_min_order, totals_changed
-- O `detail` leva o id do produto quando o erro é de um item.

-- ---------------------------------------------------------------------------
-- create_order(payload)
-- Payload (montado pela API depois de recalcular tudo com packages/shared):
-- {
--   code, token_hash, customer_user_id?, customer_name, customer_whatsapp, customer_email?,
--   address (jsonb), address_type, items: [{product_id, qty}], coupon_code?,
--   gift_wrap_product_id?, gift_message?,
--   shipping: {service, cents, days_min, days_max, label, carrier} | null  (null = frete a combinar),
--   expected_subtotal_cents, expected_discount_cents, reserve_minutes
-- }
-- O banco recalcula subtotal e desconto com os preços travados (FOR UPDATE). Se diferirem do que a
-- API calculou (preço mudou no meio), recusa com totals_changed: nunca grava um total divergente.
-- Estoque e uso do cupom são reservados aqui; release_order devolve.
-- ---------------------------------------------------------------------------
create or replace function public.create_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_qty integer;
  v_product public.products%rowtype;
  v_subtotal integer := 0;
  v_discount integer := 0;
  v_coupon public.coupons%rowtype;
  v_coupon_id uuid;
  v_gift public.products%rowtype;
  v_gift_id uuid := nullif(p ->> 'gift_wrap_product_id', '')::uuid;
  v_gift_cents integer := 0;
  v_shipping jsonb := nullif(p -> 'shipping', 'null'::jsonb);
  v_status text;
  v_order_id uuid;
  v_total integer;
  v_reserved_until timestamptz;
  v_reserve_minutes integer := coalesce((p ->> 'reserve_minutes')::integer, 30);
begin
  perform set_config('app.actor', 'checkout', true);

  if jsonb_typeof(p -> 'items') is distinct from 'array'
     or jsonb_array_length(p -> 'items') not between 1 and 50
     or v_reserve_minutes not between 5 and 1440 then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  -- Produto repetido deixaria a baixa de estoque ambígua.
  if (select count(distinct x ->> 'product_id') from jsonb_array_elements(p -> 'items') x)
     <> jsonb_array_length(p -> 'items') then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;

  -- Freio contra quem esgota o estoque sem pagar (docs/seguranca.md): no máximo 3 pedidos
  -- pendentes por WhatsApp na última hora. A trava por WhatsApp (até o fim da transação) impede
  -- que compras simultâneas do mesmo número contem juntas e passem do limite.
  perform pg_advisory_xact_lock(hashtextextended('order_pending:' || coalesce(p ->> 'customer_whatsapp', ''), 0));
  if (
    select count(*) from public.orders o
     where o.customer_whatsapp = p ->> 'customer_whatsapp'
       and o.status in ('awaiting_payment', 'awaiting_shipping_quote')
       and o.created_at > now() - interval '1 hour'
  ) >= 3 then
    raise exception 'too_many_pending' using errcode = 'P0001';
  end if;

  -- Trava os produtos sempre na mesma ordem (evita deadlock entre compras simultâneas).
  perform 1 from public.products pr
   where pr.id in (
     select (x ->> 'product_id')::uuid from jsonb_array_elements(p -> 'items') x
     union select v_gift_id where v_gift_id is not null
   )
   order by pr.id
   for update;

  -- Itens: ativos, à venda, com estoque. Subtotal com os preços do banco.
  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_qty := (v_item ->> 'qty')::integer;
    if v_qty is null or v_qty not between 1 and 99 then
      raise exception 'invalid_payload' using errcode = 'P0001';
    end if;

    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid;
    if not found or not v_product.active or v_product.deleted_at is not null
       or v_product.kind <> 'regular' then
      raise exception 'product_unavailable' using errcode = 'P0001', detail = v_item ->> 'product_id';
    end if;
    if v_product.stock < v_qty then
      raise exception 'out_of_stock' using errcode = 'P0001', detail = v_item ->> 'product_id';
    end if;
    v_subtotal := v_subtotal + v_product.price_cents * v_qty;
  end loop;

  -- Embalagem de presente: só se ligada no painel, do tipo gift_wrap e com estoque (1 por pedido).
  if v_gift_id is not null then
    select * into v_gift from public.products where id = v_gift_id;
    if not found or not v_gift.active or v_gift.deleted_at is not null or v_gift.kind <> 'gift_wrap'
       or v_gift.stock < 1
       or not coalesce((select s.gift_wrap_enabled from public.settings s where s.id = 1), false) then
      raise exception 'gift_wrap_unavailable' using errcode = 'P0001';
    end if;
    v_gift_cents := v_gift.price_cents;
  end if;

  -- Cupom: inválido, expirado e esgotado dão a MESMA resposta (não ajuda força bruta).
  if nullif(p ->> 'coupon_code', '') is not null then
    select * into v_coupon from public.coupons c
     where c.code = upper(p ->> 'coupon_code') and c.deleted_at is null
     for update;
    if not found or not v_coupon.active
       or (v_coupon.starts_at is not null and v_coupon.starts_at > now())
       or (v_coupon.ends_at is not null and v_coupon.ends_at <= now())
       or (v_coupon.max_uses is not null and v_coupon.used_count >= v_coupon.max_uses) then
      raise exception 'coupon_invalid' using errcode = 'P0001';
    end if;
    if v_coupon.min_order_cents is not null and v_subtotal < v_coupon.min_order_cents then
      raise exception 'coupon_min_order' using errcode = 'P0001';
    end if;
    v_coupon_id := v_coupon.id;
    -- Mesma regra de packages/shared/src/totals.ts: percentual arredonda para baixo; fixo limitado
    -- ao subtotal. Nunca desconta frete nem embalagem.
    v_discount := case v_coupon.type
      when 'percent' then floor(v_subtotal::numeric * v_coupon.value / 100)::integer
      else least(v_coupon.value, v_subtotal)
    end;
  end if;

  if v_subtotal is distinct from (p ->> 'expected_subtotal_cents')::integer
     or v_discount is distinct from (p ->> 'expected_discount_cents')::integer then
    raise exception 'totals_changed' using errcode = 'P0001';
  end if;

  -- Sem frete definido = frete a combinar (rural, difícil acesso ou exceção): nada é cobrado.
  -- A reserva fica sem prazo até a lojista confirmar o frete ou cancelar (decisão do Rafael).
  if v_shipping is null then
    v_status := 'awaiting_shipping_quote';
    v_reserved_until := null;
  else
    v_status := 'awaiting_payment';
    v_reserved_until := now() + make_interval(mins => v_reserve_minutes);
  end if;

  v_total := v_subtotal - v_discount + coalesce((v_shipping ->> 'cents')::integer, 0) + v_gift_cents;

  insert into public.orders (
    code, token_hash, status, customer_user_id, customer_name, customer_whatsapp, customer_email,
    address, address_type, shipping_service, shipping_cents, shipping_days_min, shipping_days_max,
    shipping_label, shipping_carrier,
    subtotal_cents, discount_cents, coupon_id, gift_wrap_product_id, gift_wrap_cents, gift_message,
    total_cents, reserved_until
  ) values (
    p ->> 'code', p ->> 'token_hash', v_status, nullif(p ->> 'customer_user_id', '')::uuid,
    p ->> 'customer_name', p ->> 'customer_whatsapp', nullif(p ->> 'customer_email', ''),
    p -> 'address', p ->> 'address_type',
    v_shipping ->> 'service', (v_shipping ->> 'cents')::integer,
    (v_shipping ->> 'days_min')::integer, (v_shipping ->> 'days_max')::integer,
    v_shipping ->> 'label', v_shipping ->> 'carrier',
    v_subtotal, v_discount, v_coupon_id, v_gift_id, v_gift_cents,
    nullif(p ->> 'gift_message', ''),
    v_total, v_reserved_until
  )
  returning id into v_order_id;

  -- Cópia de nome, preço e custo no momento da compra (R4.3) e baixa do estoque (R4.2).
  insert into public.order_items (order_id, product_id, name_snapshot, unit_price_cents, unit_cost_cents, qty)
  select v_order_id, pr.id, pr.name, pr.price_cents, pr.cost_cents, (x ->> 'qty')::integer
    from jsonb_array_elements(p -> 'items') x
    join public.products pr on pr.id = (x ->> 'product_id')::uuid;

  update public.products pr
     set stock = pr.stock - (x ->> 'qty')::integer
    from jsonb_array_elements(p -> 'items') x
   where pr.id = (x ->> 'product_id')::uuid;

  if v_gift_id is not null then
    update public.products set stock = stock - 1 where id = v_gift_id;
  end if;

  if v_coupon_id is not null then
    update public.coupons set used_count = used_count + 1 where id = v_coupon_id;
    insert into public.coupon_redemptions (coupon_id, order_id) values (v_coupon_id, v_order_id);
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'code', p ->> 'code',
    'status', v_status,
    'subtotal_cents', v_subtotal,
    'discount_cents', v_discount,
    'shipping_cents', (v_shipping ->> 'cents')::integer,
    'gift_wrap_cents', v_gift_cents,
    'total_cents', v_total,
    'reserved_until', v_reserved_until
  );
end;
$$;

revoke all on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;
