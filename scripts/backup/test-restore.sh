#!/usr/bin/env bash
# Teste de restauração do backup noturno (T-023). ESCRITO E NÃO EXECUTADO: precisa de um backup
# real (T-031) e da chave privada age, que fica com o Rafael (nunca no repositório).
#
# Restaura o arquivo .dump.age num Postgres LOCAL e descartável, nunca no Supabase de verdade,
# e confere: tabelas esperadas, RLS ligado em todas e contagem de linhas.
#
# Uso:
#   scripts/backup/test-restore.sh <arquivo.dump.age> <chave-privada-age.txt> [<url-postgres-local>]
# A URL padrão é postgresql://postgres@localhost:5432/sparks_restore_test. Exige psql, pg_restore
# (cliente 17) e age no PATH. A senha, se houver, vai em PGPASSWORD (variável de ambiente), nunca na URL.
# A URL aceita só usuario@localhost|127.0.0.1|[::1][:porta]/nome_restore_test, sem ? nem vírgulas.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

backup="$1"
identity="$2"
url="${3:-postgresql://postgres@localhost:5432/sparks_restore_test}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
stub="$repo_root/supabase/tests/supabase-stub.sql"

for tool in psql pg_restore age sha256sum; do
  command -v "$tool" >/dev/null || { echo "Falta o programa '$tool' no PATH." >&2; exit 2; }
done
[ -f "$backup" ] || { echo "Backup não encontrado: $backup" >&2; exit 2; }
[ -f "$identity" ] || { echo "Chave privada não encontrada: $identity" >&2; exit 2; }
[ -f "$stub" ] || { echo "Não achei $stub (rode de dentro do repositório)." >&2; exit 2; }

# Trava de segurança (C-3 da revisão T-036): só restaura em banco local cujo nome termina em
# restore_test. A URL NÃO é repassada à libpq: ela é lida aqui, validada e decomposta nas variáveis
# PGHOST/PGPORT/PGUSER/PGDATABASE; psql e pg_restore usam só essas variáveis. Assim, parâmetros da
# URL (?host=, ?hostaddr=, ?dbname=, ?service=, ?options=) e listas de hosts (a,b) nunca valem.
refuse() { echo "RECUSADO: $1" >&2; exit 3; }

case "$url" in
  postgresql://*|postgres://*) ;;
  *) refuse "a URL deve começar com postgresql:// ou postgres://." ;;
esac
rest="${url#*://}"
# Lista de permitidos (não de proibidos): só letras, números e _ . : @ / [ ] -. Isso barra ? (query
# string: ?host=, ?hostaddr=, ?dbname=, ?service=, ?options=), vírgula (vários hosts), #, %, ;, espaço,
# aspas, barra invertida e quebra de linha, que a libpq reinterpretaria.
allowed='^[]A-Za-z0-9_.:@/[-]+$'
[[ "$rest" =~ $allowed ]] \
  || refuse "a URL só pode ter letras, números e _ . : @ / [ ] - (sem ?, vírgula, espaço, % nem parâmetros)."
case "$rest" in
  */*/*) refuse "a URL tem barras demais depois do host." ;;
  */*) ;;
  *) refuse "a URL precisa informar o banco: postgresql://usuario@localhost:5432/nome_restore_test." ;;
esac
authority="${rest%%/*}"
dbname="${rest#*/}"
case "$authority" in
  *@*@*) refuse "a URL tem mais de um @." ;;
  *@*) user="${authority%@*}"; hostport="${authority#*@}" ;;
  *) user="postgres"; hostport="$authority" ;;
esac
[[ "$user" =~ ^[A-Za-z0-9_.-]+$ ]]   || refuse "usuário inválido na URL (sem senha na URL; use PGPASSWORD)."
if [[ "$hostport" =~ ^\[([0-9A-Fa-f:]+)\](:([0-9]{1,5}))?$ ]]; then
  host="${BASH_REMATCH[1]}"; port="${BASH_REMATCH[3]:-5432}"
elif [[ "$hostport" =~ ^([A-Za-z0-9.-]+)(:([0-9]{1,5}))?$ ]]; then
  host="${BASH_REMATCH[1]}"; port="${BASH_REMATCH[3]:-5432}"
