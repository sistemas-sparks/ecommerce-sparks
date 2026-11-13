import { serializeLd } from './seo';

/**
 * JSON-LD montado só por lib/seo.ts a partir de dados já validados por Zod.
 * serializeLd troca <, > e & por escapes unicode, então o conteúdo não consegue fechar o <script>.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON escapado por serializeLd; a R3.5 trata de HTML de usuário
      dangerouslySetInnerHTML={{ __html: serializeLd(data) }}
    />
  );
}
