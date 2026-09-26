import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfig, resolvePreparationModels } from '../dist/config.js';
import { executeSpecialistTask, preflightSpecialists } from '../dist/runtime/pi.js';
import { parseCuration, parsePlan, parseVerdict } from '../dist/domain/preparation.js';

// Avaliação explícita, com inferência real. Nunca é parte de npm test ou do servidor.
assert.equal(process.versions.node.split('.')[0], '24');
assert.ok(process.argv.includes('--run'), 'Inferência real: use --run depois de configurar privadamente .env.');
const base = '638ab7de3a8e49a70775b3a5a7fd48f54f0cdaaa';
const root = resolve('.data', `skills-eval-${Date.now()}`);
const baselineRoot = join(root, 'baseline');
const config = readConfig();
const models = resolvePreparationModels(config);
const roles = { 'artifact-curator': 'curate-artifacts', 'test-designer': 'create-test-plan', 'output-validator': 'validate-output' };
const sha = text => createHash('sha256').update(text).digest('hex');
const json = async (path, value) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); };
const skillHashes = { old_skill: {}, with_skill: {} };
for (const [role, name] of Object.entries(roles)) {
  const path = `agents/${role}/skills/${name}/SKILL.md`;
  const old = execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' });
  const current = await readFile(path, 'utf8');
  const destination = join(baselineRoot, path);
  await mkdir(resolve(destination, '..'), { recursive: true }); await writeFile(destination, old);
  skillHashes.old_skill[role] = sha(old); skillHashes.with_skill[role] = sha(current);
}
// Mesmo runtime nos dois braços; somente o diretório das skills muda. Sem opção
// de trocar prompts na API de produção nem alterações no checkout em execução.
const runtime = await readFile('dist/runtime/pi.js', 'utf8');
await mkdir(join(baselineRoot, 'dist/runtime'), { recursive: true });
await writeFile(join(baselineRoot, 'dist/runtime/pi.js'), runtime);
const oldExecute = (await import(pathToFileURL(join(baselineRoot, 'dist/runtime/pi.js')).href)).executeSpecialistTask;
await preflightSpecialists(models, config.piAuthPath);
const fixtures = JSON.parse(await readFile('test/fixtures/preparation-inputs.json', 'utf8'));
const demo = JSON.parse(await readFile('docs/evidencias/t4.1/preparacao-real.json', 'utf8'));
const curation = demo.outputs.find(output => output.phase === 'curation');
const concise = demo.outputs.find(output => output.phase === 'planning' && output.revision === 1);
const altered = structuredClone(curation);
altered.payload.requirements[0].rules[0].statement = altered.payload.requirements[0].rules[0].statement.replace('1 e 10', '1 e 11');
const common = { artifacts: demo.artifacts, objective: '', answers: [] };
const cases = fixtures.map(item => ({
  id: item.id, role: 'artifact-curator', expected: item.expected,
  input: { task: 'curation', artifacts: [{ id: 'artifact-1', name: 'material.txt', version: '1', text: item.text }], objective: '', answers: [], previousOutput: null, feedback: null },
}));
cases.push(
  { id: 'plano-conciso', role: 'test-designer', expected: 'Cobrir as duas regras, sem percurso ou casos detalhados; plano proporcional e fiel.', input: { task: 'planning', ...common, approvedCuration: curation, previousOutput: null, feedback: null } },
  { id: 'validar-plano-correto', role: 'output-validator', expected: 'Aprovar o plano correto mesmo sem recitação dos agentes e das validações internas.', input: { task: 'validation', ...common, approvedCuration: curation, output: concise, previousVerdicts: [] } },
  { id: 'rejeitar-limite-adulterado', role: 'output-validator', expected: 'Detectar limite 11 divergente da fonte 10; não aprovar.', input: { task: 'validation', ...common, output: altered, previousVerdicts: [] } },
);
const results = [];
console.log(JSON.stringify({ directory: root, cases: cases.length, calls: cases.length * 2 }));
for (const [index, item] of cases.entries()) {
  const directory = join(root, `eval-${index}-${item.id}`);
  await json(join(directory, 'eval_metadata.json'), { eval_id: index, eval_name: item.id, prompt: JSON.stringify(item.input), assertions: [item.expected] });
  await Promise.all([['old_skill', oldExecute], ['with_skill', executeSpecialistTask]].map(async ([variant, execute]) => {
    const runDirectory = join(directory, variant, 'run-1');
    await json(join(runDirectory, 'eval_metadata.json'), { eval_id: index, eval_name: item.id, prompt: JSON.stringify(item.input), assertions: [item.expected] });
    const entry = { id: item.id, variant, role: item.role, input: item.input };
    try {
      const result = await execute({ role: item.role, model: models[item.role], authPath: config.piAuthPath,
        signal: new AbortController().signal, timeoutMs: 120000, prompt: JSON.stringify(item.input) });
      Object.assign(entry, result);
      try {
        if (item.role === 'artifact-curator') parseCuration(result.payload, item.input.artifacts);
        else if (item.role === 'test-designer') parsePlan(result.payload, item.input.artifacts, curation.payload);
        else parseVerdict(result.payload);
        entry.structural = 'passed';
      } catch (error) { entry.structural = error.code || 'invalid'; }
    } catch (error) { entry.error = error.code || 'EVALUATION_FAILED'; entry.metadata = error.metadata; }
    results.push(entry);
    await json(join(runDirectory, 'outputs/result.json'), entry);
    await json(join(runDirectory, 'timing.json'), { total_tokens: entry.metadata?.usage?.totalTokens, duration_ms: entry.metadata?.durationMs, total_duration_seconds: (entry.metadata?.durationMs ?? 0) / 1000 });
    console.log(JSON.stringify({ id: item.id, variant, structural: entry.structural, error: entry.error, tokens: entry.metadata?.usage?.totalTokens }));
  }));
}
await json(join(root, 'results.json'), { synthetic: true, baselineCommit: base, runtimeSha256: sha(runtime), skillHashes, models, recordedAt: new Date().toISOString(), results });
console.log(JSON.stringify({ completed: root, calls: results.length }));
