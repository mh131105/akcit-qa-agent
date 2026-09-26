import { createHash, randomUUID } from 'node:crypto';
import { StorageError, type RunRecord, type RunStore } from '../storage/runs.js';
import { extractArtifacts, originalFile, saveArtifactFiles, type UploadedFile, type InputArtifact } from './artifacts.js';

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
  store: RunStore, body: Record<string, unknown>, keys: readonly string[], context: { userId: string }, files: readonly UploadedFile[] = [], copiedSettings?: Record<string, unknown>,
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
  if (body.text !== undefined && typeof body.text !== 'string') throw new RunInputError();
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim() && !files.length) throw new RunInputError();
  const artifacts = await extractArtifacts(files);
  const runId = `run-${hash([context.userId, keys[0]!.toLowerCase()])}`;
  const cleanup = await saveArtifactFiles(store.dataDir, runId, artifacts, files);
  if (text.trim()) artifacts.unshift({ id: randomUUID(), name: 'historias-e-criterios.txt', version: '1', text });
  try {
  const { record, created } = await store.createIdempotent({
    id: runId,
    ownerId: context.userId, name, applicationName, createdAt: new Date().toISOString(),
    status: 'draft', phase: 'intake',
    creation: { requestHash: hash([name, applicationName, objective, text, ...artifacts.filter(item => item.originalId).flatMap(item => [item.name, item.sha256!]), ...(copiedSettings ? [JSON.stringify(copiedSettings)] : [])]) },
    artifacts,
    input: { startUrl: copiedSettings?.startUrl ?? null, credentialRef: null, accessProfile: copiedSettings?.accessProfile ?? null, dataPreparation: copiedSettings?.dataPreparation ?? null,
      authorizedTarget: false, objective, artifactIds: artifacts.map(item => item.id) },
    outputs: [], validations: [], approvals: [], questions: [], answers: [], budgetCycles: [],
    validationPolicy: { maxValidationRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 },
  });
  if (!created) await cleanup();
  return { run: summary(record.run), created };
  } catch (error) {
    // Um erro depois do rename pode significar que o registro já foi confirmado.
    // Nunca apagar arquivos referenciados por esse registro ou em estado incerto.
    try {
      const saved = await store.read(runId);
      if (!saved.run.artifacts.some(item => artifacts.some(artifact => artifact.id === item.id))) await cleanup();
    } catch (readError) { if (readError instanceof StorageError && readError.code === 'RUN_NOT_FOUND') await cleanup(); }
    throw error;
  }
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
    'ready', 'completed', 'interrupted', 'error', 'cancelled'].includes(status)) throw new RunInputError();
  const records = await store.listForOwner(context.userId);
  return records.map(record => record.run)
    .filter(run => (status === null || run.status === status) &&
      (!q || run.name.toLowerCase().includes(q) || run.applicationName.toLowerCase().includes(q)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map(summary);
}


/** Uma nova execução não herda acesso confirmado, decisões ou conclusões. */
export async function duplicateRun(store: RunStore, runId: string, body: Record<string, unknown>,
  keys: readonly string[], context: { userId: string }): Promise<{ run: RunSummary; created: boolean }> {
  const source = (await store.read(runId)).run;
  if (source.ownerId !== context.userId) throw new StorageError('RUN_NOT_FOUND');
  if (Object.keys(body).some(key => key !== 'artifactIds') || !Array.isArray(body.artifactIds) || !body.artifactIds.length ||
    body.artifactIds.some(id => typeof id !== 'string') || new Set(body.artifactIds).size !== body.artifactIds.length ||
    body.artifactIds.some(id => !source.artifacts.some(artifact => artifact.id === id))) throw new RunInputError();
  const selected = source.artifacts.filter(artifact => (body.artifactIds as string[]).includes(artifact.id as string)) as InputArtifact[];
  const files: UploadedFile[] = [];
  for (const artifact of selected.filter(item => item.originalId)) files.push(await originalFile(store.dataDir, source.id, artifact));
  const texts = selected.filter(item => !item.originalId);
  // Textos independentes permanecem artefatos separados também na cópia.
  if (texts.length > 1) throw new RunInputError();
  const result = await createRun(store, { name: `${source.name.slice(0, 112)} (cópia)`, applicationName: source.applicationName,
    objective: source.input.objective ?? '', text: texts[0]?.text ?? '' }, keys, context, files,
    Object.fromEntries(['startUrl', 'accessProfile', 'dataPreparation'].map(key => [key, source.input[key] ?? null])));
  return result;
}
