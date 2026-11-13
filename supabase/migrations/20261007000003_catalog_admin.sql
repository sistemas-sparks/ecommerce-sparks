-- T-008: alterações do catálogo e auditoria na mesma transação.
-- updated_at impede que uma edição antiga reponha estoque já reservado em uma compra.
create or replace function public.admin_catalog_mutate(
  p_entity text,
  p_action text,
  p_id uuid,
  p_data jsonb,
  p_expected timestamptz,
  p_actor uuid,
  p_product_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_updated timestamptz;
  v_fields jsonb;
begin
  if p_actor is null or p_entity not in ('products', 'categories', 'product_images')
    or p_action not in ('create', 'update', 'delete') then
    raise exception using errcode = 'P0001', message = 'catalog_invalid';
  end if;
  if p_action <> 'create' and (p_id is null or p_expected is null) then
    raise exception using errcode = 'P0001', message = 'catalog_changed';
  end if;

  if p_entity = 'products' then
    if p_action <> 'create' then
      select updated_at into v_updated from public.products
        where id = v_id and deleted_at is null for update;
      if not found or v_updated is distinct from p_expected then
        raise exception using errcode = 'P0001', message = 'catalog_changed';
      end if;
    end if;
    if p_action = 'delete' then
      update public.products set active = false, deleted_at = now() where id = v_id;
    elsif p_action = 'create' then
      insert into public.products (id, slug, name, description, category_id, kind,
        price_cents, cost_cents, stock, weight_g, package_size, length_cm, width_cm,
        height_cm, active, featured, badge)
      values (v_id, p_data->>'slug', p_data->>'name', p_data->>'description',
        (p_data->>'category_id')::uuid, p_data->>'kind', (p_data->>'price_cents')::integer,
        (p_data->>'cost_cents')::integer, (p_data->>'stock')::integer,
        (p_data->>'weight_g')::integer, p_data->>'package_size',
        (p_data->>'length_cm')::integer, (p_data->>'width_cm')::integer,
        (p_data->>'height_cm')::integer, (p_data->>'active')::boolean,
        (p_data->>'featured')::boolean, p_data->>'badge');
    else
      update public.products set slug = p_data->>'slug', name = p_data->>'name',
        description = p_data->>'description', category_id = (p_data->>'category_id')::uuid,
        kind = p_data->>'kind', price_cents = (p_data->>'price_cents')::integer,
        cost_cents = (p_data->>'cost_cents')::integer, stock = (p_data->>'stock')::integer,
        weight_g = (p_data->>'weight_g')::integer, package_size = p_data->>'package_size',
        length_cm = (p_data->>'length_cm')::integer, width_cm = (p_data->>'width_cm')::integer,
        height_cm = (p_data->>'height_cm')::integer, active = (p_data->>'active')::boolean,
        featured = (p_data->>'featured')::boolean, badge = p_data->>'badge' where id = v_id;
    end if;
  elsif p_entity = 'categories' then
    if p_action <> 'create' then
      select updated_at into v_updated from public.categories where id = v_id for update;
      if not found or v_updated is distinct from p_expected then
        raise exception using errcode = 'P0001', message = 'catalog_changed';
      end if;
    end if;
    if p_action = 'delete' then
      if exists(select 1 from public.products where category_id = v_id and deleted_at is null) then
        raise exception using errcode = 'P0001', message = 'category_in_use';
      end if;
      delete from public.categories where id = v_id;
    elsif p_action = 'create' then
      insert into public.categories (id, slug, name, position, active)
        values (v_id, p_data->>'slug', p_data->>'name', (p_data->>'position')::integer,
          (p_data->>'active')::boolean);
    else
      update public.categories set slug = p_data->>'slug', name = p_data->>'name',
        position = (p_data->>'position')::integer, active = (p_data->>'active')::boolean
        where id = v_id;
    end if;
  else
    -- Todas as operações de fotos do mesmo produto compartilham esta trava.
    perform 1 from public.products where id = p_product_id and deleted_at is null for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'catalog_changed';
    end if;
    if p_action <> 'create' then
      select updated_at into v_updated from public.product_images
        where id = v_id and product_id = p_product_id for update;
      if not found or v_updated is distinct from p_expected then
        raise exception using errcode = 'P0001', message = 'catalog_changed';
      end if;
    end if;
    if p_action = 'delete' then
      delete from public.product_images where id = v_id and product_id = p_product_id;
    else
      if (p_data->>'position')::integer not between 0 and 11
        or coalesce(char_length(p_data->>'alt'), 0) not between 1 and 300 then
        raise exception using errcode = 'P0001', message = 'catalog_invalid';
      end if;
      if p_action = 'create' then
        if p_data->>'path' is distinct from p_product_id::text || '/' || v_id::text || '/1080.webp' then
          raise exception using errcode = 'P0001', message = 'catalog_invalid';
        end if;
        if (select count(*) from public.product_images where product_id = p_product_id) >= 12 then
          raise exception using errcode = 'P0001', message = 'image_limit';
        end if;
        insert into public.product_images (id, product_id, path, alt, position)
          values (v_id, p_product_id, p_data->>'path', p_data->>'alt', (p_data->>'position')::integer);
      else
        update public.product_images set alt = p_data->>'alt', position = (p_data->>'position')::integer
          where id = v_id and product_id = p_product_id;
      end if;
    end if;
  end if;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_fields
    from jsonb_object_keys(coalesce(p_data, '{}'::jsonb)) as key;
  insert into public.audit_log (actor, action, entity, entity_id, diff)
    values (p_actor::text, p_action, p_entity, v_id::text, jsonb_build_object('fields', v_fields));
  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.admin_catalog_mutate(text, text, uuid, jsonb, timestamptz, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_catalog_mutate(text, text, uuid, jsonb, timestamptz, uuid, uuid)
  to service_role;
