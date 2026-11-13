-- Importação de produtos por CSV: tudo ou nada, na mesma transação, com auditoria.
-- Idempotente: a chave é o slug. Reenviar o mesmo arquivo não cria duplicatas nem altera o que não mudou.
-- O estoque só é definido na criação: em produto existente ele fica como está, porque a compra
-- reserva e baixa estoque de forma atômica e uma planilha antiga não pode repô-lo (regra R4.2).
create or replace function public.admin_products_import(
  p_rows jsonb,
  p_actor uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_line text;
  v_old public.products%rowtype;
  v_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
begin
  if p_actor is null or p_rows is null or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'catalog_invalid';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_line := coalesce(r->>'line', '0');
    begin
      select * into v_old from public.products where slug = r->>'slug' for update;
      if not found then
        insert into public.products (slug, name, description, category_id, kind,
          price_cents, cost_cents, stock, weight_g, package_size, length_cm, width_cm,
          height_cm, active, featured, badge)
        values (r->>'slug', r->>'name', r->>'description', (r->>'category_id')::uuid,
          r->>'kind', (r->>'price_cents')::integer, (r->>'cost_cents')::integer,
          (r->>'stock')::integer, (r->>'weight_g')::integer, r->>'package_size',
          (r->>'length_cm')::integer, (r->>'width_cm')::integer, (r->>'height_cm')::integer,
          (r->>'active')::boolean, (r->>'featured')::boolean, r->>'badge')
        returning id into v_id;
        v_created := v_created + 1;
        insert into public.audit_log (actor, action, entity, entity_id, diff)
          values (p_actor::text, 'create', 'products', v_id::text,
            jsonb_build_object('source', 'csv_import'));
      elsif v_old.deleted_at is not null then
        raise exception using errcode = 'P0001', message = 'import_slug_removed';
      elsif v_old.name is not distinct from r->>'name'
        and v_old.description is not distinct from r->>'description'
        and v_old.category_id is not distinct from (r->>'category_id')::uuid
        and v_old.kind is not distinct from r->>'kind'
        and v_old.price_cents is not distinct from (r->>'price_cents')::integer
        and v_old.cost_cents is not distinct from (r->>'cost_cents')::integer
        and v_old.weight_g is not distinct from (r->>'weight_g')::integer
        and v_old.package_size is not distinct from r->>'package_size'
        and v_old.length_cm is not distinct from (r->>'length_cm')::integer
        and v_old.width_cm is not distinct from (r->>'width_cm')::integer
        and v_old.height_cm is not distinct from (r->>'height_cm')::integer
        and v_old.active is not distinct from (r->>'active')::boolean
        and v_old.featured is not distinct from (r->>'featured')::boolean
        and v_old.badge is not distinct from r->>'badge' then
        v_unchanged := v_unchanged + 1;
      else
        update public.products set name = r->>'name', description = r->>'description',
          category_id = (r->>'category_id')::uuid, kind = r->>'kind',
          price_cents = (r->>'price_cents')::integer, cost_cents = (r->>'cost_cents')::integer,
          weight_g = (r->>'weight_g')::integer, package_size = r->>'package_size',
          length_cm = (r->>'length_cm')::integer, width_cm = (r->>'width_cm')::integer,
          height_cm = (r->>'height_cm')::integer, active = (r->>'active')::boolean,
          featured = (r->>'featured')::boolean, badge = r->>'badge'
          where id = v_old.id;
        v_updated := v_updated + 1;
        insert into public.audit_log (actor, action, entity, entity_id, diff)
          values (p_actor::text, 'update', 'products', v_old.id::text,
            jsonb_build_object('source', 'csv_import'));
      end if;
    exception
      when unique_violation or foreign_key_violation or check_violation
        or invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = 'P0001', message = 'import_row_failed', detail = v_line;
      when sqlstate 'P0001' then
        -- Erros próprios (ex.: slug de produto removido) ganham a linha do arquivo.
        raise exception using errcode = 'P0001', message = sqlerrm, detail = v_line;
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;

revoke all on function public.admin_products_import(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_products_import(jsonb, uuid) to service_role;
