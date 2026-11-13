import { createApp } from './app';
import { runScheduled } from './cron/scheduled';
import type { Bindings } from './env';

// Ponto de entrada do Worker: requisições HTTP (app.ts) e tarefas agendadas (cron/scheduled.ts).
const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Bindings>;
