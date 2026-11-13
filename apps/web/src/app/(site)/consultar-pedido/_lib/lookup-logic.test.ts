import { describe, expect, it } from 'vitest';
import { validateLookup } from './lookup-logic';

describe('formulário Consultar pedido', () => {
  it('aceita código em qualquer caixa e WhatsApp com máscara, +55 ou só dígitos', () => {
    expect(validateLookup('spk-7f3k2', '(79) 98888-7777')).toEqual({});
    expect(validateLookup('SPK-7F3K2', '+55 79 98888-7777')).toEqual({});
    expect(validateLookup(' SPK-7F3K2 ', '79988887777')).toEqual({});
  });
  it('recusa código fora do formato (sem 0, 1, I, L, O) com mensagem em português', () => {
    for (const bad of ['', 'SPK-', 'SPK-00000', 'ABC-7F3K2', 'SPK-7F3K', 'SPK-7F3K2X']) {
      expect(validateLookup(bad, '79988887777').code, bad).toBe('Código do pedido inválido.');
    }
  });
  it('recusa WhatsApp curto ou sem DDD', () => {
    expect(validateLookup('SPK-7F3K2', '98888').whatsapp).toBe(
      'WhatsApp inválido. Use DDD + número.',
    );
    expect(validateLookup('SPK-7F3K2', '').whatsapp).toBeTruthy();
  });
  it('mostra os dois erros de uma vez', () => {
    const e = validateLookup('x', 'y');
    expect(Object.keys(e).sort()).toEqual(['code', 'whatsapp']);
  });
});
