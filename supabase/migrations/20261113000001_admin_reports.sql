-- T-020 · Relatório de lucro simples: UMA função SQL SOMENTE DE LEITURA (stable, sem insert/update).
-- Devolve só somas em centavos e unidades; margem e totais são calculados na API
-- (packages/shared/src/profit-report.ts). Sem nova tabela e sem nova coluna: RLS segue como está
-- (negação por padrão em orders e order_items); a função é SECURITY DEFINER, com search_path fixo,
-- e EXECUTE só para service_role (a API do Worker, atrás de admin + aal2). anon e authenticated
-- recebem "permission denied".
--
-- Regras (espelham PROFIT_REPORT_STATUSES e profit-report.ts):
-- * Entram pedidos paid, preparing, shipped e delivered, pela data do pagamento (paid_at) em
--   Brasília. Cancelados, devolvidos, expirados e não pagos ficam de fora.
-- * Preço e custo vêm do snapshot do item (order_items), nunca do cadastro do produto.
-- * Custo unitário gravado = 0 significa "sem custo informado" (products.cost_cents tem default 0):
--   esses itens são somados à parte e nunca entram como lucro.
-- * Desconto, frete e embalagem são valores do PEDIDO: são somados uma vez por pedido (não por item).
-- * RATEIO DO DESCONTO (revisão C-1): o desconto do pedido é dividido, em centavos inteiros, entre os
--   itens COM custo e os itens SEM custo, proporcional ao subtotal de cada grupo (preço × quantidade),
--   pelo método do maior resto: cada parte recebe floor(desconto × subtotal_do_grupo / subtotal) e o
--   centavo que sobra (no máximo 1) vai ao grupo de maior resto; empate fica com o grupo com custo
--   (conta conservadora). As duas partes somam exatamente o desconto, sem perder centavo. Só a parte
--   COM custo é abatida do lucro; a parte dos itens sem custo (discount_uncosted_cents) é abatida das
--   vendas sem custo, que ficam fora do lucro. Assim um pedido só de itens sem custo nunca gera prejuízo.

create function public.admin_profit_report(
  p_from date,
  p_to date,
  p_group text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_group is null or p_group not in ('day', 'month')
     or p_to < p_from or (p_to - p_from) + 1 > 366 then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  v_start := p_from::timestamp at time zone 'America/Sao_Paulo';
  v_end := (p_to + 1)::timestamp at time zone 'America/Sao_Paulo';

  with sel as (
    select o.id, o.paid_at,
           case when p_group = 'day'
                then to_char(o.paid_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
                else to_char(o.paid_at at time zone 'America/Sao_Paulo', 'YYYY-MM') end as bucket,
           o.discount_cents, coalesce(o.shipping_cents, 0) as shipping_cents, o.gift_wrap_cents
      from public.orders o
     where o.status in ('paid', 'preparing', 'shipped', 'delivered')
       and o.paid_at >= v_start and o.paid_at < v_end
  ),
  it as (
    select oi.order_id,
           sum(oi.qty)::bigint as units,
           sum(oi.unit_price_cents::bigint * oi.qty) as sales_cents,
           sum(case when oi.unit_cost_cents > 0 then oi.unit_price_cents::bigint * oi.qty else 0 end)
             as sales_costed_cents,
           sum(case when oi.unit_cost_cents > 0 then oi.unit_cost_cents::bigint * oi.qty else 0 end)
             as cost_cents,
           sum(case when oi.unit_cost_cents = 0 then oi.qty else 0 end)::bigint as units_uncosted,
           sum(case when oi.unit_cost_cents = 0 then oi.unit_price_cents::bigint * oi.qty else 0 end)
             as sales_uncosted_cents
      from public.order_items oi
      join sel on sel.id = oi.order_id
     group by oi.order_id
  ),
  po as (
    -- Uma linha por pedido, em bigint (sum() devolve numeric e a divisão seria fracionária), com o subtotal dos itens (s), dos com custo (sc) e dos sem custo (su).
    select sel.id,
           sel.discount_cents::bigint as d,
           coalesce(it.sales_cents, 0)::bigint as s,
           coalesce(it.sales_costed_cents, 0)::bigint as sc,
           coalesce(it.sales_uncosted_cents, 0)::bigint as su
      from sel
      left join it on it.order_id = sel.id
  ),
  ds as (
    -- Rateio do desconto (maior resto). rc + ru = (d - qc - qu) × s, logo a sobra é 0 ou 1 centavo.
    -- Pedido sem itens (s = 0) não tem base de rateio: o desconto fica todo fora do lucro.
    select po.id,
           case when po.s = 0 then po.d
                else (po.d * po.su) / po.s
                     + case when po.d - (po.d * po.sc) / po.s - (po.d * po.su) / po.s = 1
                                 and (po.d * po.su) % po.s > (po.d * po.sc) % po.s
                            then 1 else 0 end
           end as discount_uncosted_cents
      from po
  ),
  b as (
    -- Valores do pedido (desconto, frete, embalagem) entram uma vez por pedido: a junção com os
    -- itens já foi agregada por pedido em "it" e o desconto já foi rateado por pedido em "ds".
    select sel.bucket,
           count(*)::bigint as orders,
           coalesce(sum(it.units), 0) as units,
           coalesce(sum(it.sales_cents), 0) as sales_cents,
           coalesce(sum(it.sales_costed_cents), 0) as sales_costed_cents,
           coalesce(sum(it.cost_cents), 0) as cost_cents,
           coalesce(sum(it.units_uncosted), 0) as units_uncosted,
           coalesce(sum(it.sales_uncosted_cents), 0) as sales_uncosted_cents,
           sum(sel.discount_cents)::bigint as discount_cents,
           sum(ds.discount_uncosted_cents)::bigint as discount_uncosted_cents,
           sum(sel.shipping_cents)::bigint as shipping_cents,
           sum(sel.gift_wrap_cents)::bigint as gift_wrap_cents
      from sel
      left join it on it.order_id = sel.id
      join ds on ds.id = sel.id
     group by sel.bucket
  ),
  pr as (
    select left(coalesce(oi.product_id::text, 'n:' || oi.name_snapshot), 190) as key,
           (array_agg(oi.name_snapshot order by sel.paid_at desc, oi.created_at desc))[1] as name,
           sum(oi.qty)::bigint as units,
           sum(oi.unit_price_cents::bigint * oi.qty) as sales_cents,
           sum(case when oi.unit_cost_cents > 0 then oi.unit_price_cents::bigint * oi.qty else 0 end)
             as sales_costed_cents,
           sum(case when oi.unit_cost_cents > 0 then oi.unit_cost_cents::bigint * oi.qty else 0 end)
             as cost_cents,
           sum(case when oi.unit_cost_cents = 0 then oi.qty else 0 end)::bigint as units_uncosted
      from public.order_items oi
      join sel on sel.id = oi.order_id
     group by 1
  ),
  pr_top as (
    select * from pr order by sales_cents desc, name, key limit 500
  )
  select jsonb_build_object(
    'buckets', coalesce((select jsonb_agg(to_jsonb(b) order by b.bucket) from b), '[]'::jsonb),
    'products', coalesce(
      (select jsonb_agg(to_jsonb(pr_top) order by pr_top.sales_cents desc, pr_top.name, pr_top.key)
         from pr_top),
      '[]'::jsonb),
    'products_count', (select count(*) from pr)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_profit_report(date, date, text)
  from public, anon, authenticated;
grant execute on function public.admin_profit_report(date, date, text) to service_role;
