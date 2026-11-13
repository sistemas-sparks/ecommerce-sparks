# Banco de dados (Supabase / Postgres)

Rascunho de referência. As migrations em `supabase/migrations` são a fonte de verdade depois de criadas.

## Princípios
- RLS ativo em todas as tabelas. Os papéis `anon` e `authenticated` **não têm acesso direto** às tabelas de negócio. O acesso passa pela API, e as operações críticas por funções SQL.
- Dinheiro em centavos (`integer`), com `CHECK (>= 0)`.
- `created_at` e `updated_at` em todas as tabelas; exclusão lógica (`deleted_at`) em produtos e cupons.
- `audit_log` só de inserção (UPDATE e DELETE revogados).

## Tabelas
| Tabela | Campos principais |
|---|---|
| `profiles` | `user_id`, `name`, `whatsapp`, `default_address jsonb` |
| `categories` | `id`, `slug`, `name`, `position`, `active` |
| `products` | `id`, `slug`, `name`, `description`, `category_id`, `kind` (`regular` \| `gift_wrap`), `price_cents`, `cost_cents`, `stock`, `weight_g`, `package_size` (`P`\|`M`\|`G`), `length_cm`/`width_cm`/`height_cm` (opcionais), `active`, `featured`, `badge`, `deleted_at` |
| `product_images` | `product_id`, `path`, `alt`, `position` |
| `favorites` | `user_id`, `product_id` |
| `orders` | `id`, `code` (ex.: `SPK-7F3K2`), `token_hash`, `status`, `customer_user_id`, `customer_name`, `customer_whatsapp`, `customer_email`, `address jsonb`, `address_type` (`urban`\|`rural`\|`hard_access`), `shipping_service`, `shipping_cents`, `shipping_days_min/max`, `tracking_code`, `subtotal_cents`, `discount_cents`, `coupon_id`, `gift_wrap_product_id`, `gift_wrap_cents`, `gift_message`, `total_cents`, `mp_preference_id`, `mp_payment_id`, `payment_method`, `paid_at`, `reserved_until`, `notes_admin` |
| `order_items` | `order_id`, `product_id`, `name_snapshot`, `unit_price_cents`, `unit_cost_cents`, `qty` |
| `order_events` | histórico de status (`order_id`, `from`, `to`, `by`, `at`) |
| `payment_events` | `provider_event_id` UNIQUE, `payload_hash`, `processed_at` (idempotência) |
| `coupons` | `code` UNIQUE (maiúsculas), `type` (`percent`\|`fixed`), `value`, `min_order_cents`, `max_uses`, `used_count`, `starts_at`, `ends_at`, `active` |
| `coupon_redemptions` | `coupon_id`, `order_id` |
| `uf_cep_ranges` | `uf`, `cep_start`, `cep_end` |
| `shipping_zones` | `id`, `name`, `ufs text[]`, `active` |
| `shipping_rates` | `zone_id`, `service` (`economy`\|`express`), `max_weight_g`, `price_cents`, `days_min`, `days_max` |
| `shipping_local_rules` | `label`, `cep_start`, `cep_end`, `price_cents`, `days_min`, `days_max`, `active` |
| `shipping_cep_exceptions` | `cep_start`, `cep_end`, `action` (`block`\|`consult`\|`extra_days`\|`extra_cents`), `value`, `note` |
| `settings` | linha única: `store_whatsapp`, `origin_cep`, `origin_uf`, `handling_days`, `free_shipping_min_cents`, `max_items_auto_shipping`, `max_weight_auto_g`, `gift_wrap_enabled`, `banners jsonb` |
| `banners` | (T-021) `image_id`, `alt`, `href`, `starts_at`, `ends_at`, `active`, `position`; arquivos em `products/banners/<image_id>/{640,1280,1920}.webp`; substitui `settings.banners` |
| `bio_links` | (T-021) `label`, `href`, `active`, `position` (até 3; WhatsApp e Instagram vêm da configuração) |
| `rate_limits` | `key`, `window_start`, `count` |

> **Frete muda na T-028 (decisão de 20/10/2026, ver `frete.md`):** saem `uf_cep_ranges`, `shipping_zones` e `shipping_rates` (a cotação nacional vem do Melhor Envio). `shipping_local_rules` dá lugar a **tipos de frete próprios** (ex.: "Entrega rápida", "Entrega local") com **áreas por faixa de CEP**, preço e prazo. Entram em `settings` os serviços do Melhor Envio exibidos e a folga em centavos. Em `orders`, `shipping_service` deixa de ser `local|economy|express` e passa a guardar o código do serviço + cópia do nome e da transportadora (snapshot). `shipping_cep_exceptions` e os limites de `settings` continuam. O desenho final fica na migration da T-028.
| `audit_log` | `actor`, `action`, `entity`, `entity_id`, `diff jsonb`, `at` |

## Status do pedido
`awaiting_shipping_quote` (rural) → `awaiting_payment` → `paid` → `preparing` → `shipped` → `delivered`
Laterais: `expired`, `canceled`, `returned`. Um trigger impede transições inválidas.

## Funções SQL (SECURITY DEFINER, `search_path` fixo, EXECUTE só para `service_role`)
- `create_order(payload jsonb)`: valida, reserva estoque (`stock >= qty`, atômico), registra cupom pendente, define `reserved_until`.
- `mark_order_paid(order_id, mp_payment_id, amount_cents)`: idempotente; confere valor; confirma cupom; grava evento.
- `expire_unpaid_orders()`: libera estoque e cupom dos pedidos vencidos.
- `set_order_status(order_id, new_status, actor)`: valida a transição e registra o evento.
- `profit_report(from, to)`: soma de vendas, custos e lucro (pedidos pagos).

## Testes de RLS (obrigatórios)
Como `anon` e como cliente A: tentar ler, inserir, alterar e apagar em todas as tabelas, inclusive os dados do cliente B. **Tudo deve falhar.** Rodar no CI.
