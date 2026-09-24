import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PlanApprovalState, PlanDecision } from '../domain/plan-approval.js';

type JsonObject = Record<string, unknown>;
export type RunOutput = JsonObject & {
  id: string; phase: string; revision: number;
  dependsOn: { outputId: string; revision: number }[];
  payload: JsonObject;
  producer?: string; createdAt?: string; budgetCycleId?: string;
  answerRefs?: { questionId: string; revision: number; answerId?: string }[];
};
export type PreparationCall = {
  id: string; role: 'artifact-curator' | 'test-designer' | 'output-validator';
  provider: string; model: string; phase: 'curation' | 'planning' | 'case_design'; attempt: number;
  outputRevision: number; startedAt: string; finishedAt?: string; durationMs?: number;
  status: 'running' | 'completed' | 'invalid' | 'error' | 'cancelled' | 'interrupted';
  budgetCycleId?: string; errorCode?: string; usage?: Record<string, number>; estimatedCost?: number;
};
export type PreparationAnswer = {
  id: string; revision: number; outputId: string; outputRevision: number; questionId: string;
  text: string; artifactId: string; actorId: string; at: string;
};
export type Preparation = {
  id: string; budgetCycleId: string; startedAt: string; finishedAt: string | null;
  activeRole: PreparationCall['role'] | null; activity: string | null;
  stopReason: { code: string; message: string } | null;
  limits: { maxRequirements: number; maxRevisions: number; maxValidatorAttempts: number;
    timeoutMs: number; activeMs: number };
  calls: PreparationCall[];
  // Tempo consumido em ciclos encerrados; espera por respostas não entra no limite.
  accumulatedActiveMs?: number;
  consumedAnswerIds?: string[];
};
export type RunValidation = PlanApprovalState['validations'][number] & {
  id?: string; at?: string; attempt?: number; reason?: string;
  findings?: { code: string; message: string; location: string | null }[];
};
export type Interruption = { reason: 'service_restart'; at: string };
export type RunRecord = JsonObject & {
  id: string; ownerId: string; name: string; applicationName: string; createdAt: string;
  status: string; phase: string; input: JsonObject; artifacts: JsonObject[];
  outputs: RunOutput[]; validations: RunValidation[];
  approvals: PlanDecision[]; questions: JsonObject[]; answers: JsonObject[];
  validationPolicy: JsonObject; budgetCycles: JsonObject[];
  preparation?: Preparation;
  answerArtifacts?: JsonObject[];
  creation?: { requestHash: string };
  interruptions?: Interruption[];
};
export type WorkIntent = {
  id: string; type: 'create_cases' | 'analyze_feedback';
  outputId: string; outputRevision: number; createdAt: string;
  status: 'pending' | 'completed' | 'interrupted' | 'cancelled'; interruption?: Interruption;
  processingId?: string; finishedAt?: string; reason?: { code: string; message: string };
};
export type StoredRun = { schemaVersion: 1; run: RunRecord; workIntents: WorkIntent[] };
export type StorageErrorCode =
  | 'INVALID_RUN_ID' | 'RUN_NOT_FOUND' | 'RUN_INACCESSIBLE'
  | 'RUN_EXISTS' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_RECORD' | 'AMBIGUOUS_RECORD' | 'STORAGE_FAILURE';

const messages: Record<StorageErrorCode, string> = {
  INVALID_RUN_ID: 'Identificador de execução inválido.',
  RUN_NOT_FOUND: 'Execução não encontrada.',
  RUN_INACCESSIBLE: 'Registro da execução inacessível.',
  RUN_EXISTS: 'A execução já existe.',
  IDEMPOTENCY_CONFLICT: 'A chave de idempotência já foi utilizada com outro conteúdo.',
  INVALID_RECORD: 'Registro de execução inválido; os dados foram preservados.',
  AMBIGUOUS_RECORD: 'Registro com IDs concorrentes ou revisões duplicadas.',
  STORAGE_FAILURE: 'Não foi possível concluir a operação no armazenamento.',
};
export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode) {
    super(messages[code]);
    this.name = 'StorageError';
  }
}

