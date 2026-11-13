'use client';

import { useEffect } from 'react';
import { scheduleVLibras } from './load-libras';

/** Assistente de Libras (VLibras, Governo Federal). Não desenha nada: só agenda o carregamento. */
export function Libras() {
  useEffect(() => scheduleVLibras(), []);
  return null;
}
