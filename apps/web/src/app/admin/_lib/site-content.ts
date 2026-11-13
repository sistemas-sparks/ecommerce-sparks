// T-021 · Helpers puros das telas de banners e links da bio (sem rede nem DOM).
import type { AdminBanner } from '@sparks/shared';

export type BannerStatus = 'live' | 'scheduled' | 'ended' | 'off';

/** Situação do banner na loja agora (o fim do período é exclusivo, como no site). */
export function bannerStatus(
  banner: Pick<AdminBanner, 'active' | 'startsAt' | 'endsAt'>,
  now: number,
): BannerStatus {
  if (!banner.active) return 'off';
  if (banner.endsAt !== null && Date.parse(banner.endsAt) <= now) return 'ended';
  if (banner.startsAt !== null && Date.parse(banner.startsAt) > now) return 'scheduled';
  return 'live';
}

export const BANNER_STATUS_LABEL: Record<BannerStatus, string> = {
  live: 'No ar',
  scheduled: 'Agendado',
  ended: 'Período encerrado',
  off: 'Desativado',
};

/** Ids na nova ordem depois de mover o item uma posição; null se não puder mover. */
export function moveId(ids: string[], index: number, delta: -1 | 1): string[] | null {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function periodLabel(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return 'Sem prazo';
  const start = startsAt ? dateFormatter.format(new Date(startsAt)) : null;
  const end = endsAt ? dateFormatter.format(new Date(endsAt)) : null;
  if (start && end) return `${start} até ${end}`;
  return start ? `A partir de ${start}` : `Até ${end}`;
}

/** (79) 99999-1234 a partir dos dígitos com DDD. */
export function formatPhone(digits: string): string {
  return digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}
