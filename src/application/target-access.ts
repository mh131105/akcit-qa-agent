import { randomUUID } from 'node:crypto';
import type { RunRecord, RunStore, TargetCredential } from '../storage/runs.js';
import { StorageError } from '../storage/runs.js';

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

export async function configureTargetAccess(
  store: RunStore,
  runId: string,
  body: Record<string, unknown>,
  context: { userId: string },
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
    url = new URL(body.startUrl.trim());
  } catch {
    return { ok: false, error: { code: 'INVALID_URL', message: 'Endereço da aplicação inválido.' } };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: { code: 'INVALID_URL', message: 'O endereço deve usar o protocolo HTTP ou HTTPS.' } };
  }
  if (url.username || url.password) {
    return { ok: false, error: { code: 'INVALID_URL', message: 'O endereço não deve conter credenciais embutidas.' } };
  }
  if (url.search || url.hash) {
    return { ok: false, error: { code: 'INVALID_URL', message: 'Informe um endereço sem parâmetros após “?” ou “#”.' } };
  }
  if (!allowedOrigins.includes(url.origin)) {
    return { ok: false, error: { code: 'TARGET_NOT_ALLOWED', message: 'Este endereço não está autorizado para testes.' } };
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
    return await store.update<ConfigureTargetAccessResult>(runId, record => {
      if (record.run.ownerId !== context.userId) {
        return {
          value: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Operação não autorizada para esta execução.' } },
          save: false,
        };
      }
      if (!canEditTargetAccess(record.run)) {
        return {
          value: { ok: false, error: { code: 'INVALID_STATE', message: 'A configuração de acesso não pode ser alterada no estado atual da execução.' } },
          save: false,
        };
      }
      const currentRevision = typeof record.run.input?.accessRevision === 'number' ? record.run.input.accessRevision : 0;
      if (body.expectedAccessRevision !== currentRevision) {
        return {
          value: { ok: false, error: { code: 'STALE_VERSION', message: 'A revisão da configuração de acesso mudou. Consulte a configuração atualizada antes de salvar novamente.' } },
          save: false,
        };
      }
      const currentStartUrl = typeof record.run.input?.startUrl === 'string' ? record.run.input.startUrl : null;
      if (record.run.status !== 'draft' && currentStartUrl !== null && currentStartUrl !== url.href) {
        return {
          value: { ok: false, error: { code: 'TARGET_IMMUTABLE', message: 'O endereço da aplicação testada não pode ser alterado após o início da preparação. Crie outra execução para testar outro alvo.' } },
          save: false,
        };
      }
      const hasExistingCredential = Boolean(record.targetCredential && record.run.input?.credentialRef === record.targetCredential.ref);
      if (body.credential === undefined && !hasExistingCredential) {
        return {
          value: { ok: false, error: { code: 'INVALID_INPUT', message: 'Informe a credencial de teste para o primeiro cadastro de acesso.' } },
          save: false,
        };
      }
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
      record.run.input.accessRevision = currentRevision + 1;

      return {
        value: { ok: true, targetAccess: publicTargetAccess(record.run, true) },
        save: true,
      };
    });
  } catch (error) {
    if (error instanceof StorageError) {
      return { ok: false, error: { code: error.code === 'RUN_NOT_FOUND' ? 'RUN_NOT_FOUND' : 'STORAGE_FAILURE', message: error.message } };
    }
    return { ok: false, error: { code: 'STORAGE_FAILURE', message: 'Não foi possível concluir a operação no armazenamento.' } };
  }
}
