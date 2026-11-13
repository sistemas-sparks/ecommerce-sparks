# Backup noturno e teste de restauração

Escrito na T-023. **Nada aqui foi executado**: depende do GitHub e do Supabase reais (T-031). Complementa `arquitetura.md` §11 e `seguranca.md` (P0).

## O que é copiado e o que não é
- **Copiado:** o schema `public` do Postgres do Supabase (pedidos, itens, catálogo, cupons, frete, configurações, `audit_log`), em formato `pg_dump` custom, criptografado com `age` antes de sair do job.
- **Não copiado:** usuários do Supabase Auth (a lojista e clientes com Google; recriar o admin à mão com `app_metadata.role = admin` e cadastrar o TOTP de novo) e os arquivos do Storage (fotos). As fotos ficam com os originais da lojista; se a cliente quiser cópia delas, é outra tarefa ([A DEFINIR]).

## Como funciona (`.github/workflows/backup.yml`)
1. Todo dia às 02:17 (Brasília) e sob demanda (`Run workflow`).
2. `pg_dump` 17 (mesma versão do Supabase) com a URL de `SUPABASE_DB_URL`.
3. Confere que o dump é legível (`pg_restore --list`) e tem as tabelas principais; senão o backup é descartado e o job falha.
4. Criptografa com a chave **pública** `BACKUP_AGE_RECIPIENT`, apaga o arquivo sem criptografia e guarda só o `.dump.age` (e o `.sha256`) como artefato por 30 dias.
5. Falha do job gera e-mail do GitHub ao dono do repositório.

## Preparação (T-031, com as contas criadas)
1. O Rafael gera o par de chaves **fora do repositório**: `age-keygen -o chave-privada-backup.txt`. A linha `# public key: age1...` é a chave pública.
2. Guardar a chave privada em gerenciador de senhas (e uma cópia para a cliente na entrega). **Sem ela o backup não abre; com ela qualquer pessoa abre.**
3. No GitHub (repositório **privado**): segredos `SUPABASE_DB_URL` (conexão do Supabase; ideal um papel só de leitura) e `BACKUP_AGE_RECIPIENT` (chave pública).
4. Trocar `actions/upload-artifact@v4` pelo SHA do commit, como em `ci.yml`.
5. Rodar o workflow à mão uma vez e conferir o artefato.

Limites dos planos gratuitos: artefatos têm retenção própria (30 dias aqui) e contam na cota de armazenamento do GitHub; o GitHub pode desligar agendamentos de repositório parado depois de 60 dias sem atividade, então confira de tempos em tempos.

## Teste de restauração (`scripts/backup/test-restore.sh`)
Baixe o artefato, crie um Postgres local vazio e rode:

```bash
createdb -h localhost -U postgres sparks_restore_test
scripts/backup/test-restore.sh sparks-db-AAAAMMDD-HHMM.dump.age chave-privada-backup.txt
dropdb -h localhost -U postgres sparks_restore_test
```

A trava de destino (C-3 da revisão T-036) não repassa a URL ao `psql`/`pg_restore`: ela só aceita `postgresql://usuario@localhost|127.0.0.1|[::1][:porta]/nome_restore_test`, recusa qualquer `?` (como `?host=`, `?hostaddr=`, `?dbname=`, `?service=`), vírgula (vários hosts), senha na URL, `%`, espaço e quebra de linha, descarta as variáveis `PG*` do ambiente (exceto `PGPASSWORD`) e usa só `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE` decompostas. Depois de conectar e antes de qualquer escrita, confere `current_database()` (termina em `restore_test`) e o endereço do servidor (socket ou loopback). A senha vai em `PGPASSWORD`. Para testar a trava sem banco, rode `scripts/backup/test-restore.guard-test.sh` (psql, pg_restore e age simulados; cobre 28 casos).

O script recusa qualquer destino que não seja `localhost` com banco vazio cujo nome termine em `restore_test`, confere o checksum, descriptografa, restaura e verifica as tabelas esperadas, o RLS ligado em todas e a contagem de linhas. Exige `psql`, `pg_restore` 17 e `age`.

- **Antes de publicar:** fazer um teste real e anotar a data aqui. Depois, mensal (`arquitetura.md` §11).
- Último teste de restauração: **nunca executado**.
