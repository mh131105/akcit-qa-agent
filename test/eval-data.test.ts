import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEvaluationDirectory, finishEvaluationDirectory } from '../scripts/eval-data.mjs';

test('ensaio cria diretórios exclusivos sem tocar o DATA_DIR da instância', async t => {
  const instance = await mkdtemp(join(tmpdir(), 'akcit-instance-test-'));
  const marker = join(instance, 'confirmed-data.txt');
  await writeFile(marker, 'preservar');
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = instance;
  t.after(() => { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
  const first = await createEvaluationDirectory(), second = await createEvaluationDirectory();
  t.after(async () => { for (const directory of [instance, first, second]) await rm(directory, { recursive: true, force: true }); });
  assert.notEqual(first, second); assert.notEqual(first, instance);
  assert.equal((await stat(first)).mode & 0o777, 0o700);
  await rm(first, { recursive: true });
  assert.equal(await readFile(marker, 'utf8'), 'preservar');
});

test('ensaio preserva saídas privadas em falha e limpa somente após sucesso', async t => {
  const directory = await createEvaluationDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const record = join(directory, 'record.json');
  await writeFile(record, JSON.stringify({ outputs: ['saída'], calls: ['chamada'], validations: ['parecer'] }));
  await finishEvaluationDirectory(directory, false);
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), { outputs: ['saída'], calls: ['chamada'], validations: ['parecer'] });
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  await finishEvaluationDirectory(directory, true);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
});
