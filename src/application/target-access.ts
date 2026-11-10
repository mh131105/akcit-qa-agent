import { randomUUID } from 'node:crypto';
import type { RunRecord, RunStore, StoredRun, TargetCredential } from '../storage/runs.js';
import { StorageError } from '../storage/runs.js';
import { assertTargetUrl, validateTargetUrl, TargetPolicyError } from '../../agents/test-executor/tools/target-policy.mjs';
import type { TargetLookup } from '../../agents/test-executor/tools/target-policy.mjs';

export type TargetAccessReview = {
  revision: number;
  startUrl: string | null;
  accessProfile: string | null;
  dataPreparation: string | null;
  authorizedTarget: boolean;
  hasCredential: boolean;
  canEdit: boolean;
};

export type TargetAccessErrorCode =
  | 'INVALID_INPUT'
  | 'AUTHORIZED_TARGET_REQUIRED'
  | 'INVALID_URL'
  | 'TARGET_NOT_ALLOWED'
  | 'TARGET_IMMUTABLE'
  | 'STALE_VERSION'
  | 'INVALID_STATE'
  | 'UNAUTHORIZED'
  | 'RUN_NOT_FOUND'
  | 'STORAGE_FAILURE';

export type TargetAccessError = {
  code: TargetAccessErrorCode;
  message: string;
};

export type ConfigureTargetAccessResult =
  | { ok: true; targetAccess: TargetAccessReview }
  | { ok: false; error: TargetAccessError };

export function canEditTargetAccess(run: RunRecord): boolean {
  const allowedPhases = ['intake', 'curation', 'planning', 'case_design'];
  // Após falha de credencial no mapeamento, a mesma aplicação permite corrigir a
  // credencial e solicitar nova tentativa explícita (nova revisão de acesso).
  if (run.phase === 'mapping') return run.status === 'awaiting_input';
  if (!allowedPhases.includes(run.phase)) return false;
  return run.status === 'draft' || ['awaiting_approval', 'awaiting_input'].includes(run.status);
}
/** Resolução privada da credencial do alvo; somente o backend acessa os valores. */
export function resolveTargetCredential(record: { targetCredential?: TargetCredential; run: RunRecord }): TargetCredential | null {
  return record.targetCredential && record.run.input?.credentialRef === record.targetCredential.ref
    ? record.targetCredential : null;
}

export function publicTargetAccess(run: RunRecord, hasCredential: boolean): TargetAccessReview {
  const input = (run.input ?? {}) as Record<string, unknown>;
  return {
    revision: typeof input.accessRevision === 'number' ? input.accessRevision : 0,
    startUrl: typeof input.startUrl === 'string' ? input.startUrl : null,
    accessProfile: typeof input.accessProfile === 'string' ? input.accessProfile : null,
    dataPreparation: typeof input.dataPreparation === 'string' ? input.dataPreparation : null,
    authorizedTarget: input.authorizedTarget === true,
    hasCredential,
    canEdit: canEditTargetAccess(run),
  };
}

/** Conferida antes do DNS e novamente sob a trava de gravação. */
function accessFailure(record: StoredRun, body: Record<string, unknown>, userId: string, url: URL): TargetAccessError | null {
  const run = record.run;
  if (run.ownerId !== userId) {
    return { code: 'UNAUTHORIZED', message: 'Operação não autorizada para esta execução.' };
  }
  if (!canEditTargetAccess(run)) {
    return { code: 'INVALID_STATE', message: 'A configuração de acesso não pode ser alterada no estado atual da execução.' };
  }
  const revision = typeof run.input?.accessRevision === 'number' ? run.input.accessRevision : 0;
  if (body.expectedAccessRevision !== revision) {
    return { code: 'STALE_VERSION', message: 'A revisão da configuração de acesso mudou. Consulte a configuração atualizada antes de salvar novamente.' };
  }
  const startUrl = typeof run.input?.startUrl === 'string' ? run.input.startUrl : null;
  if (run.status !== 'draft' && startUrl !== null && startUrl !== url.href) {
    return { code: 'TARGET_IMMUTABLE', message: 'O endereço da aplicação testada não pode ser alterado após o início da preparação. Crie outra execução para testar outro alvo.' };
  }
  if (body.credential === undefined && !resolveTargetCredential(record)) {
    return { code: 'INVALID_INPUT', message: 'Informe a credencial de teste para o primeiro cadastro de acesso.' };
  }
  return null;
}

