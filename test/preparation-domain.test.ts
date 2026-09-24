import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eligibleRequirements, InvalidPreparationOutput, parseCuration, parsePlan, parseVerdict,
  type CurationPayload, type PlanPayload,
} from '../src/domain/preparation.js';

const artifacts = [{ id: 'artifact-1', name: 'Sintético', version: '1', text:
  'Reservar itens.\nQuantidade inteira de 1 a 10, inclusive.\nComentário opcional.\nExportar reservas.\nFormato não definido.' }];
const source = (line: number) => ({ artifactId: 'artifact-1', locator: `L${line}`, quote: artifacts[0]!.text.split('\n')[line - 1]! });
const curation = (): CurationPayload => ({
  requirements: [
    { id: 'US-01', statement: 'Reservar itens.', sources: [source(1)], rules: [
      { id: 'CA-01', statement: 'Quantidade inteira de 1 a 10, inclusive.', sources: [source(2)] },
      { id: 'CA-02', statement: 'Comentário opcional.', sources: [source(3)] },
    ] },
    { id: 'US-02', statement: 'Exportar reservas.', sources: [source(4)], rules: [] },
  ],
  questions: [{ id: 'Q-01', description: 'Qual é o formato da exportação?', requirementIds: ['US-02'], caseIds: [], blocking: true, sources: [source(5)] }],
});
const plan = (): PlanPayload => ({ testPlan: {
  objective: 'Avaliar reservas', requirementIds: ['US-01'], ruleIds: ['CA-01', 'CA-02'],
  priorities: [{ ruleId: 'CA-01', reason: 'Restrições de quantidade' }],
  exclusions: [{ description: 'US-02 / Q-01: exportação pendente', reason: 'Formato não definido' }],
  approach: ['Partições e valores limite conforme CA-01; comentário ausente e presente conforme CA-02'],
  preconditions: ['Acesso autenticado antes da execução'], sources: [source(1), source(2), source(3)],
} });

test('preparação confere citações e referências, mantendo requisitos independentes elegíveis', () => {
  const parsed = parseCuration(curation(), artifacts);
  assert.deepEqual(eligibleRequirements(parsed).map(item => item.id), ['US-01']);
  assert.deepEqual(parsePlan(plan(), artifacts, parsed), plan());

  const wrongQuote = curation();
  wrongQuote.requirements[0]!.rules[0]!.sources[0]!.quote = 'Quantidade inteira de 1 a 11, inclusive.';
  assert.throws(() => parseCuration(wrongQuote, artifacts), InvalidPreparationOutput);
  const wrongLocation = curation();
  wrongLocation.requirements[0]!.rules[0]!.sources[0]!.locator = 'L3';
  assert.throws(() => parseCuration(wrongLocation, artifacts), InvalidPreparationOutput);
  const wrongReference = curation();
  wrongReference.questions[0]!.requirementIds = ['US-ausente'];
  assert.throws(() => parseCuration(wrongReference, artifacts), InvalidPreparationOutput);
  const duplicate = curation();
  duplicate.requirements[1]!.id = 'CA-01';
  assert.throws(() => parseCuration(duplicate, artifacts), InvalidPreparationOutput);
  const blockedPlan = plan();
  blockedPlan.testPlan.requirementIds.push('US-02');
  assert.throws(() => parsePlan(blockedPlan, artifacts, parsed), InvalidPreparationOutput);
  const unrelatedRule = plan();
  unrelatedRule.testPlan.ruleIds.push('CA-ausente');
  assert.throws(() => parsePlan(unrelatedRule, artifacts, parsed), InvalidPreparationOutput);
});

test('preparação preserva insuficiência real sem inventar US e limita escopo', () => {
  const insufficient = { requirements: [], questions: [{ id: 'Q-01', description: 'Informe US e CA', requirementIds: [], caseIds: [], blocking: true, sources: [source(5)] }] };
  assert.deepEqual(eligibleRequirements(parseCuration(insufficient, artifacts)), []);
  assert.throws(() => parseCuration({ requirements: [], questions: [] }, artifacts), InvalidPreparationOutput);
  const noQuestion = curation();
  noQuestion.questions = [];
  assert.throws(() => parseCuration(noQuestion, artifacts), InvalidPreparationOutput);
  const globalQuestion = curation();
  globalQuestion.questions[0]!.requirementIds = [];
  assert.throws(() => parseCuration(globalQuestion, artifacts), InvalidPreparationOutput);
  const excess = curation();
  excess.requirements = Array.from({ length: 11 }, (_, i) => ({
    id: `US-${i}`, statement: 'Reservar itens.', sources: [source(1)], rules: [],
  }));
  assert.throws(() => parseCuration(excess, artifacts), (error: unknown) =>
    error instanceof InvalidPreparationOutput && error.code === 'INPUT_LIMIT');
});

