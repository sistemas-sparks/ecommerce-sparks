-- T-028 · Frete híbrido (docs/frete.md §3 e §4). Só acréscimo: nenhuma tabela antiga é removida.

-- ---------------------------------------------------------------------------
-- Fretes próprios: tipos e faixas de CEP (preenchidos pela lojista no painel)
-- ---------------------------------------------------------------------------
create table public.shipping_own_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipping_own_areas (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.shipping_own_types (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 60),
  cep_start text not null check (cep_start ~ '^[0-9]{8}$'),
  cep_end text not null check (cep_end ~ '^[0-9]{8}$'),
  price_cents integer not null check (price_cents >= 0),
  days_min integer not null check (days_min >= 0),
  days_max integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cep_start <= cep_end),
  check (days_max >= days_min)
);
create index shipping_own_areas_type_idx on public.shipping_own_areas (type_id);
create index shipping_own_areas_cep_idx on public.shipping_own_areas (cep_start, cep_end);

-- ---------------------------------------------------------------------------
-- Serviços do Melhor Envio (só cotação; a etiqueta é comprada no painel deles)
-- ---------------------------------------------------------------------------
create table public.melhor_envio_services (
  service_id integer primary key check (service_id between 1 and 999999),
  name text not null check (char_length(name) between 1 and 100),
  carrier text not null check (char_length(carrier) between 1 and 100),
  enabled boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ids do Melhor Envio para os serviços dos Correios; conferir no sandbox quando houver token
-- (padrão PAC e SEDEX, docs/frete.md §4)
insert into public.melhor_envio_services (service_id, name, carrier, enabled, sort_order)
values (1, 'PAC', 'Correios', true, 0), (2, 'SEDEX', 'Correios', true, 1)
on conflict do nothing;

-- Folga em centavos somada a cada cotação do Melhor Envio (docs/frete.md §4)
alter table public.settings
  add column melhor_envio_margin_cents integer not null default 0
    check (melhor_envio_margin_cents >= 0);

-- ---------------------------------------------------------------------------
-- Pedido: novos formatos de shipping_service e snapshot da opção (R4.3)
-- ---------------------------------------------------------------------------
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%shipping_service%'
  loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
end;
$$;

alter table public.orders
  add constraint orders_shipping_service_check check (
    shipping_service is null
    or shipping_service in ('local', 'economy', 'express')
    or shipping_service ~ '^own:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or shipping_service ~ '^me:[1-9][0-9]{0,5}$'
  );

alter table public.orders
  add column shipping_label text check (char_length(shipping_label) <= 200),
  add column shipping_carrier text check (char_length(shipping_carrier) <= 100);

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['shipping_own_types', 'shipping_own_areas', 'melhor_envio_services']
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: ativada, sem nenhuma policy (negação por padrão, R3.1).
-- Os default privileges da migration de RLS já negam anon/authenticated e concedem service_role.
-- ---------------------------------------------------------------------------
alter table public.shipping_own_types enable row level security;
alter table public.shipping_own_areas enable row level security;
alter table public.melhor_envio_services enable row level security;
