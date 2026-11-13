import type {
  HybridShippingConfig,
  ShippingAdminData,
  ShippingConfig,
  ShippingHybridData,
} from '@sparks/shared';

export function toShippingConfig(data: ShippingAdminData): ShippingConfig {
  const size = (name: 'P' | 'M' | 'G') => {
    const row = data.package_sizes.find((row) => row.size === name);
    if (!row) throw new Error('shipping_package_size_missing');
    return {
      weightG: row.weight_g,
      lengthCm: row.length_cm,
      widthCm: row.width_cm,
      heightCm: row.height_cm,
    };
  };
  return {
    ufCepRanges: data.uf_ranges.map((row) => ({
      uf: row.uf,
      cepStart: row.cep_start,
      cepEnd: row.cep_end,
    })),
    zones: data.zones.map((row) => ({
      id: row.id,
      name: row.name,
      ufs: row.ufs,
      active: row.active,
    })),
    rates: data.rates.map((row) => ({
      zoneId: row.zone_id,
      service: row.service,
      maxWeightG: row.max_weight_g,
      priceCents: row.price_cents,
      daysMin: row.days_min,
      daysMax: row.days_max,
    })),
    localRules: data.local_rules.map((row) => ({
      label: row.label,
      cepStart: row.cep_start,
      cepEnd: row.cep_end,
      priceCents: row.price_cents,
      daysMin: row.days_min,
      daysMax: row.days_max,
      active: row.active,
    })),
    exceptions: data.exceptions.map((row) => ({
      cepStart: row.cep_start,
      cepEnd: row.cep_end,
      action: row.action,
      value: row.value,
    })),
    packageSizes: { P: size('P'), M: size('M'), G: size('G') },
    settings: {
      handlingDays: data.settings.handling_days,
      freeShippingMinCents: data.settings.free_shipping_min_cents,
      maxItemsAutoShipping: data.settings.max_items_auto_shipping,
      maxWeightAutoG: data.settings.max_weight_auto_g,
      packageTareG: data.settings.package_tare_g,
      cubicDivisor: null,
    },
  };
}

export function toHybridShippingConfig(data: ShippingHybridData): HybridShippingConfig {
  const size = (name: 'P' | 'M' | 'G') => {
    const row = data.package_sizes.find((row) => row.size === name);
    if (!row) throw new Error('shipping_package_size_missing');
    return {
      weightG: row.weight_g,
      lengthCm: row.length_cm,
      widthCm: row.width_cm,
      heightCm: row.height_cm,
    };
  };
  const { settings } = data;
  return {
    exceptions: data.exceptions.map((row) => ({
      cepStart: row.cep_start,
      cepEnd: row.cep_end,
      action: row.action,
      value: row.value,
    })),
    packageSizes: { P: size('P'), M: size('M'), G: size('G') },
    settings: {
      handlingDays: settings.handling_days,
      freeShippingMinCents: settings.free_shipping_min_cents,
      maxItemsAutoShipping: settings.max_items_auto_shipping,
      maxWeightAutoG: settings.max_weight_auto_g,
      packageTareG: settings.package_tare_g,
      cubicDivisor: null,
    },
    ownTypes: data.own_types.map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      sortOrder: row.sort_order,
    })),
    ownAreas: data.own_areas.map((row) => ({
      id: row.id,
      typeId: row.type_id,
      label: row.label,
      cepStart: row.cep_start,
      cepEnd: row.cep_end,
      priceCents: row.price_cents,
      daysMin: row.days_min,
      daysMax: row.days_max,
      active: row.active,
    })),
    melhorEnvio: {
      // Sem CEP de origem não há como cotar no Melhor Envio.
      originCep: settings.origin_cep ?? '',
      enabledServiceIds:
        settings.origin_cep === null
          ? []
          : data.melhor_envio_services.filter((row) => row.enabled).map((row) => row.service_id),
      marginCents: settings.melhor_envio_margin_cents,
    },
  };
}