test('fronteira estrutural rejeita metadados do modelo e exige justificativa/achados nos pareceres', () => {
  assert.throws(() => parseCuration({ ...curation(), revision: 1 }, artifacts), InvalidPreparationOutput);
  assert.throws(() => parsePlan({ ...plan(), producer: 'test-designer' }, artifacts, curation()), InvalidPreparationOutput);
  assert.throws(() => parseVerdict({ status: 'approved', findings: [], reason: '' }), InvalidPreparationOutput);
  assert.throws(() => parseVerdict({ status: 'changes_requested', findings: [], reason: 'Alterar limite' }), InvalidPreparationOutput);
  assert.throws(() => parseVerdict({ status: 'error', findings: [], reason: 'Falha' }), InvalidPreparationOutput);
  assert.throws(() => parseVerdict({ status: 'approved', findings: [], reason: 'OK', outputRevision: 1 }), InvalidPreparationOutput);
  assert.deepEqual(parseVerdict({ status: 'blocked', findings: [{ code: 'MISSING_RULE', message: 'Falta CA', location: null }], reason: 'Critério ausente' }).status, 'blocked');
  // Citação literal correta não prova fidelidade semântica: a revisão independente
  // deve detectar a mudança deliberada de 10 para 11 no conteúdo, mesmo com fonte válida.
  const semanticallyWrong = curation();
  semanticallyWrong.requirements[0]!.rules[0]!.statement = 'Quantidade inteira de 1 a 11, inclusive.';
  assert.equal(parseCuration(semanticallyWrong, artifacts).requirements[0]!.rules[0]!.statement, 'Quantidade inteira de 1 a 11, inclusive.');
  semanticallyWrong.requirements[0]!.rules[1]!.statement = 'Comentário obrigatório.';
  assert.equal(parseCuration(semanticallyWrong, artifacts).requirements[0]!.rules[1]!.statement, 'Comentário obrigatório.');
});

test('uma pergunta pode bloquear somente uma regra, sem remover o restante da mesma história', () => {
  const partial = curation();
  partial.questions.push({ id: 'Q-02', description: 'Esclareça o comentário.', requirementIds: ['US-01'],
    ruleIds: ['CA-02'], caseIds: [], blocking: true, sources: [source(3)] });
  const parsed = parseCuration(partial, artifacts);
  const eligible = eligibleRequirements(parsed);
  assert.deepEqual(eligible.map(item => [item.id, item.rules.map(rule => rule.id)]), [['US-01', ['CA-01']]]);
  assert.equal(parsed.requirements[0]!.rules.length, 2);
  assert.throws(() => parsePlan(plan(), artifacts, parsed), InvalidPreparationOutput);
  const partialPlan = plan();
  partialPlan.testPlan.ruleIds = ['CA-01'];
  partialPlan.testPlan.exclusions.push({ description: 'CA-02 / Q-02', reason: 'Esclarecimento pendente.' });
  assert.deepEqual(parsePlan(partialPlan, artifacts, parsed), partialPlan);

  partial.questions[1]!.ruleIds = [];
  assert.deepEqual(eligibleRequirements(parseCuration(partial, artifacts)), []);
  partial.questions[1]!.ruleIds = ['CA-02'];
  partial.questions[1]!.blocking = false;
  assert.equal(eligibleRequirements(parseCuration(partial, artifacts))[0]!.rules.length, 2);
  partial.questions[1]!.requirementIds = ['US-02'];
  assert.throws(() => parseCuration(partial, artifacts), InvalidPreparationOutput);
  partial.questions[1]!.requirementIds = ['US-01'];
  partial.questions[1]!.ruleIds = ['CA-ausente'];
  assert.throws(() => parseCuration(partial, artifacts), InvalidPreparationOutput);
});

test('exemplos recebidos preservam condições e ordem sem serem confundidos com regras gerais', () => {
  const exampleArtifact = { id: 'example-artifact', name: 'Critérios', version: '1', text:
    'Reservar itens.\nDado que estou autenticado\nQuando confirmo 10 itens\nEntão aparece "Criado"\nE vejo minha reserva' };
  const reference = { artifactId: exampleArtifact.id, locator: 'L2-L5', quote: exampleArtifact.text.split('\n').slice(1).join('\n') };
  const input: CurationPayload = { requirements: [{ id: 'RF-1', statement: 'Reservar itens.', sources: [reference],
    rules: [{ id: 'EX-1', kind: 'example', statement: 'Ao reservar 10 itens autenticado, aparece "Criado" e vejo minha reserva.', sources: [reference],
      examples: [{ id: 'SC-1', given: ['Estou autenticado'], when: ['Confirmo 10 itens'], then: ['Aparece "Criado"', 'Vejo minha reserva'], sources: [reference] }] }],
  }], questions: [] };
  assert.deepEqual(parseCuration(input, [exampleArtifact]), input);
  assert.equal(eligibleRequirements(input)[0]!.rules[0]!.kind, 'example');
  const badKind = structuredClone(input);
  Object.assign(badKind.requirements[0]!.rules[0]!, { kind: 'proposal' });
  assert.throws(() => parseCuration(badKind, [exampleArtifact]), InvalidPreparationOutput);
  const badId = structuredClone(input);
  badId.requirements[0]!.rules[0]!.examples![0]!.id = 'EX-1';
  assert.throws(() => parseCuration(badId, [exampleArtifact]), InvalidPreparationOutput);
  const badQuote = structuredClone(input);
  badQuote.requirements[0]!.rules[0]!.examples![0]!.sources[0]!.quote = 'Limite máximo de 10 itens';
  assert.throws(() => parseCuration(badQuote, [exampleArtifact]), InvalidPreparationOutput);
  const noOutcome = structuredClone(input);
  noOutcome.requirements[0]!.rules[0]!.examples![0]!.then = [];
  assert.throws(() => parseCuration(noOutcome, [exampleArtifact]), InvalidPreparationOutput);
  const unexpected = structuredClone(input);
  Object.assign(unexpected.requirements[0]!.rules[0]!.examples![0]!, { observed: true });
  assert.throws(() => parseCuration(unexpected, [exampleArtifact]), InvalidPreparationOutput);
  const invalidOptional = structuredClone(input);
  Object.assign(invalidOptional.requirements[0]!.rules[0]!, { examples: null });
  assert.throws(() => parseCuration(invalidOptional, [exampleArtifact]), InvalidPreparationOutput);
});
