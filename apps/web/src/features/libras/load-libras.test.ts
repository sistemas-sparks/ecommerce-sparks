import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VLIBRAS_IDLE_DELAY_MS,
  VLIBRAS_SCRIPT_URL,
  loadVLibras,
  scheduleVLibras,
} from './load-libras';

// Sem navegador: documento e janela falsos, só com o que o carregador usa.
function fakeDom(readyState = 'complete') {
  const appended: Array<{ src?: string; async?: boolean; attrs: Record<string, string> }> = [];
  const listeners = new Map<string, () => void>();
  const doc = {
    readyState,
    body: {
      appendChild(node: (typeof appended)[number]) {
        appended.push(node);
      },
    },
    querySelector: (selector: string) =>
      selector === 'script[data-vlibras]' ? (appended[0] ?? null) : null,
    createElement: () => {
      const node: (typeof appended)[number] & { setAttribute(n: string, v: string): void } = {
        attrs: {},
        setAttribute(name, value) {
          node.attrs[name] = value;
        },
      };
      return node;
    },
  };
  const win: Record<string, unknown> = {
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  return {
    appended,
    listeners,
    doc: doc as unknown as Document,
    win: win as unknown as Window,
    winRaw: win,
  };
}

afterEach(() => vi.useRealTimers());

describe('loadVLibras', () => {
  it('carrega o script oficial uma única vez', () => {
    const { appended, doc, win } = fakeDom();
    expect(loadVLibras({ doc, win, production: true })).toBe(true);
    expect(loadVLibras({ doc, win, production: true })).toBe(false);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toBe(VLIBRAS_SCRIPT_URL);
    expect(appended[0]?.async).toBe(true);
    expect(appended[0]?.attrs).toHaveProperty('data-vlibras');
  });

  it('não carrega se o plugin já existe na janela', () => {
    const { appended, doc, win, winRaw } = fakeDom();
    winRaw.VLibrasWidget = {};
    expect(loadVLibras({ doc, win, production: true })).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it('não carrega fora de produção nem sem navegador', () => {
    const { appended, doc, win } = fakeDom();
    expect(loadVLibras({ doc, win, production: false })).toBe(false);
    expect(loadVLibras({ production: true })).toBe(false); // vitest roda em node: sem window
    expect(appended).toHaveLength(0);
  });
});

describe('scheduleVLibras', () => {
  it('carrega na primeira interação e só uma vez', () => {
    const { appended, doc, win, listeners } = fakeDom();
    scheduleVLibras({ doc, win, production: true });
    expect(appended).toHaveLength(0);
    listeners.get('pointerdown')?.();
    expect(appended).toHaveLength(1);
    expect(listeners.size).toBe(0);
  });

  it('sem interação, carrega depois do atraso de ociosidade', () => {
    vi.useFakeTimers();
    const { appended, doc, win } = fakeDom();
    scheduleVLibras({ doc, win, production: true });
    vi.advanceTimersByTime(VLIBRAS_IDLE_DELAY_MS - 1);
    expect(appended).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(appended).toHaveLength(1);
  });

  it('o cancelamento impede o carregamento', () => {
    vi.useFakeTimers();
    const { appended, doc, win } = fakeDom();
    const cancel = scheduleVLibras({ doc, win, production: true });
    cancel();
    vi.advanceTimersByTime(VLIBRAS_IDLE_DELAY_MS * 2);
    expect(appended).toHaveLength(0);
  });
});
