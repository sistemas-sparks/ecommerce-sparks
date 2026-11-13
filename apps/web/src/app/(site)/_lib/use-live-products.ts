'use client';

import { useEffect, useState } from 'react';
import { liveProductsSchema, type LiveProduct, type PublicProduct } from '@sparks/shared';
import { apiFetch } from '@/lib/api';
import { publicConfig } from '@/lib/public-config';

export function useLiveProducts(products: PublicProduct[]) {
  const ids = products
    .map((product) => product.id)
    .sort()
    .join(',');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    products: LiveProduct[];
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!ids) return;
    let active = true;
    const controller = new AbortController();
    const chunks: string[][] = [];
    const values = ids.split(',');
    for (let i = 0; i < values.length; i += 50) chunks.push(values.slice(i, i + 50));
    const request = publicConfig.apiUrl
      ? Promise.all(
          chunks.map(async (chunk) => {
            const body = await apiFetch(
              `/products/live?ids=${encodeURIComponent(chunk.join(','))}`,
              { signal: controller.signal },
            );
            return liveProductsSchema.parse(body).products;
          }),
        )
      : Promise.reject(new Error('API indisponível'));
    request
      .then((results) => {
        if (active) setState({ key: ids, products: results.flat(), error: false });
      })
      .catch(() => {
        if (active) setState({ key: ids, products: [], error: true });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [ids, attempt]);
  return {
    products: state?.key === ids ? state.products : [],
    error: Boolean(ids) && state?.key === ids && state.error,
    retry: () => setAttempt((value) => value + 1),
  };
}
