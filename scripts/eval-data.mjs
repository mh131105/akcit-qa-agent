import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Nunca recebe DATA_DIR nem remove diretórios fornecidos pelo operador. */
export function createEvaluationDirectory() {
  return mkdtemp(join(tmpdir(), 'akcit-eval-private-'));
}
