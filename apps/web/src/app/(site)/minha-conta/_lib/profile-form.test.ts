import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROFILE_FORM,
  firstProfileError,
  formToInput,
  mergeFavorites,
  profileToForm,
  type ProfileFormValues,
} from './profile-form';

const filled: ProfileFormValues = {
  name: 'Maria',
  whatsapp: '(79) 98888-7777',
  cep: '49000-000',
  street: 'Rua das Flores',
  number: '10',
  complement: '',
  district: 'Jardins',
  city: 'Aracaju',
  uf: 'SE',
  reference: '',
  addressType: 'urban',
};

describe('endereço salvo', () => {
  it('converte o formulário no que a API aceita (CEP e WhatsApp só com dígitos)', () => {
    const result = formToInput(filled);
    expect(result).toEqual({
      ok: true,
      input: {
        name: 'Maria',
        whatsapp: '79988887777',
        defaultAddress: {
          cep: '49000000',
          street: 'Rua das Flores',
          number: '10',
          district: 'Jardins',
          city: 'Aracaju',
          uf: 'SE',
          addressType: 'urban',
        },
      },
    });
  });

  it('tudo em branco apaga os dados salvos', () => {
    expect(formToInput(EMPTY_PROFILE_FORM)).toEqual({
      ok: true,
      input: { name: null, whatsapp: null, defaultAddress: null },
    });
  });

  it('endereço pela metade mostra erro no campo certo, em português', () => {
    const result = formToInput({ ...filled, street: '', city: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['city', 'street']);
    expect(result.errors.street).toBe('Rua precisa ter pelo menos 2 caracteres.');
    expect(firstProfileError(result.errors)).toBe('street');
  });

  it('WhatsApp e UF inválidos', () => {
    const result = formToInput({ ...filled, whatsapp: '123', uf: 'XX' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.whatsapp).toBe('WhatsApp inválido. Use DDD + número.');
    expect(result.errors.uf).toBe('Estado (UF) inválido.');
  });

  it('carrega o perfil salvo de volta para os campos', () => {
    const profile = {
      name: 'Maria',
      whatsapp: '79988887777',
      defaultAddress: {
        cep: '49000000',
        street: 'Rua das Flores',
        number: '10',
        district: 'Jardins',
        city: 'Aracaju',
        uf: 'SE' as const,
        addressType: 'rural' as const,
      },
    };
    expect(profileToForm(profile)).toMatchObject({
      cep: '49000000',
      addressType: 'rural',
      complement: '',
    });
    expect(profileToForm({ name: null, whatsapp: null, defaultAddress: null })).toEqual(
      EMPTY_PROFILE_FORM,
    );
  });
});

describe('favoritos do aparelho e da conta', () => {
  it('une sem repetir', () => {
    expect(mergeFavorites(['a', 'b'], ['b', 'c'])).toEqual(['b', 'c', 'a']);
  });
  it('respeita o limite da API', () => {
    const many = Array.from({ length: 250 }, (_, i) => String(i));
    expect(mergeFavorites(many, [])).toHaveLength(200);
  });
});