// ponytail: uma trava global basta para um processo escritor; múltiplos processos
// exigirão coordenação externa. Todas as mutações, inclusive cancelamentos, usam update.
let pending: Promise<unknown> = Promise.resolve();
function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const objects = (value: unknown): value is JsonObject[] =>
  Array.isArray(value) && value.every(object);
const strings = (value: JsonObject, keys: string[]) =>
  keys.every(key => typeof value[key] === 'string');
const utc = (value: unknown) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
const interruption = (value: unknown) => object(value) &&
  value.reason === 'service_restart' && utc(value.at);

const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validPreparation(value: unknown): boolean {
  if (!object(value) || !strings(value, ['id', 'budgetCycleId']) || !value.id || !value.budgetCycleId ||
    !utc(value.startedAt) || (value.finishedAt !== null && !utc(value.finishedAt)) ||
    ![null, 'artifact-curator', 'test-designer', 'output-validator'].includes(value.activeRole as string | null) ||
    (value.activity !== null && typeof value.activity !== 'string') ||
    (value.stopReason !== null && (!object(value.stopReason) || !strings(value.stopReason, ['code', 'message']))) ||
    (value.accumulatedActiveMs !== undefined && !nonnegative(value.accumulatedActiveMs)) ||
    (value.consumedAnswerIds !== undefined && (!Array.isArray(value.consumedAnswerIds) ||
      !value.consumedAnswerIds.every(id => typeof id === 'string' && !!id) ||
      new Set(value.consumedAnswerIds).size !== value.consumedAnswerIds.length)) ||
    !object(value.limits) || !['maxRequirements', 'maxRevisions', 'maxValidatorAttempts', 'timeoutMs', 'activeMs']
      .every(key => positive((value.limits as JsonObject)[key])) ||
    Object.entries({ maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000, activeMs: 2700000 })
      .some(([key, ceiling]) => ((value.limits as JsonObject)[key] as number) > ceiling) || !objects(value.calls)) return false;
  return new Set(value.calls.map(call => call.id)).size === value.calls.length && value.calls.every(call =>
    strings(call, ['id', 'provider', 'model']) && !!call.id && !!call.provider && !!call.model &&
    ['artifact-curator', 'test-designer', 'output-validator'].includes(call.role as string) &&
    ['curation', 'planning', 'case_design'].includes(call.phase as string) && positive(call.attempt) && positive(call.outputRevision) &&
    utc(call.startedAt) && (call.finishedAt === undefined || utc(call.finishedAt)) &&
    (call.durationMs === undefined || nonnegative(call.durationMs)) &&
    ['running', 'completed', 'invalid', 'error', 'cancelled', 'interrupted'].includes(call.status as string) &&
    (call.budgetCycleId === undefined || (typeof call.budgetCycleId === 'string' && !!call.budgetCycleId)) &&
    (call.errorCode === undefined || typeof call.errorCode === 'string') &&
    (call.estimatedCost === undefined || nonnegative(call.estimatedCost)) &&
    (call.usage === undefined || (object(call.usage) && Object.keys(call.usage).every(key =>
      ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].includes(key) && nonnegative((call.usage as JsonObject)[key])))));
}

function validId(runId: string): void {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) {
    throw new StorageError('INVALID_RUN_ID');
  }
}

