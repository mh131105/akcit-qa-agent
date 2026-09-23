import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, AuthService } from '../auth.js';
import { executePlanCommand, getPlanReview, publicPlanDecisions } from '../application/plan-approval.js';
import { createRun, listRuns, RunInputError } from '../application/runs.js';
import type { readConfig } from '../config.js';
import { StorageError, type RunStore } from '../storage/runs.js';

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = () => new HttpError(400, 'INVALID_INPUT', 'Campos inválidos para esta operação.');
const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    // Mantém o socket aberto para entregar 413 mesmo quando o corpo vem em partes.
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 16 * 1024) throw new HttpError(413, 'BODY_TOO_LARGE', 'O corpo excede 16 KiB.');
      chunks.push(chunk);
    }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_JSON', 'Informe um objeto JSON válido.');
  }
}
function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw invalid();
}
function string(body: Record<string, unknown>, key: string, min: number, max: number, trim = true): string {
  const value = body[key];
  if (typeof value !== 'string') throw invalid();
  const length = [...(trim ? value.trim() : value)].length;
  if (length < min || length > max) throw invalid();
  return trim ? value.trim() : value;
}
function serviceError(error: { code: string; message: string }): never {
  if (['UNAUTHORIZED', 'RUN_NOT_FOUND'].includes(error.code)) {
    throw new HttpError(404, 'RUN_NOT_FOUND', 'Execução não encontrada.');
  }
  const status = ['STORAGE_FAILURE', 'RUN_INACCESSIBLE'].includes(error.code) ? 503
    : ['INVALID_RUN_ID', 'COMMENT_REQUIRED'].includes(error.code) ? 400 : 409;
  throw new HttpError(status, error.code, error.message);
}

/** Todas as identidades vêm da sessão; rotas só traduzem HTTP para os serviços. */
export async function handleApi(
  request: IncomingMessage, response: ServerResponse, runs: RunStore,
  auth: AuthService, config: ReturnType<typeof readConfig>,
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(request.url!, 'http://localhost');
    const path = url.pathname;
    const collection = path === '/api/runs';
    const account = /^\/api\/auth\/(register|login|logout|me)$/.exec(path)?.[1];
    const run = /^\/api\/runs\/([^/]+)(?:\/(approve|request-changes))?$/.exec(path);
    if (!account && !run && !collection) throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
    const methods = collection ? ['GET', 'POST'] : [account === 'me' || (run && !run[2]) ? 'GET' : 'POST'];
    if (!methods.includes(request.method!)) {
      response.setHeader('Allow', methods.join(', '));
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    }
    const method = request.method;
    auth.ensureConfigured();
    let body: Record<string, unknown> = {};
    if (method === 'POST') {
      if (request.headers.origin !== config.appOrigin) {
        throw new HttpError(403, 'ORIGIN_REJECTED', 'Origem não permitida.');
      }
      body = await readJson(request);
    }
    if (account === 'register' || account === 'login') {
      fields(body, account === 'register' ? ['name', 'email', 'password', 'teamName'] : ['email', 'password']);
      const credentials = { email: string(body, 'email', 3, 254), password: string(body, 'password', 15, 128, false) };
      const address = request.socket.remoteAddress ?? 'unknown';
      const result = account === 'register'
        ? await auth.register({ ...credentials, name: string(body, 'name', 1, 120),
          ...(body.teamName === undefined ? {} : { teamName: string(body, 'teamName', 1, 120) }) }, address)
        : await auth.login(credentials, address);
      response.setHeader('Set-Cookie', auth.cookie(result.token));
      json(response, account === 'register' ? 201 : 200, { user: result.user });
      return;
    }
    const session = auth.authenticate(request.headers.cookie);
    if (account === 'me') { json(response, 200, { user: session.user }); return; }
    if (account === 'logout') {
      fields(body, []);
      auth.logout(request.headers.cookie);
      response.setHeader('Set-Cookie', auth.clearCookie());
      response.writeHead(204).end();
      return;
    }
    if (collection) {
      if (method === 'GET') {
        if (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined) throw invalid();
        json(response, 200, { items: await listRuns(runs, url.searchParams, { userId: session.userId }) });
      } else {
        if (url.search) throw invalid();
        const result = await createRun(runs, body, request.headersDistinct['idempotency-key'] ?? [], { userId: session.userId });
        response.setHeader('Location', `/api/runs/${result.run.id}`);
        json(response, result.created ? 201 : 200, result.run);
      }
      return;
    }
    let runId: string;
    try { runId = decodeURIComponent(run![1]!); } catch { throw invalid(); }
    if (method === 'GET') {
      const result = await getPlanReview(runs, runId, { userId: session.userId });
      if (!result.ok) serviceError(result.error);
      json(response, 200, result.review);
      return;
    }
    const changes = run![2] === 'request-changes';
    fields(body, changes ? ['outputId', 'outputRevision', 'comment'] : ['outputId', 'outputRevision']);
    const outputId = string(body, 'outputId', 1, 128);
    if (!Number.isSafeInteger(body.outputRevision) || (body.outputRevision as number) < 1) throw invalid();
    if (changes && (typeof body.comment !== 'string' || !body.comment.trim())) {
      throw new HttpError(400, 'COMMENT_REQUIRED', 'Informe um comentário para solicitar alterações.');
    }
    const result = await executePlanCommand(runs, runId, {
      type: changes ? 'request_plan_changes' : 'approve_plan', outputId,
      outputRevision: body.outputRevision as number,
      ...(changes ? { comment: string(body, 'comment', 1, 4000, false) } : {}),
    }, { userId: session.userId });
    if (!result.ok) serviceError(result.error);
    json(response, 200, { status: result.status, phase: result.phase, approvals: publicPlanDecisions(result.approvals) });
  } catch (error) {
    // Não devolve mensagens de exceções de IO, caminhos, cookies ou conteúdo privado.
    const failure = error instanceof HttpError || error instanceof AuthError ? error
      : error instanceof RunInputError ? new HttpError(400, error.code, error.message)
      : error instanceof StorageError && error.code === 'IDEMPOTENCY_CONFLICT' ? new HttpError(409, error.code, error.message)
      : new HttpError(503, 'STORAGE_FAILURE', 'Não foi possível concluir a operação.');
    if (!request.complete) {
      response.setHeader('Connection', 'close');
      request.resume();
    }
    json(response, failure.status, { error: { code: failure.code, message: failure.message } });
  }
}
