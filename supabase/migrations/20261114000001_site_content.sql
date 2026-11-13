-- T-021 · Banners da vitrine e links do mini site da bio (/links).
-- ESCRITA E TESTADA EM PGLITE; NUNCA APLICADA em Supabase real (depende da T-031 e do OK do Rafael).
-- Substitui, para banners, a coluna `settings.banners jsonb` do desenho inicial (docs/banco-de-dados.md):
-- uma tabela permite ordenar, ativar e pôr período em cada banner com trava de edição. A coluna antiga
-- fica sem uso (não é apagada aqui).
-- RLS ativado e nenhuma policy: anon e authenticated não leem nem gravam (R3.1). Todo acesso passa pela
-- API (service_role). O site público só enxerga os itens ativos, pelo snapshot do build (GET /catalog/snapshot).

-- Arquivos da imagem: bucket público `products`, sob `banners/<image_id>/<640|1280|1920>.webp`, proporção 2:1.
create table public.banners (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null,
  alt text not null check (char_length(btrim(alt)) between 1 and 300),
  href text not null check (
    char_length(href) <= 2048
    and (href ~ '^/([^/\\[:space:]][^\\[:space:]]*)?$' or href ~ '^https://[^/?#@\\[:space:]]+([/?#][^\\[:space:]]*)?$')
  ),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create table public.bio_links (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  href text not null check (
    char_length(href) <= 2048
    and (href ~ '^/([^/\\[:space:]][^\\[:space:]]*)?$' or href ~ '^https://[^/?#@\\[:space:]]+([/?#][^\\[:space:]]*)?$')
  ),
  active boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.banners
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.bio_links
  for each row execute function public.set_updated_at();

alter table public.banners enable row level security;
alter table public.bio_links enable row level security;
revoke all on public.banners, public.bio_links from anon, authenticated, public;

-- Criar, editar, excluir e reordenar na mesma transação, com auditoria (só os nomes dos campos).
-- p_expected é o updated_at que a lojista viu: se outra aba mudou o item, nada é gravado.
create function public.admin_site_content_mutate(
  p_entity text,
  p_action text,
  p_id uuid,
  p_data jsonb,
  p_expected timestamptz,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_updated timestamptz;
  v_limit integer;
  v_count integer;
  v_ids uuid[];
  v_fields jsonb;
begin
  if p_actor is null or p_entity not in ('banners', 'bio_links')
    or p_action not in ('create', 'update', 'delete', 'reorder') then
    raise exception using errcode = 'P0001', message = 'content_invalid';
  end if;
  if p_action in ('update', 'delete') and (p_id is null or p_expected is null) then
    raise exception using errcode = 'P0001', message = 'content_changed';
  end if;

  -- Uma operação por vez em cada lista (criar e reordenar não se atropelam).
  perform pg_advisory_xact_lock(hashtext('site_content:' || p_entity));
  v_limit := case p_entity when 'banners' then 10 else 3 end;

  if p_action in ('update', 'delete') then
    if p_entity = 'banners' then
      select updated_at into v_updated from public.banners where id = v_id for update;
    else
      select updated_at into v_updated from public.bio_links where id = v_id for update;
    end if;
    if not found or v_updated is distinct from p_expected then
      raise exception using errcode = 'P0001', message = 'content_changed';
    end if;
  end if;

  if p_action = 'create' then
    execute format('select count(*) from public.%I', p_entity) into v_count;
    if v_count >= v_limit then
      raise exception using errcode = 'P0001', message = 'limit_reached';
    end if;
    if p_entity = 'banners' then
      insert into public.banners (id, image_id, alt, href, starts_at, ends_at, active, position)
      values (v_id, (p_data->>'image_id')::uuid, p_data->>'alt', p_data->>'href',
        (p_data->>'starts_at')::timestamptz, (p_data->>'ends_at')::timestamptz,
        (p_data->>'active')::boolean, (select coalesce(max(position) + 1, 0) from public.banners));
    else
      insert into public.bio_links (id, label, href, active, position)
      values (v_id, p_data->>'label', p_data->>'href', (p_data->>'active')::boolean,
        (select coalesce(max(position) + 1, 0) from public.bio_links));
    end if;
  elsif p_action = 'update' then
    if p_entity = 'banners' then
      update public.banners set
        image_id = coalesce((p_data->>'image_id')::uuid, image_id),
        alt = p_data->>'alt', href = p_data->>'href',
        starts_at = (p_data->>'starts_at')::timestamptz, ends_at = (p_data->>'ends_at')::timestamptz,
        active = (p_data->>'active')::boolean
      where id = v_id;
    else
      update public.bio_links set label = p_data->>'label', href = p_data->>'href',
        active = (p_data->>'active')::boolean
      where id = v_id;
    end if;
  elsif p_action = 'delete' then
    execute format('delete from public.%I where id = $1', p_entity) using v_id;
  else
    -- A lista enviada precisa ser exatamente o conjunto de itens existentes.
    select array(select (value)::uuid from jsonb_array_elements_text(p_data->'ids')) into v_ids;
    execute format('select count(*) from public.%I where id = any($1)', p_entity)
      into v_count using v_ids;
    if cardinality(v_ids) = 0 or v_count <> cardinality(v_ids)
      or (select count(distinct x) from unnest(v_ids) as x) <> cardinality(v_ids) then
      raise exception using errcode = 'P0001', message = 'content_changed';
    end if;
    execute format('select count(*) from public.%I', p_entity) into v_count;
    if v_count <> cardinality(v_ids) then
      raise exception using errcode = 'P0001', message = 'content_changed';
    end if;
    execute format(
      'update public.%I t set position = o.ord - 1
         from unnest($1) with ordinality as o(item, ord) where t.id = o.item', p_entity)
      using v_ids;
  end if;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_fields
    from jsonb_object_keys(coalesce(p_data, '{}'::jsonb)) as key;
  insert into public.audit_log (actor, action, entity, entity_id, diff)
    values (p_actor::text, p_action, p_entity,
      case when p_action = 'reorder' then null else v_id::text end,
      jsonb_build_object('fields', v_fields));
  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.admin_site_content_mutate(text, text, uuid, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_site_content_mutate(text, text, uuid, jsonb, timestamptz, uuid)
  to service_role;