// Validação estrutural dos campos usados aqui; conteúdo de artefatos/payloads e
// campos adicionais são preservados. Regras de aprovação pertencem ao domínio.
function validate(record: unknown, runId: string): asserts record is StoredRun {
  if (!object(record) || record.schemaVersion !== 1 || !object(record.run)) {
    throw new StorageError('INVALID_RECORD');
  }
  const run = record.run;
  if (run.id !== runId || !strings(run, ['id', 'ownerId', 'name', 'applicationName', 'createdAt', 'status', 'phase']) ||
    !(run.ownerId as string).trim() || !utc(run.createdAt) || !object(run.input) ||
    (run.input.credentialRef !== null && typeof run.input.credentialRef !== 'string') ||
    !object(run.validationPolicy) ||
    !['artifacts', 'questions', 'answers', 'budgetCycles'].every(key => objects(run[key])) ||
    !objects(run.outputs) || !run.outputs.every(output =>
      strings(output, ['id', 'phase']) && Number.isFinite(output.revision) &&
      (output.producer === undefined || (typeof output.producer === 'string' && !!output.producer)) &&
      (output.createdAt === undefined || utc(output.createdAt)) &&
      (output.budgetCycleId === undefined || (typeof output.budgetCycleId === 'string' && !!output.budgetCycleId)) &&
      (output.answerRefs === undefined || (objects(output.answerRefs) && output.answerRefs.every(ref =>
        typeof ref.questionId === 'string' && !!ref.questionId && positive(ref.revision) &&
        (ref.answerId === undefined || (typeof ref.answerId === 'string' && !!ref.answerId))))) &&
      object(output.payload) && objects(output.dependsOn) && output.dependsOn.every(ref =>
        typeof ref.outputId === 'string' && Number.isFinite(ref.revision))) ||
    !objects(run.validations) || !run.validations.every(verdict =>
      strings(verdict, ['outputId', 'validator', 'status']) && Number.isFinite(verdict.outputRevision) &&
      (verdict.id === undefined || (typeof verdict.id === 'string' && !!verdict.id)) &&
      (verdict.at === undefined || utc(verdict.at)) &&
      (verdict.attempt === undefined || positive(verdict.attempt)) &&
      (verdict.reason === undefined || (typeof verdict.reason === 'string' && !!verdict.reason.trim())) &&
      (verdict.findings === undefined || (objects(verdict.findings) && verdict.findings.every(finding =>
        strings(finding, ['code', 'message']) && !!finding.code && !!finding.message &&
        (finding.location === null || typeof finding.location === 'string'))))) ||
    !objects(run.approvals) || !run.approvals.every(decision =>
      strings(decision, ['id', 'outputId', 'actorId', 'at', 'decision', 'comment']) &&
      Number.isFinite(decision.outputRevision)) ||
    (run.preparation !== undefined && (!validPreparation(run.preparation) ||
      !(run.budgetCycles as JsonObject[]).some(cycle => cycle.id === (run.preparation as JsonObject).budgetCycleId &&
        utc(cycle.startedAt) && ((cycle.reason === 'initial_preparation' && cycle.answerRef === null) ||
          (cycle.reason === 'user_answer' && Array.isArray(cycle.answerRefs) && cycle.answerRefs.length > 0 &&
            cycle.answerRefs.every(id => typeof id === 'string' && (run.answers as JsonObject[]).some(answer => answer.id === id)))) &&
        Array.isArray(cycle.affectedCaseIds) && cycle.affectedCaseIds.length === 0 && object(cycle.limits) &&
        Object.entries((run.preparation as JsonObject).limits as JsonObject).every(([key, value]) =>
          (cycle.limits as JsonObject)[key] === value)))) ||
    (run.answerArtifacts !== undefined && (!objects(run.answerArtifacts) ||
      !run.answerArtifacts.every(artifact => strings(artifact, ['id', 'name', 'version', 'text']) &&
        !!artifact.id && !!artifact.name && artifact.version === '1' && !!(artifact.text as string).trim()) ||
      new Set(run.answerArtifacts.map(artifact => artifact.id)).size !== run.answerArtifacts.length ||
      !(run.answers as JsonObject[]).every(answer => answer.artifactId === undefined || (strings(answer,
        ['id', 'outputId', 'questionId', 'text', 'artifactId', 'actorId']) && !!answer.id &&
        answer.revision === 1 && positive(answer.outputRevision) && utc(answer.at) &&
        !!(answer.text as string).trim() && [...answer.text as string].length <= 4000 &&
        (run.answerArtifacts as JsonObject[]).some(artifact => artifact.id === answer.artifactId && artifact.text === answer.text))) ||
      new Set((run.answers as JsonObject[]).filter(answer => answer.artifactId !== undefined).map(answer => answer.id)).size !==
        (run.answers as JsonObject[]).filter(answer => answer.artifactId !== undefined).length)) ||
    (run.creation !== undefined && (!object(run.creation) ||
      typeof run.creation.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(run.creation.requestHash))) ||
    (run.interruptions !== undefined && (!Array.isArray(run.interruptions) || !run.interruptions.every(interruption))) ||
    !objects(record.workIntents) || !record.workIntents.every(work =>
      strings(work, ['id', 'outputId']) && !!work.id && !!work.outputId &&
      Number.isSafeInteger(work.outputRevision) && (work.outputRevision as number) > 0 && utc(work.createdAt) &&
      ['create_cases', 'analyze_feedback'].includes(work.type as string) &&
      (work.processingId === undefined || (typeof work.processingId === 'string' && !!work.processingId)) &&
      (work.finishedAt === undefined || utc(work.finishedAt)) &&
      (work.reason === undefined || (object(work.reason) && strings(work.reason, ['code', 'message']) && !!work.reason.code && !!work.reason.message)) &&
      ((work.status === 'pending' && work.interruption === undefined && work.finishedAt === undefined && work.reason === undefined) ||
        (['completed', 'cancelled'].includes(work.status as string) && utc(work.finishedAt) && work.interruption === undefined) ||
        (work.status === 'interrupted' && (work.interruption === undefined ? utc(work.finishedAt) && work.reason !== undefined : interruption(work.interruption))))) ||
    new Set(record.workIntents.map(work => work.id)).size !== record.workIntents.length) {
    throw new StorageError('INVALID_RECORD');
  }
}

