#!/usr/bin/env bash
# Testa a trava de segurança do test-restore.sh (C-3, T-036) com psql, pg_restore, age e sha256sum
# SIMULADOS (nenhum banco real é tocado). Uso: scripts/backup/test-restore.guard-test.sh
# Cada tentativa de burla deve terminar com código 3 e sem NENHUMA chamada ao psql/pg_restore falso.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/test-restore.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
log="$tmp/chamadas.log"

cat > "$tmp/bin/psql" <<'FAKE'
#!/usr/bin/env bash
echo "psql PGHOST=${PGHOST-} PGPORT=${PGPORT-} PGUSER=${PGUSER-} PGDATABASE=${PGDATABASE-} PGHOSTADDR=${PGHOSTADDR-} PGSERVICE=${PGSERVICE-} args=$*" >> "$FAKE_LOG"
case "$*" in
  *current_database*) echo "${FAKE_IDENT:-x_restore_test|}" ;;
  *information_schema*) echo 0 ;;
  *"tablename = "*) echo 1 ;;
esac
exit 0
FAKE
cat > "$tmp/bin/pg_restore" <<'FAKE'
#!/usr/bin/env bash
echo "pg_restore PGHOST=${PGHOST-} PGDATABASE=${PGDATABASE-} args=$*" >> "$FAKE_LOG"
exit 0
FAKE
cat > "$tmp/bin/age" <<'FAKE'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do [ "$1" = "--output" ] && : > "$2"; shift; done
exit 0
FAKE
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/sha256sum"
chmod +x "$tmp/bin/"*
: > "$tmp/b.dump.age"; : > "$tmp/chave.txt"

export FAKE_LOG="$log"
fail=0
run() { # $1 = url, $2 = FAKE_IDENT (opcional); imprime o código de saída
  : > "$log"
  PATH="$tmp/bin:$PATH" FAKE_IDENT="${2:-x_restore_test|}" bash "$script" "$tmp/b.dump.age" "$tmp/chave.txt" "$1" >"$tmp/saida.txt" 2>&1
  echo $?
}
espera_recusa() { # $1 = descrição, $2 = url, $3 = ident falso (opcional), $4 = "conectou" se o psql pode ter sido chamado só para identificar
  local code; code="$(run "$2" "${3:-}")"
  local writes; writes="$(grep -c -E 'pg_restore|-f ' "$log" || true)"
  local conns; conns="$(grep -c '^psql' "$log" || true)"
  if [ "$code" = "3" ] && [ "$writes" = "0" ] && { [ "${4:-}" = "conectou" ] || [ "$conns" = "0" ]; }; then
    echo "ok    recusou: $1"
  else
    echo "FALHA $1 (código=$code, escritas=$writes, conexões=$conns)"; fail=1
  fi
}

espera_recusa "?host= apontando para a produção" 'postgresql://postgres@localhost:5432/x_restore_test?host=db.abc.supabase.co'
espera_recusa "?dbname=postgres" 'postgresql://postgres@localhost:5432/x_restore_test?dbname=postgres'
espera_recusa "?hostaddr=" 'postgresql://postgres@localhost:5432/x_restore_test?hostaddr=203.0.113.9'
espera_recusa "?service=" 'postgresql://postgres@localhost/x_restore_test?service=prod'
espera_recusa "?options=" 'postgresql://postgres@localhost/x_restore_test?options=-csearch_path%3Dx'
espera_recusa "vários hosts (vírgula)" 'postgresql://localhost:5432,db.abc.supabase.co:5432/x_restore_test'
espera_recusa "vários hosts com @" 'postgresql://postgres@localhost,db.abc.supabase.co/x_restore_test'
espera_recusa "dois @ (host escondido no usuário)" 'postgresql://postgres@db.abc.supabase.co@localhost/x_restore_test'
espera_recusa "senha na URL" 'postgresql://postgres:segredo@localhost/x_restore_test'
espera_recusa "host remoto" 'postgresql://postgres@db.abc.supabase.co:5432/x_restore_test'
espera_recusa "host remoto que começa com localhost" 'postgresql://postgres@localhost.evil.com/x_restore_test'
espera_recusa "banco sem restore_test" 'postgresql://postgres@localhost:5432/postgres'
espera_recusa "banco com sufixo falso" 'postgresql://postgres@localhost:5432/postgres_restore_test_x'
espera_recusa "fragmento #" 'postgresql://postgres@localhost/x_restore_test#a'
espera_recusa "codificação %" 'postgresql://postgres@localhost/x_restore%5Ftest'
espera_recusa "dbname em formato de conninfo" 'postgresql://postgres@localhost/host=prod_restore_test'
espera_recusa "caminho com barras extras" 'postgresql://postgres@localhost/a/x_restore_test'
espera_recusa "sem banco" 'postgresql://postgres@localhost:5432'
espera_recusa "esquema errado" 'host=localhost dbname=x_restore_test'
espera_recusa "conninfo com espaço" 'postgresql://postgres@localhost/x_restore_test host=prod'
espera_recusa "quebra de linha" $'postgresql://postgres@localhost/x_restore_test\nhost=prod'
# Depois de conectar: o servidor real não é o esperado (só o psql de identificação pode ter rodado).
espera_recusa "conectou em outro banco" 'postgresql://postgres@localhost/x_restore_test' 'postgres|' conectou
espera_recusa "servidor com IP não loopback" 'postgresql://postgres@localhost/x_restore_test' 'x_restore_test|203.0.113.9' conectou

# Variáveis PG* do ambiente não podem redirecionar a conexão.
: > "$log"
PATH="$tmp/bin:$PATH" PGHOST=db.abc.supabase.co PGHOSTADDR=203.0.113.9 PGSERVICE=prod PGDATABASE=postgres \
  bash "$script" "$tmp/b.dump.age" "$tmp/chave.txt" 'postgresql://postgres@localhost:5432/x_restore_test' >"$tmp/saida.txt" 2>&1
code=$?
if [ "$code" = "0" ] && ! grep -q 'db.abc.supabase.co\|203.0.113.9\|PGSERVICE=prod\|PGDATABASE=postgres ' "$log" \
   && grep -q 'PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=x_restore_test PGHOSTADDR= PGSERVICE=' "$log"; then
  echo "ok    PG* do ambiente ignoradas; conexão só em localhost/x_restore_test"
else
  echo "FALHA PG* do ambiente (código=$code)"; fail=1; tail -5 "$tmp/saida.txt"
fi

# Casos legítimos continuam passando.
for u in 'postgresql://postgres@localhost:5432/sparks_restore_test' 'postgres://postgres@127.0.0.1/x_restore_test' 'postgresql://postgres@[::1]:5433/x_restore_test' 'postgresql://localhost/restore_test'; do
  code="$(run "$u" "x_restore_test|127.0.0.1")"
  if [ "$code" = "0" ] && grep -q '^pg_restore' "$log"; then echo "ok    aceitou: $u"; else echo "FALHA legítimo recusado: $u (código=$code)"; fail=1; tail -3 "$tmp/saida.txt"; fi
done

[ "$fail" = "0" ] && echo "TRAVA OK" || { echo "TRAVA COM FALHAS" >&2; exit 1; }
