import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Nunca recebe DATA_DIR nem remove diretórios fornecidos pelo operador. */
export function createEvaluationDirectory() {
  return mkdtemp(join(tmpdir(), 'akcit-eval-private-'));
}

/** Falhas conservam os dados privados para diagnóstico, inclusive antes da exportação. */
export async function finishEvaluationDirectory(directory, succeeded) {
  if (!succeeded) return;
  await rm(directory, { recursive: true, force: true });
}
