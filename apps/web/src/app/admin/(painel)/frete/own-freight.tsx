'use client';

import { useState } from 'react';
import {
  ownAreaInputSchema,
  ownTypeInputSchema,
  type ShippingHybridAdminData,
} from '@sparks/shared';
import { Button } from '@/ui';
import {
  FormFields,
  displayValue,
  errorMessage,
  formValues,
  payload,
  type Field,
  type Values,
} from './fields';

export type Mutate = (path: string, method: string, body?: unknown) => Promise<boolean>;

const TYPE_FIELDS: Field[] = [
  { name: 'name', label: 'Nome do frete', type: 'text' },
  { name: 'sort_order', label: 'Ordem na lista', type: 'integer' },
  { name: 'active', label: 'Frete ativo', type: 'boolean' },
];
const AREA_FIELDS: Field[] = [
  { name: 'label', label: 'Nome da área (opcional)', type: 'text', allowEmpty: true },
  { name: 'cep_start', label: 'CEP inicial', type: 'cep' },
  { name: 'cep_end', label: 'CEP final', type: 'cep' },
  { name: 'price_cents', label: 'Preço (R$)', type: 'money' },
  { name: 'days_min', label: 'Prazo mínimo (dias, 0 = mesmo dia)', type: 'integer' },
  { name: 'days_max', label: 'Prazo máximo (dias, 0 = mesmo dia)', type: 'integer' },
  { name: 'active', label: 'Área ativa', type: 'boolean' },
];

type OwnType = ShippingHybridAdminData['own_types'][number];
type OwnArea = ShippingHybridAdminData['own_areas'][number];
type Editor =
  | { kind: 'type'; id: string | null; values: Values }
  | { kind: 'area'; typeId: string; id: string | null; values: Values };

function deadline(area: OwnArea): string {
  const unit = (n: number) => (n === 0 ? 'mesmo dia' : `${n} ${n === 1 ? 'dia' : 'dias'}`);
  return area.days_min === area.days_max
    ? unit(area.days_min)
    : `${area.days_min} a ${area.days_max} dias`;
}

export function OwnFreight({
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
  const [editor, setEditor] = useState<Editor | null>(null);

  async function save() {
    if (!editor) return;
    try {
      if (editor.kind === 'type') {
        const body = ownTypeInputSchema.parse(payload(TYPE_FIELDS, editor.values));
        const path = `/admin/shipping/own-types${editor.id ? `/${editor.id}` : ''}`;
        if (await mutate(path, editor.id ? 'PATCH' : 'POST', body)) setEditor(null);
      } else {
        const body = ownAreaInputSchema.parse({
          ...payload(AREA_FIELDS, editor.values),
          type_id: editor.typeId,
        });
        const path = `/admin/shipping/own-areas${editor.id ? `/${editor.id}` : ''}`;
        if (await mutate(path, editor.id ? 'PATCH' : 'POST', body)) setEditor(null);
      }
    } catch (err) {
      onError(
        errorMessage(err, 'Confira os campos, os CEPs (inicial até final), o preço e os prazos.'),
      );
    }
  }

  function renderEditor(title: string) {
    if (!editor) return null;
    return (
      <form
        className="shipping-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3>{title}</h3>
        <FormFields
          fields={editor.kind === 'type' ? TYPE_FIELDS : AREA_FIELDS}
          values={editor.values}
          onChange={(name, value) =>
            setEditor((current) =>
              current ? { ...current, values: { ...current.values, [name]: value } } : null,
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
    );
  }

  const types = [...data.own_types].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'pt-BR'),
  );
  const editingNewType = editor?.kind === 'type' && editor.id === null;

  return (
    <section>
      <div className="shipping-section-heading">
        <h2>Fretes próprios</h2>
        <Button
          variant="white"
          onClick={() =>
            setEditor({
              kind: 'type',
              id: null,
              values: formValues(TYPE_FIELDS, { active: true, sort_order: types.length }),
            })
          }
        >
          Adicionar frete
        </Button>
      </div>
      <p>
        Cada frete próprio (por exemplo, uma entrega rápida) tem suas áreas por faixa de CEP. Vale a
        área mais específica que contém o CEP do cliente. Não há geolocalização: um raio de entrega
        é montado com faixas de CEP.
      </p>
      {editingNewType && renderEditor('Novo frete próprio')}
      {types.length === 0 && !editingNewType ? (
        <p>Nenhum frete próprio cadastrado.</p>
      ) : (
        <ul className="shipping-rows">
          {types.map((type: OwnType) => {
            const areas = data.own_areas.filter((area) => area.type_id === type.id);
            const editingType = editor?.kind === 'type' && editor.id === type.id;
            const editingArea = editor?.kind === 'area' && editor.typeId === type.id;
            return (
              <li key={type.id}>
                <div className="shipping-type-head">
                  <h3>{type.name}</h3>
                  <p>
                    {type.active ? 'Ativo' : 'Inativo'} · ordem {type.sort_order}
                  </p>
                </div>
                <div className="shipping-row-actions">
                  <Button
                    variant="white"
                    onClick={() =>
                      setEditor({
                        kind: 'type',
                        id: type.id,
                        values: formValues(TYPE_FIELDS, type),
                      })
                    }
                  >
                    Editar frete
                  </Button>
                  <Button
                    variant="white"
                    disabled={saving}
                    onClick={() => {
                      if (window.confirm('Excluir este frete e todas as áreas dele?'))
                        void mutate(`/admin/shipping/own-types/${type.id}`, 'DELETE');
                    }}
                  >
                    Excluir frete
                  </Button>
                </div>
                {editingType && renderEditor('Editar frete próprio')}
                {areas.length === 0 ? (
                  <p>Nenhuma área neste frete.</p>
                ) : (
                  <ul className="shipping-areas">
                    {areas.map((area) => (
                      <li key={area.id}>
                        <dl>
                          {AREA_FIELDS.filter(
                            (f) => f.name !== 'days_min' && f.name !== 'days_max',
                          ).map((field) => (
                            <div key={field.name}>
                              <dt>{field.label.replace(' (opcional)', '')}</dt>
                              <dd>{displayValue(field, area)}</dd>
                            </div>
                          ))}
                          <div>
                            <dt>Prazo</dt>
                            <dd>{deadline(area)}</dd>
                          </div>
                        </dl>
                        <div className="shipping-row-actions">
                          <Button
                            variant="white"
                            onClick={() =>
                              setEditor({
                                kind: 'area',
                                typeId: type.id,
                                id: area.id,
                                values: formValues(AREA_FIELDS, area),
                              })
                            }
                          >
                            Editar área
                          </Button>
                          <Button
                            variant="white"
                            disabled={saving}
                            onClick={() => {
                              if (window.confirm('Excluir esta área?'))
                                void mutate(`/admin/shipping/own-areas/${area.id}`, 'DELETE');
                            }}
                          >
                            Excluir área
                          </Button>
                        </div>
                        {editor?.kind === 'area' &&
                          editor.id === area.id &&
                          renderEditor('Editar área')}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="shipping-row-actions">
                  <Button
                    variant="white"
                    onClick={() =>
                      setEditor({
                        kind: 'area',
                        typeId: type.id,
                        id: null,
                        values: formValues(AREA_FIELDS, { active: true, days_min: 0, days_max: 0 }),
                      })
                    }
                  >
                    Adicionar área
                  </Button>
                </div>
                {editingArea && editor?.id === null && renderEditor('Nova área')}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
