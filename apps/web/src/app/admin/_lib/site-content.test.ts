import { describe, expect, it } from 'vitest';
import { bannerStatus, formatPhone, moveId, periodLabel } from './site-content';

const now = Date.parse('2026-11-13T12:00:00-03:00');

describe('bannerStatus', () => {
  it('desativado vence qualquer período', () => {
    expect(bannerStatus({ active: false, startsAt: null, endsAt: null }, now)).toBe('off');
  });
  it('classifica por período', () => {
    expect(bannerStatus({ active: true, startsAt: null, endsAt: null }, now)).toBe('live');
    expect(
      bannerStatus({ active: true, startsAt: '2026-12-01T00:00:00-03:00', endsAt: null }, now),
    ).toBe('scheduled');
    expect(
      bannerStatus({ active: true, startsAt: null, endsAt: '2026-11-13T12:00:00-03:00' }, now),
    ).toBe('ended');
    expect(
      bannerStatus(
        {
          active: true,
          startsAt: '2026-11-01T00:00:00-03:00',
          endsAt: '2026-11-30T00:00:00-03:00',
        },
        now,
      ),
    ).toBe('live');
  });
});

describe('moveId', () => {
  it('troca com o vizinho e não passa das pontas', () => {
    expect(moveId(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 0, -1)).toBeNull();
    expect(moveId(['a', 'b', 'c'], 2, 1)).toBeNull();
  });
  it('não altera a lista original', () => {
    const ids = ['a', 'b'];
    moveId(ids, 0, 1);
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('textos', () => {
  it('período e telefone', () => {
    expect(periodLabel(null, null)).toBe('Sem prazo');
    expect(periodLabel('2026-12-01T00:00:00-03:00', null)).toMatch(/^A partir de 01\/12\/2026/);
    expect(formatPhone('79999991234')).toBe('(79) 99999-1234');
    expect(formatPhone('7933221234')).toBe('(79) 3322-1234');
  });
});
