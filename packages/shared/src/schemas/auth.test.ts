import { describe, expect, it } from 'vitest';
import { totpCodeSchema } from './auth';

describe('totpCodeSchema', () => {
  it('aceita 6 dígitos, com ou sem espaços', () => {
    expect(totpCodeSchema.parse('123456')).toBe('123456');
    expect(totpCodeSchema.parse(' 123 456 ')).toBe('123456');
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 34 5a', '١٢٣٤٥٦', '1'.repeat(30)])(
    'recusa %j',
    (value) => {
      expect(totpCodeSchema.safeParse(value).success).toBe(false);
    },
  );
});
