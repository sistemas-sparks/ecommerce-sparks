import { Suspense } from 'react';
import { ReportPanel } from './panel';

export default function ReportsPage() {
  return (
    <Suspense fallback={<p role="status">Carregando o relatório…</p>}>
      <ReportPanel />
    </Suspense>
  );
}
