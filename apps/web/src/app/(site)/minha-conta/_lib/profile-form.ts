// Formulário do endereço salvo (PRD §4.3): converte entre os campos da tela e o que a API aceita.
// A validação usa o mesmo schema do servidor; o servidor valida de novo.
import { profileInputSchema, type Profile, type ProfileInput } from '@sparks/shared';

export const ADDRESS_FIELDS = [
  'cep',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'uf',
  'reference',
] as const;

export type ProfileFieldName =
  'name' | 'whatsapp' | 'addressType' | (typeof ADDRESS_FIELDS)[number];

export type ProfileFormValues = Record<ProfileFieldName, string>;
export type ProfileFormErrors = Partial<Record<ProfileFieldName, string>>;

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  name: '',
  whatsapp: '',
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  uf: '',
  reference: '',
  addressType: 'urban',
};

export const ADDRESS_TYPE_LABELS = {
  urban: 'Endereço urbano',
  rural: 'Zona rural',
  hard_access: 'Local de difícil acesso',
} as const;

export function profileToForm(profile: Profile): ProfileFormValues {
  const a = profile.defaultAddress;
  return {
    name: profile.name ?? '',
    whatsapp: profile.whatsapp ?? '',
    cep: a?.cep ?? '',
    street: a?.street ?? '',
    number: a?.number ?? '',
    complement: a?.complement ?? '',
    district: a?.district ?? '',
    city: a?.city ?? '',
    uf: a?.uf ?? '',
    reference: a?.reference ?? '',
    addressType: a?.addressType ?? 'urban',
  };
}

const KNOWN: readonly string[] = ['name', 'whatsapp', ...ADDRESS_FIELDS, 'addressType'];

export function formToInput(
  values: ProfileFormValues,
): { ok: true; input: ProfileInput } | { ok: false; errors: ProfileFormErrors } {
  // Endereço totalmente em branco = apagar o endereço salvo.
  const blank = ADDRESS_FIELDS.every((f) => values[f].trim() === '');
  const address = blank
    ? null
    : {
        cep: values.cep,
        street: values.street,
        number: values.number,
        complement: values.complement.trim() === '' ? undefined : values.complement,
        district: values.district,
        city: values.city,
        uf: values.uf,
        reference: values.reference.trim() === '' ? undefined : values.reference,
        addressType: values.addressType,
      };
  const parsed = profileInputSchema.safeParse({
    name: values.name,
    whatsapp: values.whatsapp,
    defaultAddress: address,
  });
  if (parsed.success) return { ok: true, input: parsed.data };

  const errors: ProfileFormErrors = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.filter((p): p is string => typeof p === 'string');
    const field = path[0] === 'defaultAddress' ? path[1] : path[0];
    if (field && KNOWN.includes(field) && !errors[field as ProfileFieldName]) {
      errors[field as ProfileFieldName] = issue.message;
    }
  }
  return { ok: false, errors };
}

/** Primeiro campo com erro, na ordem da tela, para levar o foco. */
export function firstProfileError(errors: ProfileFormErrors): ProfileFieldName | null {
  const order: ProfileFieldName[] = ['name', 'whatsapp', ...ADDRESS_FIELDS, 'addressType'];
  return order.find((f) => errors[f]) ?? null;
}

/** Une os favoritos do aparelho com os da conta, sem repetir e respeitando o limite da API. */
export function mergeFavorites(local: readonly string[], remote: readonly string[], max = 200) {
  return [...new Set([...remote, ...local])].slice(0, max);
}
