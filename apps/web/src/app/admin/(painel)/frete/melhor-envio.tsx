'use client';

import { useState } from 'react';
import {
  MELHOR_ENVIO_MARGIN_MAX_CENTS,
  shippingHybridSettingsInputSchema,
  type ShippingHybridAdminData,
} from '@sparks/shared';
import { Button } from '@/ui';
import {
  FormFields,
  errorMessage,
  formValues,
  moneyText,
  payload,
  type Field,
  type Values,
} from './fields';
import type { Mutate } from './own-freight';

const MARGIN_FIELDS: Field[] = [
  { name: 'melhor_envio_margin_cents', label: 'Folga por envio (R$)', type: 'money' },
];

export function MelhorEnvio({
  data,
  saving,
  mutate,
  onError,
}: {
  data: ShippingHybridAdminData;
  saving: boolean;
  mutate: Mutate;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<Values>(() => formValues(MARGIN_FIELDS, data.settings));
  const services = [...data.me_services].sort((a, b) => a.sort_order - b.sort_order);

  async function saveMargin() {
    try {
      const { melhor_envio_margin_cents } = payload(MARGIN_FIELDS, values);
      const { settings } = data;
      const body = shippingHybridSettingsInputSchema.parse({
        origin_cep: settings.origin_cep,
        origin_uf: settings.origin_uf,
        handling_days: settings.handling_days,
        free_shipping_min_cents: settings.free_shipping_min_cents,
        max_items_auto_shipping: settings.max_items_auto_shipping,
        max_weight_auto_g: settings.max_weight_auto_g,
        package_tare_g: settings.package_tare_g,
        cubic_divisor: null,
        melhor_envio_margin_cents,
      });
      if (await mutate('/admin/shipping/settings', 'PATCH', body))
        setValues(formValues(MARGIN_FIELDS, { melhor_envio_margin_cents }));
    } catch (err) {
      onError(
        errorMessage(
          err,
          `Confira a folga: use um valor de R$ 0,00 até ${moneyText(MELHOR_ENVIO_MARGIN_MAX_CENTS)}.`,
        ),
      );
    }
  }

  return (
    <section>
      <h2>Melhor Envio</h2>
      <p>
        A etiqueta é comprada por você no painel do Melhor Envio; aqui só definimos o que aparece na
        cotação.
      </p>
      <ul className="shipping-rows">
        {services.map((service) => (
          <li key={service.service_id} className="shipping-service">
            <div>
              <strong>{service.name}</strong>
              <p>{service.carrier}</p>
            </div>
            <label className="shipping-check">
              <input
                type="checkbox"
                checked={service.enabled}
                disabled={saving}
                onChange={(event) =>
                  void mutate(`/admin/shipping/me-services/${service.service_id}`, 'PATCH', {
                    enabled: event.target.checked,
                  })
                }
              />
              Mostrar na cotação
            </label>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveMargin();
        }}
      >
        <FormFields
          fields={MARGIN_FIELDS}
          values={values}
          onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
        />
        <p>
          Folga opcional somada ao preço de cada cotação do Melhor Envio. Máximo de{' '}
          {moneyText(MELHOR_ENVIO_MARGIN_MAX_CENTS)}.
        </p>
        <Button type="submit" loading={saving}>
          Salvar folga
        </Button>
      </form>
    </section>
  );
}