else
  refuse "host/porta inválidos na URL: $hostport"
fi
case "$host" in
  localhost|127.0.0.1|::1) ;;
  *) refuse "o destino deve ser local (localhost, 127.0.0.1 ou ::1). Recebi: $host" ;;
esac
[[ "$dbname" =~ ^[A-Za-z0-9_]*restore_test$ ]]   || refuse "o nome do banco deve terminar em 'restore_test' (só letras, números e _). Recebi: $dbname"

# Variáveis PG* herdadas do ambiente podem redirecionar a conexão: limpe tudo e fixe as nossas.
for v in $(compgen -e | grep '^PG' || true); do
  [ "$v" = "PGPASSWORD" ] || unset "$v"
done
export PGHOST="$host" PGPORT="$port" PGUSER="$user" PGDATABASE="$dbname" PGSSLMODE=prefer
unset url

# Confere o destino de verdade, depois de conectar, antes de qualquer escrita (inclusive o stub e o
# pg_restore): banco com o nome esperado e endereço do servidor nulo (socket) ou loopback.
ident="$(psql -X -Atqc "select current_database() || '|' || coalesce(host(inet_server_addr()), '')")"   || { echo "Não consegui conectar em $host/$dbname. Crie o banco vazio antes (createdb $dbname)." >&2; exit 4; }
conn_db="${ident%%|*}"
conn_addr="${ident#*|}"
case "$conn_db" in
  *restore_test) ;;
  *) refuse "conectei no banco '$conn_db', que não termina em restore_test. Nada foi alterado." ;;
esac
case "$conn_addr" in
  ""|127.0.0.1|::1) ;;
  *) refuse "o servidor respondeu do endereço $conn_addr, que não é loopback. Nada foi alterado." ;;
esac

# O destino precisa estar vazio, para nunca misturar com outro dado.
existing="$(psql -X -Atqc "select count(*) from information_schema.tables where table_schema = 'public'")"
[ "$existing" = "0" ] || refuse "o banco $dbname já tem $existing tabela(s) em public. Use um banco vazio."

work="$(mktemp -d)"
trap 'shred -u "$work"/*.dump 2>/dev/null || true; rm -rf "$work"' EXIT
umask 077

if [ -f "$backup.sha256" ]; then
  echo "== Conferindo o checksum"
  (cd "$(dirname "$backup")" && sha256sum -c "$(basename "$backup").sha256")
else
  echo "AVISO: sem arquivo .sha256 ao lado do backup; checksum não conferido."
fi

echo "== Descriptografando"
age --decrypt --identity "$identity" --output "$work/restore.dump" "$backup"
pg_restore --list "$work/restore.dump" >/dev/null

echo "== Preparando o destino (papéis e auth simulados do Supabase)"
psql -X -v ON_ERROR_STOP=1 -q -f "$stub"

echo "== Restaurando o schema public"
pg_restore --dbname="$dbname" --no-owner --no-privileges --exit-on-error "$work/restore.dump"

echo "== Conferências"
fail=0

for table in profiles categories products product_images orders order_items order_events \
  payment_events coupons coupon_redemptions settings audit_log; do
  found="$(psql -X -Atqc "select count(*) from pg_tables where schemaname = 'public' and tablename = '$table'")"
  if [ "$found" = "1" ]; then echo "  ok    tabela $table"; else echo "  FALTA tabela $table"; fail=1; fi
done

no_rls="$(psql -X -Atqc "select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")"
if [ -z "$no_rls" ]; then echo "  ok    RLS ligado em todas as tabelas"; else echo "  FALHA RLS desligado em: $no_rls"; fail=1; fi

echo "  Linhas por tabela (confira com o esperado do dia do backup):"
psql -X -Atq -F ' | ' -c "
  select tablename,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text
  from pg_tables where schemaname = 'public' order by tablename"

if [ "$fail" -ne 0 ]; then
  echo "TESTE DE RESTAURAÇÃO FALHOU." >&2
  exit 1
fi
echo "TESTE DE RESTAURAÇÃO OK. Apague o banco $dbname quando terminar (dropdb $dbname) e registre a data em docs/backup.md."
