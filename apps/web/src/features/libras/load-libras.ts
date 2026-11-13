// Carregador do VLibras (assistente de Libras oficial do Governo Federal, gratuito).
// Decisão do Rafael em 2026-11-12 (ver docs/memoria.md). O script só é pedido ao gov.br quando
// o visitante interage ou, sem interação, alguns segundos depois de a página ficar ociosa, para
// não disputar banda e processador com o conteúdo. Nada aqui roda no servidor nem em desenvolvimento.

export const VLIBRAS_SCRIPT_URL = 'https://vlibras.gov.br/app/vlibras-plugin.js';
export const VLIBRAS_MARKER = 'data-vlibras';
export const VLIBRAS_IDLE_DELAY_MS = 6000;
export const VLIBRAS_IDLE_TIMEOUT_MS = 4000;
export const VLIBRAS_WATCH_LIMIT_MS = 30_000;
/** Tamanho mínimo do alvo de toque (R5.4). */
export const VLIBRAS_MIN_TARGET_PX = 44;

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

type StyleTarget = { style: { setProperty(name: string, value: string): void } };

/** Parte da API do plugin que o site usa (o plugin monta o botão sozinho depois de carregar). */
type VLibrasWindow = Window & {
  VLibrasWidget?: { access?: StyleTarget & Element; initBtn?: StyleTarget & Element };
};

interface LoadOptions {
  doc?: Document;
  win?: VLibrasWindow;
  /** Padrão: só em produção. Os testes passam true. */
  production?: boolean;
}

function currentWindow(options: LoadOptions): VLibrasWindow | undefined {
  return options.win ?? (typeof window === 'undefined' ? undefined : (window as VLibrasWindow));
}

function currentDocument(options: LoadOptions): Document | undefined {
  return options.doc ?? (typeof document === 'undefined' ? undefined : document);
}

/** Acrescenta o script do plugin uma única vez. Devolve true só quando ele foi acrescentado. */
export function loadVLibras(options: LoadOptions = {}): boolean {
  // NEXT_PUBLIC_VLIBRAS=1 liga o botão no `next dev` só para pré-visualização local.
  const production =
    options.production ??
    (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_VLIBRAS === '1');
  const win = currentWindow(options);
  const doc = currentDocument(options);
  if (!production || !win || !doc?.body) return false;
  if (win.VLibrasWidget || doc.querySelector(`script[${VLIBRAS_MARKER}]`)) return false;
  const script = doc.createElement('script');
  script.src = VLIBRAS_SCRIPT_URL;
  script.async = true;
  script.setAttribute(VLIBRAS_MARKER, '');
  doc.body.appendChild(script);
  return true;
}

/**
 * Agenda o carregamento: na primeira interação, ou depois de VLIBRAS_IDLE_DELAY_MS + ociosidade.
 * Devolve a função que cancela tudo (desmontagem do componente).
 */
export function scheduleVLibras(options: LoadOptions = {}): () => void {
  const win = currentWindow(options);
  const doc = currentDocument(options);
  if (!win || !doc) return () => {};
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const removeListeners = () => {
    for (const name of INTERACTION_EVENTS) win.removeEventListener(name, run, true);
    win.removeEventListener('load', schedule);
  };
  function run() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    removeListeners();
    if (loadVLibras(options)) watchVLibrasButton(options);
  }
  function schedule() {
    for (const name of INTERACTION_EVENTS) {
      win!.addEventListener(name, run, { capture: true, passive: true, once: true });
    }
    timer = setTimeout(() => {
      if (typeof win!.requestIdleCallback === 'function') {
        win!.requestIdleCallback(run, { timeout: VLIBRAS_IDLE_TIMEOUT_MS });
      } else {
        run();
      }
    }, VLIBRAS_IDLE_DELAY_MS);
  }

  if (doc.readyState === 'complete') schedule();
  else win.addEventListener('load', schedule);
  return () => {
    done = true;
    clearTimeout(timer);
    removeListeners();
  };
}

/** Posiciona o botão oficial (canto direito) pelas variáveis CSS do site. Devolve true se achou o botão. */
export function positionVLibrasButton(options: LoadOptions = {}): boolean {
  const win = currentWindow(options);
  const widget = win?.VLibrasWidget;
  if (!win || !widget?.access) return false;
  const style = widget.access.style;
  style.setProperty('position', 'fixed');
  style.setProperty('left', 'auto');
  style.setProperty('top', 'auto');
  style.setProperty('transform', 'none');
  style.setProperty('right', 'var(--sparks-libras-right, 20px)');
  style.setProperty('bottom', 'var(--sparks-libras-bottom, 20px)');
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    style.setProperty('transition', 'none');
    style.setProperty('animation', 'none');
  }
  if (widget.initBtn) {
    widget.initBtn.style.setProperty('min-width', `${VLIBRAS_MIN_TARGET_PX}px`);
    widget.initBtn.style.setProperty('min-height', `${VLIBRAS_MIN_TARGET_PX}px`);
  }
  return true;
}

/** O plugin monta o botão em etapas: observa o <body> até posicionar (ou até o limite de tempo). */
export function watchVLibrasButton(options: LoadOptions = {}): void {
  if (positionVLibrasButton(options)) return;
  const doc = currentDocument(options);
  if (!doc?.body || typeof MutationObserver === 'undefined') return;
  // Se o serviço externo falhar, o site segue normal e a observação termina.
  const limit = setTimeout(() => observer.disconnect(), VLIBRAS_WATCH_LIMIT_MS);
  const observer = new MutationObserver(() => {
    if (positionVLibrasButton(options)) {
      observer.disconnect();
      clearTimeout(limit);
    }
  });
  observer.observe(doc.body, { childList: true });
}