export async function configureTargetAccess(
  store: RunStore,
  runId: string,
  body: Record<string, unknown>,
  context: { userId: string; lookup?: TargetLookup },
  allowedOrigins: readonly string[],
): Promise<ConfigureTargetAccessResult> {
  const allowedKeys = ['expectedAccessRevision', 'startUrl', 'accessProfile', 'dataPreparation', 'authorizedTarget', 'credential'];
  if (Object.keys(body).some(key => !allowedKeys.includes(key))) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Campos inválidos para esta operação.' } };
  }
  if (!Number.isSafeInteger(body.expectedAccessRevision) || (body.expectedAccessRevision as number) < 0) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Informe a revisão esperada como número inteiro não negativo.' } };
  }
  if (body.authorizedTarget !== true) {
    return { ok: false, error: { code: 'AUTHORIZED_TARGET_REQUIRED', message: 'Confirme a autorização para testar a aplicação.' } };
  }
  if (typeof body.accessProfile !== 'string' || !body.accessProfile.trim() || [...body.accessProfile.trim()].length > 120) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Informe o perfil de acesso com até 120 caracteres.' } };
  }
  if (typeof body.dataPreparation !== 'string' || !body.dataPreparation.trim() || [...body.dataPreparation.trim()].length > 2000) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Informe a preparação necessária com até 2.000 caracteres.' } };
  }
  if (typeof body.startUrl !== 'string' || !body.startUrl.trim() || [...body.startUrl.trim()].length > 2000) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Informe o endereço da aplicação.' } };
  }

  let url: URL;
  try {
    url = validateTargetUrl(body.startUrl.trim(), allowedOrigins);
  } catch (error) {
    if (error instanceof TargetPolicyError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    return { ok: false, error: { code: 'TARGET_NOT_ALLOWED', message: 'Não foi possível confirmar que o endereço da aplicação é público.' } };
  }

  if (body.credential !== undefined) {
    if (!body.credential || typeof body.credential !== 'object' || Array.isArray(body.credential)) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Credencial inválida.' } };
    }
    const cred = body.credential as Record<string, unknown>;
    if (Object.keys(cred).some(key => !['username', 'password'].includes(key))) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Campos inválidos na credencial.' } };
    }
    if (typeof cred.username !== 'string' || !cred.username.trim() || [...cred.username.trim()].length > 120) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Informe o usuário da conta de teste com até 120 caracteres.' } };
    }
    // Preserva a senha literalmente: não aplica trim nem regras de senha de produto.
    if (typeof cred.password !== 'string' || cred.password.length < 1 || [...cred.password].length > 500) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Informe a senha da conta de teste com até 500 caracteres.' } };
    }
  }

  try {
    const failure = accessFailure(await store.read(runId), body, context.userId, url);
    if (failure) return { ok: false, error: failure };
    // Só resolve DNS depois de conferir a execução e a autorização local.
    // O navegador reconfere cada conexão e conecta ao IP aprovado.
    await assertTargetUrl(url.href, allowedOrigins, context.lookup);
    return await store.update<ConfigureTargetAccessResult>(runId, record => {
      // Reconferir após o await impede gravar com acesso/revisão alterados.
      const failure = accessFailure(record, body, context.userId, url);
      if (failure) return { value: { ok: false, error: failure }, save: false };
      if (body.credential !== undefined) {
        const cred = body.credential as { username: string; password: string };
        const credentialRef = `cred-${randomUUID()}`;
        record.targetCredential = {
          ref: credentialRef,
          username: cred.username.trim(),
          password: cred.password,
        };
        record.run.input.credentialRef = credentialRef;
      }
      record.run.input.startUrl = url.href;
      record.run.input.accessProfile = (body.accessProfile as string).trim();
      record.run.input.dataPreparation = (body.dataPreparation as string).trim();
      record.run.input.authorizedTarget = true;
      record.run.input.accessRevision = (body.expectedAccessRevision as number) + 1;

      return {
        value: { ok: true, targetAccess: publicTargetAccess(record.run, true) },
        save: true,
      };
    });
  } catch (error) {
    if (error instanceof TargetPolicyError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    if (error instanceof StorageError) {
      return { ok: false, error: { code: error.code === 'RUN_NOT_FOUND' ? 'RUN_NOT_FOUND' : 'STORAGE_FAILURE', message: error.message } };
    }
    return { ok: false, error: { code: 'STORAGE_FAILURE', message: 'Não foi possível concluir a operação no armazenamento.' } };
  }
}