function ioError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const code = object(error) ? error.code : undefined;
  if (code === 'ENOENT') return new StorageError('RUN_NOT_FOUND');
  if (['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR', 'EISDIR'].includes(code as string)) {
    return new StorageError('RUN_INACCESSIBLE');
  }
  return new StorageError('STORAGE_FAILURE');
}

export class RunStore {
  private readonly dataDir: string;
  private readonly directory: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.directory = join(this.dataDir, 'runs');
  }

  async initialize(): Promise<void> {
    try {
      for (const directory of [this.dataDir, this.directory]) {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.lstat(directory)).isDirectory()) throw new StorageError('RUN_INACCESSIBLE');
        await fs.chmod(directory, 0o700);
      }
    } catch (error) { throw ioError(error); }
  }

  private path(runId: string): string {
    validId(runId);
    return join(this.directory, `${runId}.json`);
  }

  async read(runId: string): Promise<StoredRun> {
    const path = this.path(runId);
    try {
      const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await file.stat()).isFile()) throw new StorageError('RUN_INACCESSIBLE');
        let record: unknown;
        try { record = JSON.parse(await file.readFile('utf8')); }
        catch (error) {
          if (error instanceof SyntaxError) throw new StorageError('INVALID_RECORD');
          throw error;
        }
        validate(record, runId);
        return record;
      } finally { await file.close(); }
    } catch (error) { throw ioError(error); }
  }

  private async save(runId: string, record: StoredRun): Promise<void> {
    const path = this.path(runId);
    validate(record, runId);
    const temporary = join(this.directory, `.${runId}-${randomUUID()}.tmp`);
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
        await file.sync();
      } finally { await file.close(); }
      await fs.rename(temporary, path);
      const directory = await fs.open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); }
      finally { await directory.close(); }
    } catch {
      throw new StorageError('STORAGE_FAILURE');
    } finally {
      // Um temporário incompleto nunca vira registro; recuperação ignora .tmp.
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async create(run: RunRecord): Promise<StoredRun> {
    const record: StoredRun = { schemaVersion: 1, run: structuredClone(run), workIntents: [] };
    const runId = record.run.id;
    const path = this.path(runId);
    return locked(async () => {
      try {
        await fs.lstat(path);
        throw new StorageError('RUN_EXISTS');
      } catch (error) {
        if (!object(error) || error.code !== 'ENOENT') throw ioError(error);
      }
      await this.save(runId, record);
      return record;
    });
  }

  async createIdempotent(run: RunRecord): Promise<{ record: StoredRun; created: boolean }> {
    const record: StoredRun = { schemaVersion: 1, run: structuredClone(run), workIntents: [] };
    const runId = record.run.id;
    validId(runId);
    validate(record, runId);
    if (!record.run.creation) throw new StorageError('INVALID_RECORD');
    return locked(async () => {
      let existing: StoredRun;
      try { existing = await this.read(runId); }
      catch (error) {
        if (!(error instanceof StorageError) || error.code !== 'RUN_NOT_FOUND') throw error;
        await this.save(runId, record);
        return { record, created: true };
      }
      if (existing.run.ownerId !== record.run.ownerId ||
        existing.run.creation?.requestHash !== record.run.creation?.requestHash) {
        throw new StorageError('IDEMPOTENCY_CONFLICT');
      }
      return { record: existing, created: false };
    });
  }

  async listForOwner(ownerId: string): Promise<StoredRun[]> {
    let names: string[];
    try { names = await fs.readdir(this.directory); }
    catch (error) { throw ioError(error); }
    const records: StoredRun[] = [];
    // ponytail: leitura sequencial basta para o volume do piloto; indexar por
    // proprietário quando o volume tornar a leitura de todos os registros cara.
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const record = await this.read(name.slice(0, -5));
      if (record.run.ownerId === ownerId) records.push(record);
    }
    return records;
  }

  /** Lê do disco sob a trava, aplica a mudança e só retorna após salvar.
   * save:false descarta mutações locais (recusa/repetição sem mudança).
   * Não chamar update/create de dentro de change; a trava não é reentrante.
   */
  async update<T>(runId: string, change: (record: StoredRun) =>
    { value: T; save: boolean } | Promise<{ value: T; save: boolean }>): Promise<T> {
    validId(runId);
    return locked(async () => {
      const record = await this.read(runId);
      const { value, save } = await change(record);
      if (save) await this.save(runId, record);
      return value;
    });
  }

  async recoverInterrupted(): Promise<number> {
    let names: string[];
    try { names = await fs.readdir(this.directory); }
    catch (error) { throw ioError(error); }
    let recovered = 0;
    for (const name of names.filter(name => name.endsWith('.json')).sort()) {
      recovered += await this.update(name.slice(0, -5), record => {
        if (record.run.status !== 'running') return { value: 0, save: false };
        const event: Interruption = { reason: 'service_restart', at: new Date().toISOString() };
        record.run.status = 'interrupted';
        if (record.run.preparation) {
          const preparation = record.run.preparation;
          preparation.accumulatedActiveMs = (preparation.accumulatedActiveMs ?? 0) +
            Math.max(0, Date.parse(event.at) - Date.parse(preparation.startedAt));
          preparation.finishedAt = event.at;
          preparation.activeRole = null;
          preparation.activity = null;
          preparation.stopReason = { code: 'SERVICE_RESTART', message: 'O serviço reiniciou. O trabalho foi interrompido sem retomada automática.' };
          for (const call of preparation.calls) {
            if (call.status === 'running') {
              call.status = 'interrupted'; call.finishedAt = event.at;
              call.durationMs = Math.max(0, Date.parse(event.at) - Date.parse(call.startedAt));
              call.errorCode = 'SERVICE_RESTART';
            }
          }
        }
        record.run.interruptions = [...(record.run.interruptions ?? []), event];
        for (const work of record.workIntents) {
          if (work.status === 'pending') {
            work.status = 'interrupted';
            work.interruption = { ...event };
            work.finishedAt = event.at;
            work.reason = { code: 'SERVICE_RESTART', message: 'O serviço reiniciou; trabalho interrompido sem retomada automática.' };
          }
        }
        return { value: 1, save: true };
      });
    }
    return recovered;
  }
}
