import { createHash, randomUUID } from 'node:crypto';
import type { RunRecord, RunStore } from '../storage/runs.js';

export class RunInputError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'INVALID_IDEMPOTENCY_KEY' = 'INVALID_INPUT') {
    super(code === 'INVALID_INPUT' ? 'Campos inválidos para esta operação.'
      : 'Informe um único Idempotency-Key com UUID v4.');
  }
}

type RunSummary = Pick<RunRecord, 'id' | 'name' | 'applicationName' | 'createdAt' | 'status' | 'phase'>;
function summary(run: RunRecord): RunSummary {
  return { id: run.id, name: run.name, applicationName: run.applicationName,
    createdAt: run.createdAt, status: run.status, phase: run.phase };
}
const hash = (values: string[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
function normalized(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw new RunInputError();
  const text = value.trim();
  const length = [...text].length;
  if (length < min || length > max) throw new RunInputError();
  return text;
}

/** A identidade é fornecida pela sessão; o cliente envia somente a configuração. */
export async function createRun(
  store: RunStore, body: Record<string, unknown>, keys: readonly string[], context: { userId: string },
): Promise<{ run: RunSummary; created: boolean }> {
  if (keys.length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(keys[0]!)) {
    throw new RunInputError('INVALID_IDEMPOTENCY_KEY');
  }
  if (Object.keys(body).some(key => !['name', 'applicationName', 'objective', 'text'].includes(key))) {
    throw new RunInputError();
  }
  const name = normalized(body.name, 1, 120);
  const applicationName = normalized(body.applicationName, 1, 120);
  const objective = normalized(body.objective === undefined ? '' : body.objective, 0, 2000);
  if (typeof body.text !== 'string' || !body.text.trim()) throw new RunInputError();
  const text = body.text;
  const artifactId = randomUUID();
  const { record, created } = await store.createIdempotent({
    id: `run-${hash([context.userId, keys[0]!.toLowerCase()])}`,
    ownerId: context.userId, name, applicationName, createdAt: new Date().toISOString(),
    status: 'draft', phase: 'intake',
    creation: { requestHash: hash([name, applicationName, objective, text]) },
    artifacts: [{ id: artifactId, name: 'historias-e-criterios.txt', version: '1', text }],
    input: { startUrl: null, credentialRef: null, accessProfile: null, dataPreparation: null,
      authorizedTarget: false, objective, artifactIds: [artifactId] },
    outputs: [], validations: [], approvals: [], questions: [], answers: [], budgetCycles: [],
    validationPolicy: { maxValidationRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 },
  });
  return { run: summary(record.run), created };
}

export async function listRuns(store: RunStore, query: URLSearchParams, context: { userId: string }): Promise<RunSummary[]> {
  for (const key of query.keys()) {
    if (!['q', 'status'].includes(key) || query.getAll(key).length !== 1) throw new RunInputError();
  }
  const search = query.get('q') ?? '';
  if ([...search].length > 120) throw new RunInputError();
  const q = search.trim().toLowerCase();
  const status = query.get('status');
  if (status !== null && !['draft', 'running', 'awaiting_approval', 'awaiting_input',
    'completed', 'interrupted', 'error', 'cancelled'].includes(status)) throw new RunInputError();
  const records = await store.listForOwner(context.userId);
  return records.map(record => record.run)
    .filter(run => (status === null || run.status === status) &&
      (!q || run.name.toLowerCase().includes(q) || run.applicationName.toLowerCase().includes(q)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map(summary);
}
