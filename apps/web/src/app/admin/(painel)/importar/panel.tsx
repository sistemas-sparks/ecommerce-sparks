'use client';

import { type ChangeEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { productCsvErrorsToCsv, type ProductCsvReport } from '@sparks/shared';
import { ApiError } from '@/lib/api';
import { Button, ButtonLink } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { fetchProductCsvTemplate, sendProductCsv, type ImportSummary } from './import-api';
import {
  MAX_FILE_LABEL,
  PRODUCT_IMPORT_MAX_ERRORS,
  PRODUCT_IMPORT_MAX_ROWS,
  checkImportFile,
  formatSize,
  groupErrorsByLine,
  lineLabel,
  plural,
} from './import-logic';
import './import.css';

type Outcome =
  | { kind: 'none' }
  | { kind: 'busy'; action: 'simulate' | 'import' }
  | { kind: 'valid'; report: ProductCsvReport }
  | { kind: 'invalid'; report: ProductCsvReport }
  | { kind: 'imported'; report: ProductCsvReport; summary: ImportSummary };

const IDLE: Outcome = { kind: 'none' };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function ImportPanel() {
  const { getAccessToken } = useAdmin();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  const [error, setError] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const busy = outcome.kind === 'busy';
  const simulatedOk = outcome.kind === 'valid';
  const canSimulate = file !== null && !busy && outcome.kind !== 'imported';

  // Depois de simular ou importar, leva o foco ao resultado (leitor de tela e teclado).
  const resultKind = outcome.kind;
  useEffect(() => {
    if (resultKind === 'valid' || resultKind === 'invalid' || resultKind === 'imported')
      resultRef.current?.focus();
  }, [resultKind]);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setOutcome(IDLE);
    setError('');
    const problem = picked ? checkImportFile(picked) : null;
    setFileError(problem ?? '');
    setFile(picked && !problem ? picked : null);
  }

  async function downloadTemplate() {
    setTemplateBusy(true);
    setError('');
    try {
      saveBlob(
        await fetchProductCsvTemplate(await getAccessToken()),
        'modelo-importacao-produtos.csv',
      );
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível baixar o modelo.'));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setError('');
    setOutcome({ kind: 'busy', action: dryRun ? 'simulate' : 'import' });
    try {
      setOutcome(await sendProductCsv(file, await getAccessToken(), { dryRun }));
    } catch (err) {
      // Falha de rede ou de servidor: a simulação anterior (se houver) deixa de valer.
      setOutcome(IDLE);
      setError(
        errorMessage(
          err,
          dryRun ? 'Não foi possível simular a importação.' : 'Não foi possível importar.',
        ),
      );
    }
  }

  function reset() {
    setFile(null);
    setFileError('');
    setOutcome(IDLE);
    setError('');
    setInputKey((key) => key + 1);
  }

  function downloadErrors(report: ProductCsvReport) {
    saveBlob(
      new Blob([productCsvErrorsToCsv(report.errors)], { type: 'text/csv;charset=utf-8' }),
      'erros-importacao.csv',
    );
  }

  return (
    <div className="import-panel">
      <h1>Importar produtos</h1>
      <p className="import-lead">
        Cadastre vários produtos de uma vez com uma planilha. Antes de gravar, o sistema confere o
        arquivo inteiro e mostra o que precisa ser corrigido.
      </p>

      <section aria-labelledby="import-step-1">
        <h2 id="import-step-1">1. Baixe o modelo</h2>
        <p>
          O modelo traz todas as colunas, com dois exemplos que você pode apagar. São obrigatórias
          só <strong>slug</strong>, <strong>nome</strong> e <strong>preco</strong>. Salve a planilha
          como CSV (no Excel: &ldquo;CSV UTF-8&rdquo;).
        </p>
        <div className="import-actions">
          <Button variant="white" loading={templateBusy} onClick={() => void downloadTemplate()}>
            Baixar modelo (CSV)
          </Button>
        </div>
      </section>

      <section aria-labelledby="import-step-2">
        <h2 id="import-step-2">2. Escolha o arquivo e simule</h2>
        <p>
          Limite de {MAX_FILE_LABEL} e {PRODUCT_IMPORT_MAX_ROWS} produtos por arquivo. O produto é
          identificado pelo <strong>slug</strong>: se o slug já existir, o produto é atualizado; se
          não, é criado.
        </p>
        <p className="import-stock-note">
          <strong>Estoque:</strong> a coluna estoque só vale quando o produto é criado. Em produtos
          que já existem ela é ignorada, para não apagar o controle de estoque da loja. Para mudar o
          estoque de um produto existente, edite-o em Produtos.
        </p>
        <label className="import-file">
          <span>Arquivo CSV</span>
          <input
            key={inputKey}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={onPick}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? 'import-file-error' : undefined}
          />
        </label>
        {fileError && (
          <p id="import-file-error" role="alert" className="import-error">
            {fileError}
          </p>
        )}
        {file && (
          <p className="import-file-name">
            {file.name} ({formatSize(file.size)})
          </p>
        )}
        <div className="import-actions">
          <Button
            loading={outcome.kind === 'busy' && outcome.action === 'simulate'}
            disabled={!canSimulate}
            onClick={() => void run(true)}
          >
            Simular
          </Button>
          <Button
            variant="plum"
            loading={outcome.kind === 'busy' && outcome.action === 'import'}
            disabled={!simulatedOk}
            aria-describedby="import-gate"
            onClick={() => void run(false)}
          >
            Importar
          </Button>
        </div>
        <p id="import-gate" className="import-hint">
          {simulatedOk
            ? 'A simulação passou. Agora você pode importar.'
            : 'O botão Importar libera depois de uma simulação sem erros. A simulação não grava nada.'}
        </p>
      </section>

      {error && (
        <p role="alert" className="import-error import-error-block">
          {error}
        </p>
      )}

      <div className="import-result" role="status" aria-live="polite">
        {outcome.kind === 'busy' && (
          <p>
            {outcome.action === 'simulate' ? 'Conferindo o arquivo…' : 'Importando os produtos…'}
          </p>
        )}
      </div>

      {outcome.kind === 'valid' && (
        <section aria-labelledby="import-result-title">
          <h2 id="import-result-title" ref={resultRef} tabIndex={-1}>
            Simulação sem erros
          </h2>
          <p>
            {plural(outcome.report.validRows, 'produto conferido', 'produtos conferidos')}, nenhum
            erro. Nada foi gravado ainda. Clique em Importar para gravar.
          </p>
        </section>
      )}

      {outcome.kind === 'invalid' && (
        <ErrorReport
          report={outcome.report}
          headingRef={resultRef}
          onDownload={() => downloadErrors(outcome.report)}
        />
      )}

      {outcome.kind === 'imported' && (
        <section aria-labelledby="import-result-title">
          <h2 id="import-result-title" ref={resultRef} tabIndex={-1}>
            Importação concluída
          </h2>
          <dl className="import-summary">
            <div>
              <dt>Criados</dt>
              <dd>{outcome.summary.created}</dd>
            </div>
            <div>
              <dt>Atualizados</dt>
              <dd>{outcome.summary.updated}</dd>
            </div>
            <div>
              <dt>Ignorados (já estavam iguais)</dt>
              <dd>{outcome.summary.unchanged}</dd>
            </div>
          </dl>
          <p>
            O estoque do arquivo foi usado só nos produtos criados; nos atualizados o estoque ficou
            como estava.
          </p>
          <div className="import-actions">
            <ButtonLink href="/admin/produtos/" variant="plum">
              Ver produtos
            </ButtonLink>
            <Button variant="white" onClick={reset}>
              Importar outro arquivo
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ErrorReport({
  report,
  headingRef,
  onDownload,
}: {
  report: ProductCsvReport;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onDownload: () => void;
}) {
  const groups = groupErrorsByLine(report.errors);
  return (
    <section aria-labelledby="import-result-title">
      <h2 id="import-result-title" ref={headingRef} tabIndex={-1}>
        O arquivo tem erros
      </h2>
      <p className="import-error">
        {plural(report.errors.length, 'erro', 'erros')}
        {groups.length > 1 ? ` em ${plural(groups.length, 'linha', 'linhas')}` : ''}. Nada foi
        gravado. Corrija a planilha e simule de novo.
      </p>
      {report.truncated && (
        <p>
          Há mais erros do que a lista mostra (aparecem os {PRODUCT_IMPORT_MAX_ERRORS} primeiros).
          Corrija estes e simule de novo para ver os outros.
        </p>
      )}
      <ol className="import-errors">
        {groups.map((group) => (
          <li key={group.line}>
            <p className="import-line">{lineLabel(group.line)}</p>
            <ul>
              {group.problems.map((problem, index) => (
                <li key={index}>
                  {problem.column && (
                    <>
                      <span className="import-column">Coluna {problem.column}:</span>{' '}
                    </>
                  )}
                  {problem.message}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div className="import-actions">
        <Button variant="white" onClick={onDownload}>
          Baixar lista de erros (CSV)
        </Button>
      </div>
    </section>
  );
}
