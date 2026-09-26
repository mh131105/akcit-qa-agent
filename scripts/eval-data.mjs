import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

/** Nunca recebe DATA_DIR nem remove diretórios fornecidos pelo operador. */
export function createEvaluationDirectory() {
  return mkdtemp(join(tmpdir(), 'akcit-eval-private-'));
}

/** Falhas conservam os dados privados para diagnóstico, inclusive antes da exportação. */
export async function finishEvaluationDirectory(directory, succeeded) {
  if (!succeeded) return;
  await rm(directory, { recursive: true, force: true });
}

/** Fixture separada: acrescenta somente um prefixo de transições já observadas. */
export function mappingWithObservedPrefix(mapping, selection) {
  const copy = structuredClone(mapping);
  if (!selection?.observedPrefix) return copy;
  const { sourcePathId, transitionCount } = selection.observedPrefix;
  const source = copy.payload.map.paths.find(path => path.id === sourcePathId);
  assert.ok(source, 'O caminho de origem do prefixo precisa existir no mapa observado.');
  assert.ok(Number.isSafeInteger(transitionCount) && transitionCount > 0 && transitionCount < source.transitionIds.length,
    'O prefixo precisa conservar pelo menos uma transição e terminar antes do caminho completo.');
  assert.ok(typeof selection.pathId === 'string' && selection.pathId.trim() &&
    !copy.payload.map.paths.some(path => path.id === selection.pathId), 'O ID do prefixo deve ser novo.');
  copy.payload.map.paths.push({ id: selection.pathId, startScreenId: source.startScreenId,
    transitionIds: source.transitionIds.slice(0, transitionCount) });
  return copy;
}
