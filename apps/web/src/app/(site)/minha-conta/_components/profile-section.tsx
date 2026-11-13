'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { UFS } from '@sparks/shared';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';
import { fetchProfile, saveProfile } from '../../pedido/_lib/api';
import {
  ADDRESS_TYPE_LABELS,
  EMPTY_PROFILE_FORM,
  firstProfileError,
  formToInput,
  profileToForm,
  type ProfileFieldName,
  type ProfileFormErrors,
  type ProfileFormValues,
} from '../_lib/profile-form';
import { Field, SelectField } from './field';

type Load = 'loading' | 'ready' | 'error';

/** Endereço salvo da conta (PRD §4.3). O checkout ainda não preenche sozinho com estes dados. */
export function ProfileSection({ accessToken }: { accessToken: string }) {
  const [values, setValues] = useState<ProfileFormValues>(EMPTY_PROFILE_FORM);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [load, setLoad] = useState<Load>('loading');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchProfile(accessToken)
      .then((profile) => {
        if (!active) return;
        setValues(profileToForm(profile));
        setLoad('ready');
      })
      .catch(() => active && setLoad('error'));
    return () => {
      active = false;
    };
  }, [accessToken]);

  const set = (field: ProfileFieldName) => (value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const result = formToInput(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = firstProfileError(result.errors);
      if (first) document.getElementById(`profile-${first}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = await saveProfile(result.input, accessToken);
      setValues(profileToForm(saved));
      setMessage({ text: 'Dados salvos.', error: false });
    } catch (err) {
      setMessage({
        text: err instanceof ApiError ? err.message : 'Não foi possível salvar agora.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="order-section" aria-labelledby="profile-title">
      <h2 id="profile-title" className="order-section-title">
        Endereço salvo
      </h2>
      {load === 'loading' ? (
        <div role="status" aria-busy="true">
          <div className="order-skeleton" aria-hidden="true" />
          <span className="order-muted">Carregando seus dados…</span>
        </div>
      ) : null}
      {load === 'error' ? (
        <p className="order-error" role="alert">
          Não foi possível carregar seus dados. Recarregue a página para tentar de novo.
        </p>
      ) : null}
      {load === 'ready' ? (
        <form className="order-form" onSubmit={(e) => void submit(e)} noValidate>
          <p className="order-muted">
            Guardamos só o que você preencher aqui. Deixe tudo em branco para apagar.
          </p>
          <Field
            id="profile-name"
            label="Nome"
            value={values.name}
            onChange={set('name')}
            error={errors.name}
            autoComplete="name"
            maxLength={80}
            optional
          />
          <Field
            id="profile-whatsapp"
            label="WhatsApp"
            value={values.whatsapp}
            onChange={set('whatsapp')}
            error={errors.whatsapp}
            autoComplete="tel-national"
            inputMode="tel"
            maxLength={20}
            optional
          />
          <Field
            id="profile-cep"
            label="CEP"
            value={values.cep}
            onChange={set('cep')}
            error={errors.cep}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
          />
          <Field
            id="profile-street"
            label="Rua"
            value={values.street}
            onChange={set('street')}
            error={errors.street}
            autoComplete="address-line1"
            maxLength={120}
          />
          <div className="order-pair">
            <Field
              id="profile-number"
              label="Número"
              value={values.number}
              onChange={set('number')}
              error={errors.number}
              autoComplete="off"
              maxLength={20}
            />
            <Field
              id="profile-complement"
              label="Complemento"
              value={values.complement}
              onChange={set('complement')}
              error={errors.complement}
              autoComplete="address-line2"
              maxLength={60}
              optional
            />
          </div>
          <Field
            id="profile-district"
            label="Bairro"
            value={values.district}
            onChange={set('district')}
            error={errors.district}
            autoComplete="address-level3"
            maxLength={80}
          />
          <div className="order-pair">
            <Field
              id="profile-city"
              label="Cidade"
              value={values.city}
              onChange={set('city')}
              error={errors.city}
              autoComplete="address-level2"
              maxLength={80}
            />
            <SelectField
              id="profile-uf"
              label="Estado"
              value={values.uf}
              onChange={set('uf')}
              error={errors.uf}
            >
              <option value="">Escolha</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </SelectField>
          </div>
          <Field
            id="profile-reference"
            label="Ponto de referência"
            value={values.reference}
            onChange={set('reference')}
            error={errors.reference}
            maxLength={120}
            optional
          />
          <SelectField
            id="profile-addressType"
            label="Tipo de endereço"
            value={values.addressType}
            onChange={set('addressType')}
            error={errors.addressType}
          >
            {Object.entries(ADDRESS_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <div className="order-actions">
            <Button type="submit" loading={busy}>
              Salvar
            </Button>
            {message ? (
              <p
                role={message.error ? 'alert' : 'status'}
                className={message.error ? 'order-error' : 'order-muted'}
              >
                {message.text}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
