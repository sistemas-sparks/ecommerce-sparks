-- T-002 · Esquema inicial (docs/banco-de-dados.md).
-- Dinheiro em centavos inteiros com CHECK (>= 0). CEPs com 8 dígitos. Datas em UTC (timestamptz).
-- Tabelas de log só de inserção (order_events, payment_events, audit_log) não têm updated_at.

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text check (char_length(name) <= 80),
  whatsapp text check (whatsapp ~ '^[0-9]{10,11}$'),
  default_address jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.package_sizes (
  size text primary key check (size in ('P', 'M', 'G')),
  weight_g integer not null check (weight_g > 0),
  length_cm integer not null check (length_cm > 0),
  width_cm integer not null check (width_cm > 0),
  height_cm integer not null check (height_cm > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  category_id uuid references public.categories (id) on delete set null,
  kind text not null default 'regular' check (kind in ('regular', 'gift_wrap')),
  price_cents integer not null check (price_cents >= 0),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  stock integer not null default 0 check (stock >= 0),
  weight_g integer check (weight_g > 0),
  package_size text not null default 'P' references public.package_sizes (size),
  length_cm integer check (length_cm > 0),
  width_cm integer check (width_cm > 0),
  height_cm integer check (height_cm > 0),
  active boolean not null default false,
  featured boolean not null default false,
  badge text check (char_length(badge) <= 30),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);
create index products_active_idx on public.products (active, kind) where deleted_at is null;

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  path text not null,
  alt text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, position);

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Cupons
-- ---------------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  type text not null check (type in ('percent', 'fixed')),
  value integer not null,
  min_order_cents integer check (min_order_cents >= 0),
  max_uses integer check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_value_check check (
    (type = 'percent' and value between 1 and 100) or (type = 'fixed' and value > 0)
  ),
  constraint coupons_uses_check check (max_uses is null or used_count <= max_uses),
  constraint coupons_period_check check (starts_at is null or ends_at is null or ends_at > starts_at)
);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^SPK-[2-9A-HJKMNP-Z]{5}$'),
  token_hash text not null unique,
  status text not null check (status in (
    'awaiting_shipping_quote', 'awaiting_payment', 'paid', 'preparing', 'shipped',
    'delivered', 'expired', 'canceled', 'returned'
  )),
  customer_user_id uuid references auth.users (id) on delete set null,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  customer_whatsapp text not null check (customer_whatsapp ~ '^[0-9]{10,11}$'),
  customer_email text check (char_length(customer_email) <= 254),
  address jsonb not null,
  address_type text not null check (address_type in ('urban', 'rural', 'hard_access')),
  shipping_service text check (shipping_service in ('local', 'economy', 'express')),
  shipping_cents integer check (shipping_cents >= 0),
  shipping_days_min integer check (shipping_days_min >= 0),
  shipping_days_max integer check (shipping_days_max >= shipping_days_min),
  tracking_code text check (char_length(tracking_code) <= 40),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  coupon_id uuid references public.coupons (id),
  gift_wrap_product_id uuid references public.products (id),
  gift_wrap_cents integer not null default 0 check (gift_wrap_cents >= 0),
  gift_message text check (char_length(gift_message) <= 140),
  total_cents integer not null check (total_cents >= 0),
  mp_preference_id text,
  mp_payment_id text unique,
  payment_method text check (payment_method in ('pix', 'credit_card', 'debit_card')),
  paid_at timestamptz,
  reserved_until timestamptz,
  notes_admin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_discount_check check (discount_cents <= subtotal_cents),
  -- O total gravado sempre bate com as parcelas (frete nulo = ainda a combinar).
  constraint orders_total_check check (
    total_cents = subtotal_cents - discount_cents + coalesce(shipping_cents, 0) + gift_wrap_cents
  ),
  -- Só pedido aguardando frete pode ficar sem frete definido.
  constraint orders_shipping_defined_check check (
    status in ('awaiting_shipping_quote', 'canceled') or shipping_cents is not null
  )
);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_customer_idx on public.orders (customer_user_id) where customer_user_id is not null;
create index orders_reserved_idx on public.orders (reserved_until) where status = 'awaiting_payment';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name_snapshot text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  qty integer not null check (qty between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, product_id)
);

-- Histórico de status (só inserção; gravado pelo trigger de status).
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Idempotência do webhook do Mercado Pago (R3.4).
create table public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'mercadopago',
  provider_event_id text not null,
  payload_hash text not null,
  order_id uuid references public.orders (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Frete (docs/frete.md)
-- ---------------------------------------------------------------------------
create table public.uf_cep_ranges (
  id uuid primary key default gen_random_uuid(),
  uf text not null check (uf in (
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
    'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
  )),
  cep_start text not null check (cep_start ~ '^[0-9]{8}$'),
  cep_end text not null check (cep_end ~ '^[0-9]{8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cep_start <= cep_end)
);

create table public.shipping_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  ufs text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.shipping_zones (id) on delete cascade,
  service text not null check (service in ('economy', 'express')),
  max_weight_g integer not null check (max_weight_g > 0),
  price_cents integer not null check (price_cents >= 0),
  days_min integer not null check (days_min >= 0),
  days_max integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (days_max >= days_min),
  unique (zone_id, service, max_weight_g)
);

create table public.shipping_local_rules (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 60),
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

create table public.shipping_cep_exceptions (
  id uuid primary key default gen_random_uuid(),
  cep_start text not null check (cep_start ~ '^[0-9]{8}$'),
  cep_end text not null check (cep_end ~ '^[0-9]{8}$'),
  action text not null check (action in ('block', 'consult', 'extra_days', 'extra_cents')),
  value integer,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cep_start <= cep_end),
  check (action in ('block', 'consult') or value > 0)
);

-- ---------------------------------------------------------------------------
-- Configurações (linha única)
-- ---------------------------------------------------------------------------
create table public.settings (
  id smallint primary key default 1 check (id = 1),
  store_whatsapp text check (store_whatsapp ~ '^[0-9]{10,11}$'),
  origin_cep text check (origin_cep ~ '^[0-9]{8}$'),
  origin_uf text,
  handling_days integer not null default 0 check (handling_days >= 0),
  free_shipping_min_cents integer check (free_shipping_min_cents >= 0),
  max_items_auto_shipping integer check (max_items_auto_shipping > 0),
  max_weight_auto_g integer check (max_weight_auto_g > 0),
  package_tare_g integer not null default 0 check (package_tare_g >= 0),
  cubic_divisor integer check (cubic_divisor > 0),
  gift_wrap_enabled boolean not null default false,
  banners jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Operação
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (key, window_start)
);

-- Auditoria do painel (só inserção).
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'categories', 'package_sizes', 'products', 'product_images', 'favorites',
    'coupons', 'orders', 'order_items', 'coupon_redemptions', 'uf_cep_ranges',
    'shipping_zones', 'shipping_rates', 'shipping_local_rules', 'shipping_cep_exceptions',
    'settings', 'rate_limits'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t
    );
  end loop;
end;
$$;
