-- T-002 · Negação por padrão (R3.1).
-- Os papéis anon e authenticated NÃO acessam nenhuma tabela, sequência ou função de public.
-- Todo acesso passa pela API (Worker), que usa service_role. Nenhuma policy é criada de propósito:
-- com RLS ativo e sem policy, até um GRANT esquecido continua sem devolver linhas.

-- 1. RLS em todas as tabelas de public (inclusive as criadas antes desta migration).
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

-- 2. Revoga os privilégios que o Supabase concede por padrão em public.
revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;

-- 3. O mesmo para objetos criados no futuro pelo dono das migrations.
alter default privileges in schema public revoke all on tables from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- 4. A API (service_role) mantém acesso. No Supabase, service_role ignora RLS (BYPASSRLS).
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
