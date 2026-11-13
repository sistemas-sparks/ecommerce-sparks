-- T-002 · Dados iniciais (docs/frete.md). Só estrutura e valores de exemplo do próprio frete.md.
-- NÃO inclui dados da cliente: tarifas, regras locais, WhatsApp, CEP de origem e frete grátis
-- ficam vazios até ela informar (ver "Pendências" em docs/memoria.md).

-- Faixas de CEP por UF (frete.md §6 — conferir com a tabela oficial dos Correios).
insert into public.uf_cep_ranges (uf, cep_start, cep_end) values
  ('SP', '01000000', '19999999'),
  ('RJ', '20000000', '28999999'),
  ('ES', '29000000', '29999999'),
  ('MG', '30000000', '39999999'),
  ('BA', '40000000', '48999999'),
  ('SE', '49000000', '49999999'),
  ('PE', '50000000', '56999999'),
  ('AL', '57000000', '57999999'),
  ('PB', '58000000', '58999999'),
  ('RN', '59000000', '59999999'),
  ('CE', '60000000', '63999999'),
  ('PI', '64000000', '64999999'),
  ('MA', '65000000', '65999999'),
  ('PA', '66000000', '68899999'),
  ('AP', '68900000', '68999999'),
  ('AM', '69000000', '69299999'),
  ('AM', '69400000', '69899999'),
  ('RR', '69300000', '69399999'),
  ('AC', '69900000', '69999999'),
  ('DF', '70000000', '72799999'),
  ('DF', '73000000', '73699999'),
  ('GO', '72800000', '72999999'),
  ('GO', '73700000', '76799999'),
  ('RO', '76800000', '76999999'),
  ('TO', '77000000', '77999999'),
  ('MT', '78000000', '78899999'),
  ('MS', '79000000', '79999999'),
  ('PR', '80000000', '87999999'),
  ('SC', '88000000', '89999999'),
  ('RS', '90000000', '99999999');

-- Zonas sugeridas (frete.md §5 — origem provável Sergipe, confirmar).
insert into public.shipping_zones (name, ufs) values
  ('Z1 Mesmo estado', '{SE}'),
  ('Z2 Nordeste próximo', '{AL,BA,PE,PB,RN}'),
  ('Z3 Nordeste demais', '{CE,PI,MA}'),
  ('Z4 Sudeste e Centro-Oeste', '{SP,RJ,ES,MG,DF,GO,MT,MS}'),
  ('Z5 Sul', '{PR,SC,RS}'),
  ('Z6 Norte', '{PA,AP,AM,RR,AC,RO,TO}');

-- Tamanhos padrão (frete.md §3 — valores de exemplo, editáveis no painel).
insert into public.package_sizes (size, weight_g, length_cm, width_cm, height_cm) values
  ('P', 100, 16, 11, 4),
  ('M', 400, 30, 22, 5),
  ('G', 1000, 35, 25, 12);

-- Configurações: linha única, campos da cliente vazios.
insert into public.settings (id) values (1);
