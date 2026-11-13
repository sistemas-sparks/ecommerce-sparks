'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  UFS,
  shippingExceptionInputSchema,
  shippingHybridAdminDataSchema,
  shippingHybridSettingsInputSchema,
  packageSizeInputSchema,
  type ShippingHybridAdminData,
} from '@sparks/shared';
import { apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import {
  FormFields,
  displayValue,
  errorMessage,
  formValues,
  payload,
  type Field,
  type Values,
} from './fields';
import { MelhorEnvio } from './melhor-envio';
import { OwnFreight } from './own-freight';
import './shipping.css';

type Entity = 'exceptions' | 'package-sizes';

const ACTIONS = [
  ['block', 'Sem entrega'],
  ['consult', 'Frete a combinar'],
  ['extra_days', 'Acrescentar dias'],
  ['extra_cents', 'Acrescentar valor'],
] as const;
const EXCEPTION_FIELDS: Field[] = [
  { name: 'cep_start', label: 'CEP inicial', type: 'cep' },
  { name: 'cep_end', label: 'CEP final', type: 'cep' },
  { name: 'action', label: 'Ação', type: 'select', choices: ACTIONS },
  { name: 'value', label: 'Acréscimo em dias ou centavos', type: 'integer', nullable: true },
  { name: 'note', label: 'Observação', type: 'text', nullable: true },
];
const SIZE_FIELDS: Field[] = [
  {
    name: 'size',
    label: 'Tamanho',
    type: 'select',
    choices: [
      ['P', 'P'],
      ['M', 'M'],
      ['G', 'G'],
    ],
  },
  { name: 'weight_g', label: 'Peso padrão (g)', type: 'integer' },
  { name: 'length_cm', label: 'Comprimento (cm)', type: 'integer' },
  { name: 'width_cm', label: 'Largura (cm)', type: 'integer' },
  { name: 'height_cm', label: 'Altura (cm)', type: 'integer' },
];
const SETTINGS: Field[] = [
  { name: 'origin_cep', label: 'CEP de origem', type: 'cep', nullable: true },
  {
    name: 'origin_uf',
    label: 'UF de origem',
    type: 'select',
    nullable: true,
    choices: UFS.map((uf) => [uf, uf] as const),
  },
  { name: 'handling_days', label: 'Tempo de preparo (dias úteis)', type: 'integer' },
  {
    name: 'free_shipping_min_cents',
    label: 'Frete grátis a partir de (R$)',
    type: 'money',
    nullable: true,
  },
  {
    name: 'max_items_auto_shipping',
    label: 'Máximo de itens no frete automático',
    type: 'integer',
    nullable: true,
  },
  {
    name: 'max_weight_auto_g',
    label: 'Peso máximo automático (g)',
    type: 'integer',
    nullable: true,
  },
  { name: 'package_tare_g', label: 'Peso da caixa (g)', type: 'integer' },
];
const schemas = {
  exceptions: shippingExceptionInputSchema,
  'package-sizes': packageSizeInputSchema,
};

function exceptionFields(values: Values): Field[] {
  return EXCEPTION_FIELDS.flatMap((field) => {
    if (field.name !== 'value') return [field];
    if (values.action === 'extra_cents')
      return [{ ...field, label: 'Acréscimo (R$)', type: 'money' as const, nullable: false }];
    if (values.action === 'extra_days')
      return [
        { ...field, label: 'Acréscimo (dias úteis)', type: 'integer' as const, nullable: false },
      ];
    return [];
  });
}
function fieldsFor(entity: Entity, values: Values): Field[] {
  return entity === 'exceptions' ? exceptionFields(values) : SIZE_FIELDS;
}

export function ShippingPanel() {
  const { getAccessToken } = useAdmin();
  const [data, setData] = useState<ShippingHybridAdminData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{
    entity: Entity;
    id: string | null;
    values: Values;
  } | null>(null);
  const [settings, setSettings] = useState<Values>({});
  const load = useCallback(async () => {
    return shippingHybridAdminDataSchema.parse(
      await apiFetch('/admin/shipping', { token: await getAccessToken() }),
    );
  }, [getAccessToken]);
  const applyData = useCallback((loaded: ShippingHybridAdminData) => {
    setData(loaded);
    setError('');
    setSettings(formValues(SETTINGS, loaded.settings));
  }, []);
  const refresh = useCallback(async () => {
    applyData(await load());
  }, [load, applyData]);
  useEffect(() => {
    let active = true;
    void load()
      .then((loaded) => {
        if (active) applyData(loaded);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err, 'Não foi possível carregar o frete.'));
      });
    return () => {
      active = false;
    };
  }, [load, applyData]);
  async function mutate(path: string, method: string, body?: unknown): Promise<boolean> {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(path, {
        method,
        token: await getAccessToken(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      await refresh();
      setNotice('Configuração salva.');
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar.'));
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function saveEditor() {
    if (!editor) return;
    try {
      const input = payload(fieldsFor(editor.entity, editor.values), editor.values);
      if (editor.entity === 'exceptions' && !('value' in input)) input.value = null;
      const body = schemas[editor.entity].parse(input);
      if (
        await mutate(
          `/admin/shipping/${editor.entity}${editor.id ? `/${editor.id}` : ''}`,
          editor.id ? 'PATCH' : 'POST',
          body,
        )
      )
        setEditor(null);
    } catch (err) {
      setError(
        errorMessage(err, 'Confira os campos, os CEPs, os valores e os prazos antes de salvar.'),
      );
    }
  }
  if (!data)
    return (
      <div>
        <h1 className="shipping-title">Frete</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button
              onClick={() =>
                void refresh().catch((err) =>
                  setError(errorMessage(err, 'Não foi possível carregar o frete.')),
                )
              }
            >
              Tentar de novo
            </Button>
          </>
        ) : (
          <p role="status">Carregando frete…</p>
        )}
      </div>
    );
  const sections: { entity: Entity; title: string; rows: Record<string, unknown>[] }[] = [
    { entity: 'exceptions', title: 'Exceções por CEP', rows: data.exceptions },
    { entity: 'package-sizes', title: 'Tamanhos de embalagem', rows: data.package_sizes },
  ];
  return (
    <div className="shipping-panel">
      <h1 className="shipping-title">Frete</h1>
      <p>
        Fretes próprios por faixa de CEP e cotação nacional pelo Melhor Envio. Pedidos rurais ou de
        difícil acesso sempre ficam com frete a combinar.
      </p>
      {error && (
        <p role="alert" className="shipping-error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <OwnFreight data={data} saving={saving} mutate={mutate} onError={setError} />
      <MelhorEnvio
        key={data.settings.melhor_envio_margin_cents}
        data={data}
        saving={saving}
        mutate={mutate}
        onError={setError}
      />
      <section>
        <h2>Preparo, limites e frete grátis</h2>
        <p>
          Campos opcionais vazios desativam o limite ou o frete grátis. O frete grátis zera a opção
          mais barata do Melhor Envio, depois do desconto nos produtos.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const body = shippingHybridSettingsInputSchema.parse({
                ...payload(SETTINGS, settings),
                cubic_divisor: null,
              });
              void mutate('/admin/shipping/settings', 'PATCH', body);
            } catch (err) {
              setError(errorMessage(err, 'Confira as configurações antes de salvar.'));
            }
          }}
        >
          <FormFields
            fields={SETTINGS}
            values={settings}
            onChange={(name, value) => setSettings((values) => ({ ...values, [name]: value }))}
          />
          <p>Peso cubado: aguardando confirmação da fórmula.</p>
          <Button type="submit" loading={saving}>
            Salvar configurações
          </Button>
        </form>
      </section>
      {sections.map((section) => (
        <section key={section.entity}>
          <div className="shipping-section-heading">
            <h2>{section.title}</h2>
            {section.entity === 'exceptions' && (
              <Button
                variant="white"
                onClick={() =>
                  setEditor({
                    entity: section.entity,
                    id: null,
                    values: formValues(EXCEPTION_FIELDS, {}),
                  })
                }
              >
                Adicionar
              </Button>
            )}
          </div>
          {section.rows.length === 0 ? (
            <p>Nenhum cadastro nesta seção.</p>
          ) : (
            <ul className="shipping-rows">
              {section.rows.map((row) => {
                const id = String('id' in row ? row.id : row.size);
                const rowValues = formValues(SIZE_FIELDS.concat(EXCEPTION_FIELDS), row);
                return (
                  <li key={id}>
                    <dl>
                      {fieldsFor(section.entity, rowValues).map((field) => (
                        <div key={field.name}>
                          <dt>{field.label}</dt>
                          <dd>{displayValue(field, row)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="shipping-row-actions">
                      <Button
                        variant="white"
                        onClick={() =>
                          setEditor({
                            entity: section.entity,
                            id,
                            values: formValues(fieldsFor(section.entity, rowValues), row),
                          })
                        }
                      >
                        Editar
                      </Button>
                      {section.entity === 'exceptions' && (
                        <Button
                          variant="white"
                          disabled={saving}
                          onClick={() => {
                            if (window.confirm('Excluir esta exceção de frete?'))
                              void mutate(`/admin/shipping/${section.entity}/${id}`, 'DELETE');
                          }}
                        >
                          Excluir
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {editor?.entity === section.entity && (
            <form
              className="shipping-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void saveEditor();
              }}
            >
              <h3>{editor.id ? 'Editar cadastro' : 'Novo cadastro'}</h3>
              <FormFields
                fields={fieldsFor(editor.entity, editor.values)}
                values={editor.values}
                onChange={(name, value) =>
                  setEditor((current) =>
                    current
                      ? {
                          ...current,
                          values: {
                            ...current.values,
                            [name]: value,
                            ...(name === 'action' ? { value: '' } : {}),
                          },
                        }
                      : null,
                  )
                }
              />
              <div className="shipping-row-actions">
                <Button type="submit" loading={saving}>
                  Salvar
                </Button>
                <Button variant="white" onClick={() => setEditor(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
