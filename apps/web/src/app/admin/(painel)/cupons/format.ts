// Helpers puros da tela de cupons. Dinheiro: centavos inteiros, sem float (R4.1).
import { formatBRL, type CouponAdminRow } from '@sparks/shared';

const TIME_ZONE = 'America/Sao_Paulo';
// O Brasil não usa horário de verão desde 2019: o fuso de São Paulo é sempre -03:00.
const SAO_PAULO_OFFSET = '-03:00';

export function discountLabel(coupon: Pick<CouponAdminRow, 'type' | 'value'>): string {
  return coupon.type === 'percent' ? `${coupon.value}%` : formatBRL(coupon.value);
}

export function minOrderLabel(minOrderCents: number | null): string {
  return minOrderCents === null || minOrderCents === 0 ? 'Sem mínimo' : formatBRL(minOrderCents);
}

export function usesLabel(coupon: Pick<CouponAdminRow, 'maxUses' | 'usedCount'>): string {
  if (coupon.maxUses === null) {
    return `${coupon.usedCount} ${coupon.usedCount === 1 ? 'uso' : 'usos'}, sem limite`;
  }
  return `${coupon.usedCount} de ${coupon.maxUses}`;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function validityLabel(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return 'Sem prazo';
  const start = startsAt ? dateFormatter.format(new Date(startsAt)) : null;
  const end = endsAt ? dateFormatter.format(new Date(endsAt)) : null;
  if (start && end) return `${start} a ${end}`;
  if (start) return `A partir de ${start}`;
  return `Até ${end}`;
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO -> valor de `datetime-local` (aaaa-mm-ddThh:mm) no horário de São Paulo. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Valor de `datetime-local` (horário de São Paulo) -> ISO com offset. Null se vazio ou inválido. */
export function localInputToIso(value: string): string | null {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null;
  const iso = `${text}:00${SAO_PAULO_OFFSET}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
