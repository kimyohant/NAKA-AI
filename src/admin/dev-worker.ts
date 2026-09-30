// Local integration entry only: npm run dev -- src/admin/dev-worker.ts
// Production still uses src/index.ts; the owner will mount the handler there during merge.
import app from '../index';
import type { Env } from '../types';
import { handleAdminCustomers } from './customers';

export default {
  async fetch(request: Request<unknown, IncomingRequestCfProperties>, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await handleAdminCustomers(request, env, new URL(request.url)) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
