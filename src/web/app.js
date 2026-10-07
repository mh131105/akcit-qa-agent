'use strict';

const main = document.querySelector('#main');
const account = document.querySelector('#account');
const storagePrefix = 'akcit.intake.v1:';
const limit = 16 * 1024;
const statuses = { draft: 'Rascunho', running: 'Em andamento', awaiting_approval: 'Aguardando aprovação', awaiting_input: 'Aguardando informações', ready: 'Etapa validada', completed: 'Concluída', interrupted: 'Interrompida', error: 'Erro', cancelled: 'Cancelada' };
const phases = { intake: 'Recebimento do material', curation: 'Curadoria', planning: 'Planejamento', case_design: 'Criação dos casos', mapping: 'Mapeamento', route_detail: 'Detalhamento dos percursos', execution: 'Execução dos testes', report: 'Relatório', done: 'Processo concluído' };
const validations = { approved: 'Validação automática aprovada', changes_requested: 'Validação solicitou ajustes', blocked: 'Validação bloqueada', error: 'Erro de validação' };
const roles = { 'artifact-curator': 'Curador', 'test-designer': 'Designer de testes', 'output-validator': 'Validador independente', 'test-executor': 'Executor de testes', 'report-writer': 'Redator' };
const toolNames = { observe_screen: 'Captura de tela', pointer: 'Clique e movimento', keyboard_scroll: 'Teclado e rolagem', fill_credential: 'Preenchimento do acesso' };
const actionOutcomes = { ok: 'Concluído', completed: 'Concluído', error: 'Falhou', cancelled: 'Cancelado', interrupted: 'Interrompido' };
const activities = { curating: 'Organizando requisitos e fontes', planning: 'Elaborando o plano de testes', validating_curation: 'Revisando a curadoria', validating_planning: 'Revisando o plano de testes', case_design: 'Gerando casos de teste', validating_case_design: 'Validando os casos de teste', mapping: 'Mapeando a aplicação', validating_mapping: 'Validando o mapa de navegação', route_detail: 'Associando percursos aos casos aprovados', validating_route_detail: 'Validando as associações de percursos', execution: 'Executando os casos pela interface', validating_execution: 'Validando as evidências do caso', report: 'Redigindo o relatório', validating_report: 'Validando o relatório', analyzing_feedback: 'Analisando as alterações solicitadas' };
let user = null;
let rememberForm = null;
let sessionTimer;
let checkingSession = null;
let signedOut = false;
let detailTimer;
let detailSequence = 0;
let evidenceRunId = null;
const answerDrafts = new Map();
// URLs blob: das capturas; revogadas ao sair da execução para não reter dados privados.
const evidenceUrls = new Set();
function revokeEvidence() { for (const url of evidenceUrls) URL.revokeObjectURL(url); evidenceUrls.clear(); }
async function evidenceUrl(runId, assetId, accountId) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(assetId)}`, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { 'X-Expected-User-Id': accountId },
  });
  if (!response.ok) throw new Error('Evidência indisponível.');
  const url = URL.createObjectURL(await response.blob());
  evidenceUrls.add(url);
  return url;
}

// Dados da API entram somente como texto. Nenhum conteúdo recebido vira HTML.
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = /^(h[1-6]|summary)$/.test(tag) ? String(text).replace(/^\p{L}/u, letter => letter.toLocaleUpperCase('pt-BR')) : text;
  if (className) node.className = className;
  return node;
}
function link(text, href, className) { const node = el('a', text, className); node.href = href; return node; }
function button(text, action, className) {
  const node = el('button', text, className); node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}
function message(text = '', error = false) {
  const node = el('div', text, `message${error ? ' error' : ''}`);
  node.setAttribute('role', error ? 'alert' : 'status'); return node;
}
function tell(node, text, error = false) {
  node.className = `message${error ? ' error' : ''}`;
  node.setAttribute('role', error ? 'alert' : 'status'); node.textContent = text;
}
function heading(title, subtitle, action) {
  document.title = `${title} · QAtron`;
  const header = el('div', null, 'page-heading'); const copy = el('div');
  copy.append(el('h1', title));
  if (subtitle) copy.append(el('p', subtitle, 'lead'));
  header.append(copy); if (action) header.append(action); main.append(header);
}
function field(form, name, label, options = {}) {
  const wrapper = el('div', null, 'field'); const labelNode = el('label', label);
  labelNode.htmlFor = name;
  const input = el(options.textarea ? 'textarea' : 'input'); input.id = name; input.name = name;
  if (!options.textarea) input.type = options.type || 'text';
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  input.required = !options.optional;
  if (options.className) input.className = options.className;
  const error = el('span', '', 'field-error'); error.id = `${name}-error`;
  const hint = el('small', options.hint || ''); hint.id = `${name}-hint`;
  input.setAttribute('aria-describedby', `${hint.id} ${error.id}`);
  wrapper.append(labelNode, input, hint, error); form.append(wrapper);
  return { input, error };
}
function checkboxField(form, name, label, options = {}) {
  const wrapper = el('div', null, 'field checkbox-field');
  const labelNode = el('label');
  const input = el('input');
  input.type = 'checkbox';
  input.id = name;
  input.name = name;
  input.required = !options.optional;
  labelNode.append(input, document.createTextNode(' ' + label));
  const hint = el('small', options.hint || '');
  hint.id = `${name}-hint`;
  const error = el('span', '', 'field-error');
  error.id = `${name}-error`;
  input.setAttribute('aria-describedby', `${hint.id} ${error.id}`);
  wrapper.append(labelNode, hint, error);
  form.append(wrapper);
  return { input, error };
}
function invalid(fieldRef, text) {
  fieldRef.error.textContent = text; fieldRef.input.setAttribute('aria-invalid', String(!!text));
  return !!text;
}
const count = value => [...value].length;
const passwordHint = 'De 8 a 128 caracteres, com pelo menos uma letra maiúscula, um número e um caractere especial.';
const validNewPassword = value => count(value) >= 8 && count(value) <= 128 && /\p{Lu}/u.test(value) && /[0-9]/.test(value) && /[\p{P}\p{S}]/u.test(value);
const bytes = value => new TextEncoder().encode(value).byteLength;
const date = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const internal = value => /^\/execucoes(?:\/(?:nova|[A-Za-z0-9][A-Za-z0-9_-]{0,127}))?(?:\?[^#]*)?(?:#(?:visao-geral|plano|casos|mapa|resultados))?$/.test(value || '') ? value : '/execucoes';
const target = () => internal(new URLSearchParams(location.search).get('next'));

function errorText(error) {
  const texts = {
    INVALID_CREDENTIALS: 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
    INVALID_PASSWORD: passwordHint,
    ACCOUNT_EXISTS: 'Este e-mail já tem uma conta. Use Entrar para continuar.',
    TOO_MANY_ATTEMPTS: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.',
    ORIGIN_REJECTED: 'Não foi possível enviar esta solicitação. Atualize a página e tente novamente.',
    AUTH_NOT_CONFIGURED: 'O acesso está temporariamente indisponível. Tente novamente mais tarde.',
    INVALID_INPUT: 'Confira os campos e seus limites antes de tentar novamente.',
    BODY_TOO_LARGE: 'O conteúdo informado excede o limite. Reduza o texto e tente novamente.',
    INVALID_UPLOAD: 'Arquivo inválido. Envie .txt ou .md em UTF-8, ou PDF com texto selecionável.',
    FILE_TOO_LARGE: 'Cada arquivo deve ter até 10 MiB. Reduza o arquivo e tente novamente.',
    FILE_LIMIT: 'Selecione no máximo cinco arquivos.',
    PDF_WITHOUT_TEXT: 'O PDF não contém texto selecionável. Envie um arquivo .txt, .md ou um PDF com texto.',
    PDF_EXTRACTION_FAILED: 'Não foi possível ler o PDF. Confira se o arquivo é válido e não tem senha.',
    EMPTY_FILE: 'O arquivo está vazio. Envie um arquivo com requisitos.',
    RUN_ACTIVE: 'Encerre a execução e aguarde o término do trabalho antes de excluir.',
    INPUT_LIMIT: 'Selecione até dez requisitos. Reduza explicitamente o material e crie uma nova execução.',
    CASE_LIMIT: 'O conjunto excede trinta casos. Reduza o escopo em um novo plano; nenhum caso foi cortado.',
    CONTEXT_LIMIT: 'O material é extenso demais para esta execução. Reduza o conteúdo ou divida-o em execuções.',
    COMMENT_REQUIRED: 'Informe um comentário para solicitar alterações.',
    STALE_VERSION: 'Esta revisão mudou. Consulte a versão atual antes de decidir novamente.',
    DECISION_CONFLICT: 'Esta revisão já possui uma decisão diferente. Consulte a decisão salva.',
    DECISION_MISSING: 'Aprove a revisão vigente do plano antes de gerar os casos de teste.',
    INVALID_STATE: 'A execução não permite esta operação no estado atual. Consulte o estado atualizado.',
    INSUFFICIENT_VALIDATION: 'O plano e a curadoria precisam de validação aprovada. A decisão foi recusada.',
    IDEMPOTENCY_CONFLICT: 'Este salvamento não corresponde ao conteúdo atual. Consulte a execução salva antes de tentar novamente.',
    RUN_NOT_FOUND: 'Execução não encontrada ou indisponível para esta conta.',
    RESOURCE_UNAVAILABLE: 'O ambiente está ocupado com outra execução. O material e as decisões foram preservados; tente novamente após a conclusão.',
    MODEL_NOT_CONFIGURED: 'Não foi possível iniciar o processamento. Tente novamente mais tarde.',
    MODEL_UNAVAILABLE: 'O processamento está temporariamente indisponível. Tente novamente mais tarde.',
    CREDENTIAL_UNAVAILABLE: 'Não foi possível iniciar o processamento. Tente novamente mais tarde.',
    MODEL_ERROR: 'Não foi possível concluir o processamento. Os registros confirmados foram preservados.',
    INVALID_OUTPUT: 'Não foi possível validar o resultado desta etapa. Os registros confirmados foram preservados.',
    INVALID_MODEL_OUTPUT: 'Não foi possível validar o resultado desta etapa. Os registros confirmados foram preservados.',
    STORAGE_FAILURE: 'Não foi possível acessar os dados da execução. Tente novamente mais tarde.',
    TIMEOUT: 'O processamento excedeu o tempo disponível. Os registros confirmados foram preservados.',
    ANSWER_CONFLICT: 'Esta pergunta já possui outra resposta. Consulte a resposta registrada.',
    QUESTION_NOT_FOUND: 'A pergunta não está disponível nesta revisão. Consulte o material atualizado.',
    ACTIVE_LIMIT: 'Esta execução atingiu o limite de processamento ativo. As respostas e os resultados salvos estão preservados.',
    ACCESS_NOT_CONFIGURED: 'Configure o endereço, a autorização e a credencial de teste antes do mapeamento.',
    DECISION_MISSING: 'Aprove a revisão vigente antes de continuar.',
    MAPPING_BLOCKED: 'O mapeamento foi interrompido por um impedimento. Consulte as pendências e limitações do mapa.',
    CREDENTIAL_REJECTED: 'O login da aplicação testada não foi confirmado. Corrija a credencial de teste e solicite uma nova tentativa.',
    VALIDATOR_LIMIT: 'Não foi possível concluir a revisão automática. Os registros salvos foram preservados.',
    REVISION_LIMIT: 'O limite de revisões desta etapa foi esgotado. Os registros salvos estão preservados.',
    TARGET_NOT_ALLOWED: 'Este endereço não está autorizado para testes.',
    AUTHORIZED_TARGET_REQUIRED: 'Confirme a autorização para testar a aplicação.',
    INVALID_URL: 'Informe um endereço HTTP ou HTTPS autorizado, sem parâmetros após “?” ou “#”.',
    TARGET_IMMUTABLE: 'O endereço da aplicação não pode ser alterado após o início da preparação. Trocar o alvo exige outra execução.',
  };
  return texts[error.code] || (error.status === 409 ? 'O registro não permite esta operação. Atualize a página e consulte a situação da execução.' : 'Não foi possível concluir a solicitação. Verifique a conexão e tente novamente.');
}
async function api(path, { accountId, ...options } = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), ...options,
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(accountId ? { 'X-Expected-User-Id': accountId } : {}), ...options.headers } });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    const error = Object.assign(new Error(data.error?.message), { status: response.status, code: data.error?.code });
    if (['INVALID_SESSION', 'ACCOUNT_CHANGED'].includes(error.code) && location.pathname !== '/acesso') expire();
    throw error;
  }
  return data;
}
function expire() {
  if (signedOut) return;
  const hadSession = Boolean(user);
  if (rememberForm) rememberForm();
  revokeEvidence(); evidenceRunId = null;
  user = null; rememberForm = null; answerDrafts.clear(); clearInterval(sessionTimer); clearTimeout(detailTimer); detailSequence++;
  main.replaceChildren(); account.replaceChildren(); main.hidden = false;
  selectDetailTab = null;
  location.replace(`/acesso?${hadSession ? 'expired=1&' : ''}next=${encodeURIComponent(internal(location.pathname + location.search + location.hash))}`);
}
async function sameAccount(accountId = user?.id) {
  const session = await api('/auth/me');
  if (!user || session.user.id !== accountId) { expire(); throw new Error('Conta alterada.'); }
  return session.user;
}
function sessionCheck() {
  if (!user) return Promise.resolve();
  if (!checkingSession) checkingSession = sameAccount().catch(() => {
    // Em falha de verificação, retirar dados privados até reconfirmar a sessão.
    if (user) expire();
  }).finally(() => { checkingSession = null; });
  return checkingSession;
}
function readAttempt() {
  const raw = sessionStorage.getItem(storagePrefix + user.id);
  if (!raw) return null;
  const attempt = JSON.parse(raw);
  if (attempt.accountId !== user.id || typeof attempt.body !== 'string') throw new Error('Tentativa inválida.');
  const body = JSON.parse(attempt.body);
  if (!body || !['name', 'applicationName', 'objective', 'text'].every(key => typeof body[key] === 'string') ||
      Object.keys(body).length !== 4 || (attempt.key && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.key))) throw new Error('Tentativa inválida.');
  if (!attempt.key && attempt.kind !== 'draft') throw new Error('Tentativa inválida.');
  return attempt;
}
function saveAttempt(attempt) {
  const key = storagePrefix + attempt.accountId; const serialized = JSON.stringify(attempt);
  sessionStorage.setItem(key, serialized);
  if (sessionStorage.getItem(key) !== serialized) throw new Error('Armazenamento indisponível.');
}
function clearAttempts() {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i); if (key?.startsWith(storagePrefix)) sessionStorage.removeItem(key);
  }
}
function navigation() {
  const accountId = user.id;
  document.body.classList.add('authenticated');
  const workspace = el('div', null, 'workspace-links');
  for (const [label, path] of [['Minhas execuções', '/execucoes'], ['Nova execução', '/execucoes/nova']]) {
    const item = link(label, path);
    if (location.pathname === path || (path === '/execucoes' && /^\/execucoes\/(?!nova$)/.test(location.pathname))) item.setAttribute('aria-current', 'page');
    workspace.append(item);
  }
  const profile = el('div', null, 'account-profile');
  const profileLink = link('Meu perfil', '/perfil');
  if (location.pathname === '/perfil') profileLink.setAttribute('aria-current', 'page');
  profile.append(el('span', user.name, 'account-name'), profileLink);
  account.replaceChildren(workspace, profile);
  const exit = button('Sair', async () => {
    exit.disabled = true;
    try {
      if (await api('/auth/logout', { accountId, method: 'POST', body: '{}' }) !== null) throw new Error('Saída sem confirmação.');
    } catch {
      if (user) { main.prepend(message('Não foi possível confirmar a saída. Sua tentativa de salvamento foi preservada.', true)); exit.disabled = false; }
      return;
    }
    // O 204 encerrou a sessão, mesmo se a limpeza local falhar. pagehide não deve regravar o formulário.
    signedOut = true; rememberForm = null; answerDrafts.clear(); clearInterval(sessionTimer); clearTimeout(detailTimer); detailSequence++; user = null;
    main.replaceChildren(); account.replaceChildren();
    let cleanupFailed = false;
    try { clearAttempts(); } catch { cleanupFailed = true; }
    location.replace(cleanupFailed ? '/acesso?cleanup=1' : '/acesso');
  }, 'secondary'); profile.append(exit);
}

function access(serviceMessage = '') {
  main.replaceChildren(); document.title = 'Acesso · QAtron';
  const layout = el('div', null, 'auth-layout'); const story = el('section', null, 'auth-story');
  const title = el('h1', 'Bons testes começam '); title.append(el('span', 'com clareza.'));
  story.append(el('p', 'Qualidade, com contexto', 'eyebrow'), title, el('p', 'Do primeiro requisito à evidência final, acompanhe cada etapa e decida quando avançar.', 'lead'));
  const visual = el('div', null, 'auth-visual'); const emblem = el('div', null, 'auth-emblem');
  const mark = el('img', null, 'auth-monogram'); mark.src = '/web/qatron-mark.png'; mark.alt = ''; mark.width = 112; mark.height = 112;
  emblem.append(mark);
  const steps = el('ol', null, 'auth-steps');
  for (const [number, label, detail] of [['01', 'Requisitos', 'O contexto vem primeiro'], ['02', 'Plano de teste', 'Sua revisão orienta o caminho'], ['03', 'Evidências', 'Cada decisão tem uma base']]) {
    const step = el('li'); const copy = el('div'); copy.append(el('strong', label), el('span', detail));
    step.append(el('span', number, 'auth-step-number'), copy); steps.append(step);
  }
  visual.append(emblem, steps); story.append(visual);
  const panel = el('section', null, 'panel auth-panel'); layout.append(story, panel); main.append(layout);
  let register = false; let email = '';
  const render = () => {
    panel.replaceChildren(); const tabs = el('div', null, 'auth-switch');
    for (const [label, value] of [['Entrar', false], ['Criar conta', true]]) {
      const tab = button(label, () => {
        if (register === value) return;
        email = panel.querySelector('#email').value;
        register = value; render(); panel.querySelector('input').focus();
      }, 'secondary');
      tab.setAttribute('aria-pressed', String(register === value)); tabs.append(tab);
    }
    panel.append(tabs, el('h2', register ? 'Crie sua conta' : 'Bem-vindo de volta'), el('p', register ? 'Crie sua conta para organizar testes e acompanhar decisões.' : 'Entre para retomar suas execuções e acompanhar os próximos passos.', 'auth-intro'));
    const cleanupMessage = new URLSearchParams(location.search).has('cleanup') ? 'Saída confirmada, mas não foi possível limpar a recuperação local desta aba. Feche a aba ou limpe o armazenamento do navegador.' : '';
    const notice = message(cleanupMessage || serviceMessage || (new URLSearchParams(location.search).has('expired') ? 'Sua sessão expirou ou mudou. Entre novamente. Conteúdo pendente só será recuperado para a mesma conta.' : ''), !!serviceMessage || !!cleanupMessage); panel.append(notice);
    const form = el('form'); form.noValidate = true; const fields = {};
    if (register) fields.name = field(form, 'name', 'Nome', { autocomplete: 'name', hint: 'Até 120 caracteres.' });
    fields.email = field(form, 'email', 'E-mail', { type: 'email', autocomplete: 'username' });
    fields.email.input.value = email; fields.email.input.placeholder = 'voce@equipe.com.br'; fields.email.input.spellcheck = false; fields.email.input.autocapitalize = 'none';
    fields.password = field(form, 'password', 'Senha', { type: 'password', autocomplete: register ? 'new-password' : 'current-password', hint: register ? passwordHint : '' });
    const passwordControl = el('div', null, 'password-control'); fields.password.input.before(passwordControl); passwordControl.append(fields.password.input);
    const reveal = button('Mostrar', () => {
      const visible = fields.password.input.type === 'password'; fields.password.input.type = visible ? 'text' : 'password';
      reveal.textContent = visible ? 'Ocultar' : 'Mostrar'; reveal.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha'); reveal.setAttribute('aria-pressed', String(visible));
    }, 'password-reveal secondary');
    reveal.setAttribute('aria-label', 'Mostrar senha'); reveal.setAttribute('aria-pressed', 'false'); reveal.setAttribute('aria-controls', 'password'); passwordControl.append(reveal);
    if (register) fields.teamName = field(form, 'teamName', 'Nome da equipe (opcional)', { optional: true, autocomplete: 'organization', hint: 'Até 120 caracteres.' });
    const submit = button(register ? 'Cadastrar e entrar' : 'Entrar na conta', null, 'auth-submit'); submit.type = 'submit'; form.append(submit);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submit.disabled) return; let first;
      for (const [name, ref] of Object.entries(fields)) {
        const value = ref.input.value; let problem = '';
        if (name === 'password') problem = register ? (validNewPassword(value) ? '' : passwordHint)
          : !value ? 'Informe sua senha.' : count(value) > 128 ? 'Use até 128 caracteres.' : '';
        if (name === 'email' && (!ref.input.validity.valid || count(value.trim()) > 254)) problem = 'Informe um e-mail válido.';
        if (['name', 'teamName'].includes(name) && ((name === 'name' && !value.trim()) || count(value.trim()) > 120)) problem = 'Informe até 120 caracteres; nome é obrigatório.';
        if (invalid(ref, problem) && !first) first = ref.input;
      }
      if (first) { first.focus(); return; }
      const body = { email: fields.email.input.value.trim(), password: fields.password.input.value };
      if (register) { body.name = fields.name.input.value.trim(); if (fields.teamName.input.value.trim()) body.teamName = fields.teamName.input.value.trim(); }
      submit.disabled = true; submit.setAttribute('aria-busy', 'true'); tabs.querySelectorAll('button').forEach(node => { node.disabled = true; }); tell(notice, 'Conferindo seu acesso…');
      try {
        await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
        fields.password.input.value = ''; await api('/auth/me'); location.replace(target());
      } catch (error) {
        if (register && error.code === 'INVALID_PASSWORD') { tell(notice, 'Confira a senha para criar sua conta.', true); invalid(fields.password, passwordHint); fields.password.input.focus(); }
        else tell(notice, errorText(error), true);
        submit.disabled = false; submit.removeAttribute('aria-busy'); tabs.querySelectorAll('button').forEach(node => { node.disabled = false; });
      }
    });
    panel.append(form, el('p', 'O acesso à aplicação que você vai testar será configurado separadamente.', 'auth-help auth-account-note'));
  }; render();
}

function profilePage() {
  const accountId = user.id;
  main.replaceChildren(); heading('Meu perfil', 'Atualize suas informações.');
  const panel = el('section', null, 'panel'); const form = el('form'); form.noValidate = true;
  const name = field(form, 'profile-name', 'Nome', { autocomplete: 'name', hint: 'Até 120 caracteres.' });
  const team = field(form, 'profile-team', 'Equipe (opcional)', { optional: true, autocomplete: 'organization', hint: 'Até 120 caracteres.' });
  name.input.value = user.name; team.input.value = user.teamName || '';
  form.append(el('p', `E-mail: ${user.email}`, 'hint'));
  const notice = message(); const save = button('Salvar perfil'); save.type = 'submit'; form.append(save, notice); panel.append(form); main.append(panel);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled) return;
    const badName = invalid(name, !name.input.value.trim() || count(name.input.value.trim()) > 120 ? 'Informe seu nome com até 120 caracteres.' : '');
    const badTeam = invalid(team, count(team.input.value.trim()) > 120 ? 'Use até 120 caracteres.' : '');
    if (badName || badTeam) { (badName ? name : team).input.focus(); return; }
    save.disabled = true; tell(notice, 'Salvando perfil…');
    try {
      await sameAccount(accountId);
      const result = await api('/auth/me', { accountId, method: 'PATCH', body: JSON.stringify({ name: name.input.value.trim(), teamName: team.input.value.trim() }) });
      if (user?.id !== accountId) return;
      user = result.user; navigation(); tell(notice, 'Perfil atualizado.');
    } catch (error) { if (user?.id === accountId) tell(notice, errorText(error), true); }
    finally { save.disabled = false; }
  });
}

let selectDetailTab = null;
let currentArtifacts = [];
let currentAnswerSources = [];
// Rótulos de apresentação: os identificadores originais continuam nas operações e referências.
const referenceNames = new Map();
const referenceCounts = new Map();
function referenceLabel(id, kind = 'Referência') {
  if (referenceNames.has(id)) return referenceNames.get(id);
  const value = String(id || '');
  if (!/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}|[a-f\d]{24,}/i.test(value)) return value || kind;
  const ordinal = (referenceCounts.get(kind) || 0) + 1; referenceCounts.set(kind, ordinal);
  const label = `${kind} ${ordinal}`; referenceNames.set(id, label); return label;
}
const referenceList = (ids = [], kind) => ids.map(id => referenceLabel(id, kind)).join(', ');
function prepareReferenceNames(run) {
  referenceNames.clear(); referenceCounts.clear();
  const name = (items, kind, getId = item => item.id, getName) => (items || []).forEach((item, index) => {
    const id = getId(item); if (!id) return;
    referenceNames.set(id, getName ? getName(item, index) : `${kind} ${index + 1}`);
    referenceCounts.set(kind, Math.max(referenceCounts.get(kind) || 0, index + 1));
  });
  name(run.artifacts, 'Fonte', item => item.id, (item, index) => item.name || `Fonte ${index + 1}`);
  name(run.observations, 'Captura');
  for (const item of run.observations || []) if (item.assetId) referenceNames.set(item.assetId, referenceNames.get(item.id));
  name(run.attempts, 'Tentativa');
  name(run.mappingActions, 'Ação');
  const map = run.mapping?.payload.map;
  name(map?.screens, 'Tela', item => item.id, (item, index) => item.name || `Tela ${index + 1}`);
  name(map?.transitions, 'Transição');
  name(map?.paths, 'Percurso');
  const nameOutput = (id, phase) => {
    if (referenceNames.has(id)) return;
    const ordinal = (referenceCounts.get('Resultado') || 0) + 1;
    if (phase === 'execution') referenceCounts.set('Resultado', ordinal);
    referenceNames.set(id, phase === 'execution' ? `Resultado ${ordinal}` : phases[phase] || 'Saída');
  };
  for (const item of run.versions || []) nameOutput(item.id, item.phase);
  for (const [key, label] of [['curation', 'Curadoria'], ['plan', 'Plano de testes'], ['cases', 'Casos de teste'], ['mapping', 'Mapa de navegação'], ['routeDetail', 'Detalhamento dos percursos'], ['report', 'Relatório']]) {
    if (run[key]?.id) referenceNames.set(run[key].id, label);
  }
  const snapshot = run.report?.payload.snapshot;
  for (const item of snapshot?.references || []) nameOutput(item.outputId, item.phase);
  for (const output of run.executionResults || []) referenceNames.set(output.id, `Resultado · ${referenceLabel(output.payload.caseId, 'Caso')}`);
  for (const item of [...(run.questions || []), ...(snapshot?.questions || [])]) referenceLabel(item.id, 'Pergunta');
  for (const item of [...(run.cases?.payload.testCases || []), ...(snapshot?.cases || [])]) {
    referenceLabel(item.id || item.caseId, 'Caso');
    for (const attempt of item.attempts || []) {
      if (!referenceNames.has(attempt.id)) referenceLabel(attempt.id, 'Tentativa');
      if (attempt.resultRef?.outputId) referenceNames.set(attempt.resultRef.outputId, `Resultado · ${referenceLabel(item.caseId, 'Caso')}`);
    }
  }
}
function sourceLabel(source) {
  const artifact = currentArtifacts.find(item => item.id === source.artifactId);
  const lines = /^L(\d+)(?:-L(\d+))?$/.exec(source.locator);
  const pages = lines && artifact?.pages?.filter(page => page.lastLine >= Number(lines[1]) && page.firstLine <= Number(lines[2] || lines[1]));
  const answer = currentAnswerSources.find(item => item.artifactId === source.artifactId);
  return `${artifact?.name || (answer ? `Resposta à ${referenceLabel(answer.questionId, 'Pergunta')} · Revisão ${answer.revision || 1}` : referenceLabel(source.artifactId, 'Fonte'))} · ${source.locator}${pages?.length ? ` · PDF página${pages.length > 1 ? 's' : ''} ${pages.map(page => page.page).join(', ')}` : ''}`;
}
function detailTabs() {
  const sections = [['overview', 'Visão geral', 'visao-geral'], ['plan', 'Plano', 'plano'], ['cases', 'Casos', 'casos'], ['map', 'Mapa', 'mapa'], ['results', 'Resultados', 'resultados']];
  const nav = el('div', null, 'run-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Seções da execução');
  const panes = {}; const buttons = [];
  const choose = (id, focus = false, updateUrl = true) => {
    const section = sections.find(item => item[0] === id) || sections[0];
    id = section[0];
    const focusHidden = Object.entries(panes).some(([key, pane]) => key !== id && pane.contains(document.activeElement));
    buttons.forEach(node => { const selected = node.dataset.target === id; node.setAttribute('aria-selected', String(selected)); node.tabIndex = selected ? 0 : -1; if (selected && focus) node.focus(); });
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== id;
    if (focusHidden && !focus) buttons.find(node => node.dataset.target === id).focus();
    if (updateUrl && location.hash !== `#${section[2]}`) history.pushState(null, '', `#${section[2]}`);
  };
  for (const [id, label] of sections) {
    const tab = button(label, () => choose(id), 'secondary'); tab.id = `tab-${id}`; tab.dataset.target = id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `pane-${id}`);
    const pane = el('div', null, 'tab-pane'); pane.id = `pane-${id}`; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', tab.id); pane.tabIndex = 0;
    buttons.push(tab); panes[id] = pane; nav.append(tab);
    tab.addEventListener('keydown', event => {
      const index = buttons.indexOf(tab); const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next !== null) {
        event.preventDefault(); buttons.forEach((node, position) => { node.tabIndex = position === next ? 0 : -1; }); buttons[next].focus();
      }
    });
  }
  main.append(nav, ...Object.values(panes));
  selectDetailTab = () => choose(sections.find(item => `#${item[2]}` === location.hash)?.[0] || 'overview', false, false);
  selectDetailTab();
  return { ...panes, choose };
}

async function manageRun(run, accountId, action) {
  const dialog = el('dialog', null, 'manage-dialog'); const notice = message();
  const close = button('Voltar', () => dialog.close(), 'secondary');
  dialog.append(el('h2', action === 'duplicate' ? 'Duplicar execução' : 'Excluir execução'), notice);
  const selections = [];
  if (action === 'duplicate') {
    dialog.append(el('p', 'Selecione as entradas da nova execução. Confirme novamente o acesso antes de testar. Decisões, credenciais e resultados não serão copiados.'));
    for (const [index, artifact] of (run.artifacts || []).entries()) {
      const input = checkboxField(dialog, `copy-artifact-${index}`, artifact.name, { optional: true }); input.input.checked = true;
      selections.push({ id: artifact.id, input: input.input });
    }
    if (!selections.length) dialog.append(message('Esta execução não possui entradas disponíveis para duplicação.'));
  } else dialog.append(el('p', `Excluir “${run.name}” e todos os seus arquivos, capturas e credenciais locais? Esta ação não pode ser desfeita.`));
  const key = crypto.randomUUID();
  const confirm = button(action === 'duplicate' ? 'Criar cópia' : 'Excluir definitivamente', async () => {
    const artifactIds = selections.filter(item => item.input.checked).map(item => item.id);
    if (action === 'duplicate' && !artifactIds.length) { tell(notice, 'Selecione ao menos uma entrada.', true); return; }
    confirm.disabled = true; tell(notice, action === 'duplicate' ? 'Criando nova execução…' : 'Excluindo os dados…');
    try {
      await sameAccount(accountId);
      const result = await api(`/runs/${encodeURIComponent(run.id)}${action === 'duplicate' ? '/duplicate' : ''}`, { accountId,
        method: action === 'duplicate' ? 'POST' : 'DELETE', headers: action === 'duplicate' ? { 'Idempotency-Key': key } : {},
        body: JSON.stringify(action === 'duplicate' ? { artifactIds } : { confirmed: true }) });
      if (user?.id !== accountId) return;
      location.assign(action === 'duplicate' ? `/execucoes/${encodeURIComponent(result.id)}` : '/execucoes');
    } catch (error) { if (user?.id === accountId) tell(notice, errorText(error), true); confirm.disabled = false; }
  }, action === 'delete' ? 'danger' : '');
  const actions = el('div', null, 'actions'); actions.append(confirm, close); dialog.append(actions);
  document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}

function runManagement(run, accountId) {
  const actions = el('div', null, 'actions run-management');
  actions.append(button('Duplicar', () => manageRun(run, accountId, 'duplicate'), 'secondary'));
  if (['completed', 'cancelled', 'interrupted', 'error'].includes(run.status)) actions.append(button('Excluir', () => manageRun(run, accountId, 'delete'), 'secondary danger'));
  return actions;
}

const resultNames = { passed: 'Aprovado', failed: 'Reprovado', blocked: 'Bloqueado', inconclusive: 'Inconclusivo', not_run: 'Não executado' };
function attemptPanel(run, attempt, accountId, observations = run.observations || []) {
  const detail = el('details', null, 'attempt');
  detail.append(el('summary', `${referenceLabel(attempt.id, 'Tentativa')} · ${attempt.reproducesAttemptId ? 'Reprodução' : 'Original'} · ${resultNames[attempt.verdict] || statuses[attempt.status] || attempt.status}`));
  detail.append(el('p', `${date(attempt.startedAt)}${attempt.finishedAt ? ` → ${date(attempt.finishedAt)}` : ' · Em andamento'}`, 'hint'));
  if (attempt.current === false) detail.append(message('Tentativa histórica; não compõe a cobertura da revisão atual.'));
  if (attempt.reproducesAttemptId) detail.append(el('p', `Reprodução de ${referenceLabel(attempt.reproducesAttemptId, 'Tentativa')}`, 'hint'));
  if (attempt.setupObservation) detail.append(el('h4', 'Preparo observado'), el('p', attempt.setupObservation, 'text-content'));
  if (attempt.events?.length) detail.append(planSection('Passos observados', attempt.events, event => `${event.at || ''} · ${event.note || event.action || toolNames[event.tool] || 'Ação de navegação'} · ${event.outcome ? actionOutcomes[event.outcome] || 'Registrado' : event.observation || ''}`));
  detail.append(el('h4', 'Resultado observado'), el('p', attempt.observed || 'Nenhuma observação registrada.', 'text-content'));
  if (attempt.reason) detail.append(el('p', attempt.reason, 'text-content'));
  if (attempt.evidenceGaps?.length) detail.append(planSection('Lacunas de evidência', attempt.evidenceGaps));
  const evidenceIds = attempt.validatedResult?.evidenceIds || attempt.evidenceIds || [];
  const images = attempt.evidence || observations.filter(observation => evidenceIds.includes(observation.id) || evidenceIds.includes(observation.assetId));
  if (images.length) { const gallery = el('div', null, 'evidence-grid'); images.forEach(image => gallery.append(captureFigure(run, image, accountId))); detail.append(gallery); }
  return detail;
}
function coveragePanel(coverage) {
  const panel = el('section', null, 'panel coverage'); panel.append(el('h2', 'Cobertura por requisito e critério'));
  for (const requirement of coverage || []) {
    const item = el('details', null, 'plan-section'); item.append(el('summary', `${referenceLabel(requirement.requirementId || requirement.id, 'Requisito')} · ${requirement.statement}`));
    for (const rule of requirement.rules || []) { const criterion = el('section', null, 'coverage-rule'); criterion.append(el('h3', referenceLabel(rule.ruleId || rule.id, 'Critério')), el('p', rule.statement, 'text-content'),
      el('p', rule.partial ? 'Cobertura parcial.' : rule.selected ? 'Critério selecionado.' : 'Fora do escopo selecionado.', 'hint'),
      el('p', rule.attemptedCaseIds?.length ? `Casos tentados: ${referenceList(rule.attemptedCaseIds, 'Caso')}` : 'Nenhum caso tentado.', 'hint'),
      el('p', rule.pendingCaseIds?.length ? `Casos pendentes: ${referenceList(rule.pendingCaseIds, 'Caso')}` : 'Sem casos pendentes.', 'hint'),
      el('p', rule.caseIds?.length ? `Casos: ${referenceList(rule.caseIds, 'Caso')}` : 'Sem caso associado.', 'hint'),
      el('p', rule.uncovered ? (rule.limitation || 'Sem cobertura de execução validada.') : `Casos com resultados validados: ${referenceList(rule.validatedCaseIds, 'Caso') || 'Nenhum'}`, 'hint')); item.append(criterion); }
    panel.append(item);
  }
  return panel;
}
function publishedReportPanel(run, accountId) {
  const report = run.report;
  const article = el('article', null, 'published-report');
  article.dataset.reportRevision = String(report.revision); article.id = 'published-report';
  const { snapshot, narrative } = report.payload;
  article.append(el('p', `Relatório publicado · Revisão ${report.revision} · ${snapshot.mode === 'partial' ? 'Parcial' : 'Final'}`, 'eyebrow'),
    el('h2', snapshot.name), el('p', snapshot.applicationName, 'lead'), el('p', `Criado em ${date(snapshot.createdAt)}`, 'hint'), el('p', narrative.summary, 'text-content'),
    el('h3', 'Escopo'), el('p', narrative.scope, 'text-content'), el('p', snapshot.scope.objective, 'text-content'));
  const totals = el('dl', null, 'metadata report-totals');
  for (const [key, value] of Object.entries(snapshot.counts)) { const item = el('div'); item.append(el('dt', key === 'total' ? 'Total de casos' : resultNames[key] || key), el('dd', String(value))); totals.append(item); }
  if (snapshot.scope.current === false) article.append(message('Escopo histórico: última versão validada; revisão posterior pendente.'));
  article.append(totals, coveragePanel(snapshot.coverage), planSection('Fontes do escopo', snapshot.scope.sources || [], source => `${sourceLabel(source)} — ${source.quote}`), planSection('Exclusões', snapshot.scope.exclusions || [], item => `${item.description} — ${item.reason}`));
  for (const item of snapshot.cases) {
    const section = el('section', null, 'report-case'); section.append(el('h3', `${referenceLabel(item.caseId, 'Caso')} · ${resultNames[item.verdict] || item.verdict}`),
      el('p', `${referenceList(item.requirementIds, 'Requisito')} / ${referenceList(item.ruleIds, 'Critério')}`, 'hint'), el('h4', 'Resultado esperado'), el('p', item.expected, 'text-content'),
      el('h4', 'Resultado observado'), el('p', item.observed || 'Sem tentativa.', 'text-content'), el('p', item.reason, 'text-content'));
    if (item.current === false) section.append(message('Caso histórico: última versão validada; revisão posterior pendente.'));
    if (item.variation) section.append(message(typeof item.variation === 'string' ? item.variation : 'As tentativas apresentaram resultados diferentes; consulte seu histórico.'));
    section.append(planSection('Pré-condições', item.preconditions || []), el('h4', 'Preparo'), el('p', item.setup || '', 'text-content'));
    section.append(planSection('Dados utilizados', Object.entries(item.data || {}), ([key, value]) => `${key}: ${JSON.stringify(value)}`), planSection('Fontes do caso', item.sources || [], source => `${sourceLabel(source)} — ${source.quote}`));
    for (const attempt of item.attempts) section.append(attemptPanel(run, attempt, accountId, []));
    article.append(section);
  }
  article.append(planSection('Pendências', snapshot.pending || [], item => `${referenceLabel(item.caseId, 'Caso')}: ${item.reason}`),
    planSection('Perguntas', snapshot.questions || [], item => `${referenceLabel(item.id, 'Pergunta')}: ${item.description}`),
    planSection('Respostas registradas', snapshot.answers || [], item => `${referenceLabel(item.questionId, 'Pergunta')}: ${item.text}`),
    planSection('Limitações', [...new Set([...(snapshot.limitations || []), ...(narrative.limitations || [])])]),
    planSection('Pareceres utilizados', snapshot.validations || [], item => `${referenceLabel(item.outputId, 'Saída')} · Revisão ${item.outputRevision} · ${validations[item.status] || item.status}${item.reason ? ` — ${item.reason}` : ''}`),
    planSection('Referências às versões', snapshot.references || [], item => `${referenceLabel(item.outputId, 'Saída')} · Revisão ${item.revision}${item.current === false ? ' · Histórica' : ''}`),
    el('h3', 'Conclusão'), el('p', narrative.conclusion, 'text-content'));
  return article;
}
async function printReport(run, accountId, article, notice, action) {
  action.disabled = true; tell(notice, 'Preparando o PDF e carregando as capturas…');
  const opened = [...article.querySelectorAll('details')].filter(node => !node.open);
  try {
    await sameAccount(accountId);
    opened.forEach(node => { node.open = true; });
    await Promise.all([...article.querySelectorAll('img')].map(async img => { img.loading = 'eager'; if (img._evidenceReady) await img._evidenceReady; await img.decode(); }));
    await sameAccount(accountId);
    if (user?.id !== accountId || !article.isConnected || Number(article.dataset.reportRevision) !== run.report.revision) throw new Error('Relatório alterado.');
    document.body.classList.add('printing-report');
    tell(notice, `Revisão ${run.report.revision} pronta para salvar em PDF.`);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await window.print();
  } catch { tell(notice, 'Não foi possível carregar todas as capturas da revisão publicada. Tente novamente antes de salvar em PDF.', true); }
  finally { document.body.classList.remove('printing-report'); opened.forEach(node => { node.open = false; }); action.disabled = false; }
}
function resultsPanel(run, accountId) {
  const panel = el('section', null, 'panel'); panel.append(el('h2', 'Resultados'));
  if (run.report) {
    const notice = message(); const article = publishedReportPanel(run, accountId);
    const print = button('Salvar em PDF', () => printReport(run, accountId, article, notice, print));
    if (run.report.underReview) panel.append(message('Há uma nova revisão em análise. A versão publicada abaixo permanece disponível.'));
    panel.append(print, notice, article);
  } else panel.append(message('Ainda não há relatório publicado. Os resultados validados e as tentativas salvas aparecem abaixo.'));
  const results = run.executionResults || [];
  if (results.length) {
    const interim = el('details', null, 'plan-section'); interim.open = !run.report; interim.append(el('summary', 'Resultados e tentativas atuais'));
    for (const output of results) {
      const item = output.payload; const detail = el('details', null, 'plan-section');
      detail.append(el('summary', `${referenceLabel(item.caseId, 'Caso')} · ${resultNames[item.verdict] || item.verdict} · Revisão ${output.revision}`), el('p', item.observed, 'text-content'), el('p', item.reason, 'text-content'));
      const verdict = output.validations?.findLast(value => value.status !== 'error');
      detail.append(message(verdict?.status === 'approved' ? 'Resultado validado.' : 'Resultado em revisão.'));
      for (const attempt of (run.attempts || []).filter(attempt => attempt.caseId === item.caseId)) detail.append(attemptPanel(run, attempt, accountId));
      interim.append(detail);
    }
    panel.append(interim);
  }
  const represented = new Set(results.map(output => output.payload.caseId));
  for (const attempt of (run.attempts || []).filter(attempt => !represented.has(attempt.caseId))) panel.append(attemptPanel(run, attempt, accountId));
  return panel;
}

function historyPage() {
  const accountId = user.id;
  main.replaceChildren(); heading('Minhas execuções', 'Acompanhe seus testes e consulte os resultados.', link('Nova execução', '/execucoes/nova', 'button'));
  try { if (readAttempt()?.key) main.append(message('Há um salvamento sem confirmação nesta aba.'), link('Continuar salvamento', '/execucoes/nova', 'back-link')); }
  catch { main.append(message('Não foi possível ler a recuperação local. Verifique o armazenamento do navegador antes de iniciar uma execução.', true)); }
  const form = el('form', null, 'filters'); form.noValidate = true;
  const search = field(form, 'q', 'Buscar por nome ou aplicação', { optional: true });
  const wrapper = el('div', null, 'field'); const label = el('label', 'Situação'); label.htmlFor = 'status';
  const select = el('select'); select.id = 'status'; select.name = 'status';
  for (const [value, title] of [['', 'Todas as situações'], ...Object.entries(statuses)]) { const option = el('option', title); option.value = value; select.append(option); }
  wrapper.append(label, select); form.append(wrapper); const submit = button('Filtrar'); submit.type = 'submit'; form.append(submit);
  const params = new URLSearchParams(location.search); search.input.value = params.get('q') || ''; select.value = params.get('status') || '';
  const results = el('section'); results.setAttribute('aria-label', 'Execuções'); main.append(form, results);
  let sequence = 0;
  const load = async () => {
    const current = ++sequence; const query = new URLSearchParams();
    if (search.input.value) query.set('q', search.input.value); if (select.value) query.set('status', select.value);
    results.replaceChildren(message('Carregando execuções…')); results.setAttribute('aria-busy', 'true');
    try {
      const data = await api(`/runs${query.size ? `?${query}` : ''}`, { accountId }); if (user?.id !== accountId || current !== sequence) return;
      results.replaceChildren();
      if (!data.items.length) {
        const empty = el('div', null, 'empty'); empty.append(el('span', '+', 'empty-symbol'), el('h2', query.size ? 'Nenhum resultado para este filtro' : 'Sua primeira execução começa aqui'), el('p', query.size ? 'Experimente outro nome, aplicação ou situação.' : 'Crie uma execução para testar sua aplicação a partir dos requisitos.'));
        empty.append(query.size ? link('Limpar filtros', '/execucoes', 'button secondary') : link('Criar primeira execução', '/execucoes/nova', 'button')); results.append(empty);
      } else {
        results.append(el('p', `${data.items.length} ${data.items.length === 1 ? 'execução encontrada' : 'execuções encontradas'}`, 'list-caption'));
        const list = el('ul', null, 'run-list');
        for (const run of data.items) {
          const row = el('li', null, 'run-row'); const identification = el('div'); const name = el('h2'); name.append(link(run.name, `/execucoes/${encodeURIComponent(run.id)}`));
          identification.append(name, el('p', run.applicationName)); const state = el('div'); state.append(el('span', statuses[run.status] || run.status, `badge status-${run.status}`), el('p', phases[run.phase] || run.phase));
          const actions = el('div', null, 'actions');
          for (const [label, operation] of [['Duplicar', 'duplicate'], ...(['completed', 'cancelled', 'interrupted', 'error'].includes(run.status) ? [['Excluir', 'delete']] : [])]) actions.append(button(label, async () => {
            try { const detail = await api(`/runs/${encodeURIComponent(run.id)}`, { accountId }); if (user?.id === accountId) await manageRun(detail, accountId, operation); }
            catch (error) { if (user?.id === accountId) results.prepend(message(errorText(error), true)); }
          }, 'secondary'));
          identification.append(actions); row.append(identification, el('p', date(run.createdAt)), state); list.append(row);
        } results.append(list);
      }
    } catch (error) { if (user && current === sequence) results.replaceChildren(message(errorText(error), true), button('Tentar novamente', load, 'secondary')); }
    finally { if (current === sequence) results.setAttribute('aria-busy', 'false'); }
  };
  form.addEventListener('submit', event => {
    event.preventDefault(); if (invalid(search, count(search.input.value) > 120 ? 'Use até 120 caracteres na busca.' : '')) { search.input.focus(); return; }
    const query = new URLSearchParams(); if (search.input.value) query.set('q', search.input.value); if (select.value) query.set('status', select.value);
    history.replaceState(null, '', `/execucoes${query.size ? `?${query}` : ''}`); void load();
  }); void load();
}

function intakePage() {
  const accountId = user.id;
  main.replaceChildren(); heading('Nova execução', 'Informe a aplicação e os requisitos que serão testados.');
  const split = el('div', null, 'split'); const panel = el('section', null, 'panel');
  const note = el('aside', null, 'side-note'); note.append(el('span', 'Antes de começar', 'step'), el('h2', 'Prepare seus requisitos'), el('p', 'Salve o rascunho e, em seguida, selecione “Preparar plano” para começar.'), el('p', 'Cole o texto e/ou selecione até cinco arquivos .txt, .md ou PDF com texto, de até 10 MiB cada. As fontes serão preservadas separadamente.'));
  split.append(panel, note); main.append(split);
  const notice = message(); panel.append(notice); const form = el('form'); form.noValidate = true;
  const identification = el('section', null, 'intake-section');
  identification.append(el('span', '01 / Identificação', 'step')); const pair = el('div', null, 'two-fields'); identification.append(pair); form.append(identification);
  const fields = { name: field(pair, 'name', 'Nome da execução', { hint: 'Até 120 caracteres.' }), applicationName: field(pair, 'applicationName', 'Aplicação', { hint: 'Até 120 caracteres.' }) };
  fields.objective = field(identification, 'objective', 'Objetivo (opcional)', { textarea: true, optional: true, hint: 'Até 2.000 caracteres.' });
  const material = el('section', null, 'intake-section'); material.append(el('span', '02 / Material de entrada', 'step')); form.append(material);
  fields.text = field(material, 'text', 'Requisitos', { textarea: true, optional: true, className: 'material', hint: 'Cole requisitos, histórias, critérios de aceite ou cenários Gherkin.' });
  const uploads = field(material, 'files', 'Arquivos de requisitos (opcional)', { optional: true, type: 'file', hint: 'Até cinco arquivos .txt, .md ou PDF com texto; até 10 MiB por arquivo.' });
  uploads.input.multiple = true; uploads.input.accept = '.txt,.md,.pdf';
  const received = el('ul', null, 'plain-list'); material.append(received);
  const meter = el('small'); const footer = el('div', null, 'form-footer'); const submit = button('Salvar rascunho'); submit.type = 'submit'; footer.append(meter, submit); form.append(footer); panel.append(form);
  let attempt = null; let sending = false; let blocked = false;
  const body = () => JSON.stringify(Object.fromEntries(Object.entries(fields).map(([name, ref]) => [name, ref.input.value])));
  const update = () => { meter.textContent = `Espaço de texto utilizado: ${Math.ceil(bytes(body()) / limit * 100)}%`; received.replaceChildren(...[...uploads.input.files].map(file => el('li', `${file.name} · ${(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KiB`))); };
  const lock = () => { Object.values(fields).forEach(ref => { ref.input.readOnly = !!attempt?.key; }); submit.textContent = attempt?.key ? 'Confirmar salvamento' : 'Salvar rascunho'; };
  try {
    attempt = readAttempt();
    if (attempt) { const values = JSON.parse(attempt.body); for (const [name, ref] of Object.entries(fields)) ref.input.value = values[name];
      tell(notice, (attempt.key ? 'O salvamento anterior ainda não foi confirmado. Confirme usando o conteúdo original abaixo. Ele ficará bloqueado até a confirmação.' : 'Seu formulário pendente foi recuperado para esta conta.') + (attempt.files?.length ? ' Selecione novamente os arquivos da tentativa original.' : '')); }
  } catch { blocked = true; submit.disabled = true; tell(notice, 'Não foi possível ler a tentativa salva. Consulte o histórico antes de iniciar outra execução, para evitar duplicação.', true); }
  lock(); update(); form.addEventListener('input', update);
  rememberForm = () => {
    if (attempt?.key || blocked || user?.id !== accountId) return;
    try { saveAttempt({ accountId, kind: 'draft', body: body() }); } catch { /* Sem envio: não existe resultado incerto a recuperar. */ }
  };
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (sending || blocked) return;
    if (!attempt?.key) {
      let first;
      for (const [name, ref] of Object.entries(fields)) {
        const value = ref.input.value.trim(); let problem = '';
        if (name !== 'objective' && !value && (name !== 'text' || !uploads.input.files.length)) problem = 'Preencha este campo ou selecione arquivos de requisitos.';
        const max = name === 'objective' ? 2000 : name === 'text' ? Infinity : 120;
        if (count(value) > max) problem = `Use até ${max.toLocaleString('pt-BR')} caracteres.`;
        if (name === 'text' && bytes(body()) > limit) problem = 'O conteúdo informado excede o limite. Reduza o texto ou envie os requisitos em arquivo.';
        if (invalid(ref, problem) && !first) first = ref.input;
      }
      if (first) { first.focus(); return; }
    }
    const selectedFiles = [...uploads.input.files];
    const fileProblem = selectedFiles.length > 5 ? 'Selecione no máximo cinco arquivos.' : selectedFiles.some(file => file.size > 10 * 1024 * 1024) ? 'Cada arquivo deve ter até 10 MiB.' : selectedFiles.some(file => !/\.(txt|md|pdf)$/i.test(file.name)) ? 'Use somente .txt, .md ou PDF com texto.' : '';
    if (invalid(uploads, fileProblem)) { uploads.input.focus(); return; }
    sending = true; submit.disabled = true; uploads.input.disabled = true; tell(notice, 'Conferindo sessão e salvando o rascunho…');
    try {
      const files = await Promise.all(selectedFiles.map(async file => ({ name: file.name, size: file.size, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('') })));
      if (attempt?.key && JSON.stringify(attempt.files || []) !== JSON.stringify(files)) { tell(notice, 'Selecione novamente os mesmos arquivos da tentativa original para confirmar o salvamento. O conteúdo original foi preservado.', true); return; }
      const candidate = attempt?.key ? attempt : { accountId, key: crypto.randomUUID(), body: body(), ...(files.length ? { files } : {}) };
      // Guardar e reler antes de qualquer POST. Falha local nunca dispara um envio.
      try { saveAttempt(candidate); } catch { tell(notice, 'Não foi possível guardar a tentativa nesta aba. Nenhuma solicitação de salvamento foi enviada. Habilite o armazenamento do navegador e tente novamente.', true); return; }
      attempt = candidate;
      lock();
      await sameAccount(candidate.accountId);
      if (user?.id !== accountId) return;
      let run;
      try {
        let payload = attempt.body;
        if (selectedFiles.length) { payload = new FormData(); for (const [key, value] of Object.entries(JSON.parse(attempt.body))) payload.append(key, value); selectedFiles.forEach(file => payload.append('files', file)); }
        run = await api('/runs', { accountId: attempt.accountId, method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: payload });
      }
      catch (error) {
        if (!user) return;
        if ([400, 413, 415].includes(error.status)) {
          try { sessionStorage.removeItem(storagePrefix + accountId); attempt = null; lock(); }
          catch { blocked = true; }
          tell(notice, errorText(error), true);
        } else { tell(notice, `${errorText(error)} O salvamento ainda não foi confirmado. Use “Confirmar salvamento” para repetir a tentativa original.`, true); }
        return;
      }
      if (user?.id !== accountId) return;
      if (!run?.id || typeof run.id !== 'string') throw new Error('Resposta sem identificação.');
      try { sessionStorage.removeItem(storagePrefix + accountId); }
      catch { tell(notice, 'Rascunho salvo, mas não foi possível limpar a recuperação local. Repetir esta tentativa é seguro.', true); panel.append(link('Abrir execução salva', `/execucoes/${encodeURIComponent(run.id)}`, 'button')); return; }
      rememberForm = null; tell(notice, 'Rascunho salvo. Abrindo execução…'); location.assign(`/execucoes/${encodeURIComponent(run.id)}`);
    } catch (error) { if (user) tell(notice, `${errorText(error)}${attempt?.key ? ' Confirme a tentativa original antes de iniciar outra.' : ''}`, true); }
    finally { sending = false; submit.disabled = blocked; uploads.input.disabled = false; lock(); }
  });
}

function planSection(title, values, format = value => value) {
  const section = el('section', null, 'plan-section'); section.append(el('h3', title));
  if (!values.length) section.append(el('p', 'Nenhum item informado.', 'hint'));
  else { const list = el('ul', null, 'plain-list'); values.forEach(value => list.append(el('li', format(value), 'text-content'))); section.append(list); }
  return section;
}
function preservedComment(pending) {
  const panel = el('section', null, 'panel');
  panel.append(el('p', 'Cópia do comentário original para leitura ou cópia. Não será aplicada a outra revisão.'));
  const copy = field(panel, 'preserved-comment', `Comentário preservado da revisão ${pending.outputRevision}`, { optional: true, textarea: true });
  copy.input.value = pending.comment; copy.input.readOnly = true;
  return panel;
}
function curationPanel(curation, run) {
  const panel = el('details', null, 'panel'); panel.append(el('summary', `Entendimento do material · Revisão ${curation.revision}`));
  for (const requirement of curation.payload.requirements) {
    const requirementPanel = el('details', null, 'plan-section');
    requirementPanel.append(el('summary', `${referenceLabel(requirement.id, 'Requisito')} · ${requirement.statement}`));
    for (const rule of requirement.rules) {
      const associated = (run.cases?.payload.testCases || []).filter(item => item.ruleIds.includes(rule.id));
      requirementPanel.append(el('p', associated.length ? `Casos de ${referenceLabel(rule.id, 'Critério')}: ${referenceList(associated.map(item => item.id), 'Caso')}` : `${referenceLabel(rule.id, 'Critério')}: sem caso associado.`, 'hint'));
      const pending = run.questions.filter(item => item.ruleIds?.includes(rule.id) || item.requirementIds?.includes(requirement.id));
      if (pending.length) requirementPanel.append(planSection('Pendências', pending, item => item.description));
      requirementPanel.append(el('p', `${referenceLabel(rule.id, 'Critério')}${rule.kind === 'example' ? ' · Exemplo recebido' : ''} — ${rule.statement}`, 'text-content'));
      for (const example of rule.examples || []) requirementPanel.append(planSection(`Exemplo · ${referenceLabel(example.id, 'Exemplo')}`, [
        ...example.given.map(value => `Dado: ${value}`), ...example.when.map(value => `Quando: ${value}`), ...example.then.map(value => `Então: ${value}`),
      ]));
      for (const source of rule.sources) requirementPanel.append(el('p', sourceLabel(source), 'hint'), el('blockquote', source.quote, 'text-content'));
    }
    panel.append(requirementPanel);
  }
  return panel;
}
function targetAccessPanel(run, accountId) {
  const access = run.targetAccess;
  const panel = el('section', null, 'panel');
  panel.id = 'target-access-panel';

  const isConfigured = Boolean(access.hasCredential && access.startUrl);
  const mapping = run.mapping;
  const verdicts = mapping?.validations.filter(value => value.status !== 'error') || [];
  const authenticated = isConfigured && mapping?.current && mapping.payload.accessRevision === access.revision &&
    mapping.payload.authentication.status === 'authenticated' && verdicts.length === 1 && verdicts[0].status === 'approved';
  panel.append(
    el('p', access.revision > 0 ? `Acesso à aplicação testada · Revisão ${access.revision}` : 'Acesso à aplicação testada', 'eyebrow'),
    el('h2', 'Acesso à aplicação testada'),
    message(
      authenticated ? 'Acesso à aplicação confirmado.' : isConfigured
        ? 'Acesso salvo. A conexão será verificada no mapeamento.'
        : 'Acesso pendente. Configure o endereço e a conta de teste antes do mapeamento.'
    )
  );

  if (isConfigured) {
    const dl = el('dl', null, 'metadata');
    for (const [title, value] of [
      ['Endereço da aplicação', access.startUrl],
      ['Perfil de acesso', access.accessProfile || 'Não informado'],
      ['Preparação necessária', access.dataPreparation || 'Nenhuma'],
      ['Credencial de teste', 'Credencial cadastrada'],
      ['Autorização', access.authorizedTarget ? 'Confirmada pelo usuário' : 'Pendente'],
    ]) {
      const item = el('div');
      item.append(el('dt', title), el('dd', value));
      dl.append(item);
    }
    panel.append(dl);
  }

  if (!access.canEdit) {
    panel.append(el('p', 'A configuração de acesso não pode ser alterada no estado atual da execução.', 'hint'));
    return panel;
  }

  const editContainer = el('details', null, 'plan-section');
  if (!isConfigured) editContainer.open = true;
  editContainer.append(el('summary', isConfigured ? 'Alterar configuração de acesso' : 'Configurar acesso'));

  const lead = el('p', 'Informe o endereço e a conta da aplicação que será testada. Essa conta é diferente da sua conta QAtron.', 'hint');
  const form = el('form');
  form.noValidate = true;

  const urlField = field(form, 'target-start-url', 'Endereço da aplicação', {
    hint: run.status !== 'draft' && access.startUrl
      ? 'Para testar outro endereço, crie uma nova execução.'
      : 'Informe um endereço autorizado, sem parâmetros após “?” ou “#”. Ex.: https://sua-aplicacao.com',
  });
  urlField.input.value = access.startUrl || '';
  if (run.status !== 'draft' && access.startUrl) {
    urlField.input.readOnly = true;
  }

  const profileField = field(form, 'target-access-profile', 'Perfil de acesso', {
    hint: 'Ex.: operador de reservas, administrador, recepcionista.',
  });
  profileField.input.value = access.accessProfile || '';

  const prepField = field(form, 'target-data-preparation', 'Preparação necessária', {
    textarea: true,
    hint: 'Instruções para o estado inicial da aplicação (ex.: iniciar com a lista de reservas vazia). Quando não houver preparo adicional, declare explicitamente.',
  });
  prepField.input.value = access.dataPreparation || '';

  let replaceCredBox = null;
  let usernameField = null;
  let passwordField = null;

  if (isConfigured) {
    const credSection = el('div', null, 'plan-section');
    credSection.append(el('p', 'Dados de acesso salvos.', 'hint'));
    replaceCredBox = checkboxField(credSection, 'target-replace-credential', 'Substituir usuário e senha da conta de teste', { optional: true });

    const credInputs = el('div');
    credInputs.hidden = true;
    usernameField = field(credInputs, 'target-username', 'Usuário da conta de teste', {
      optional: true,
      autocomplete: 'off',
    });
    passwordField = field(credInputs, 'target-password', 'Senha da conta de teste', {
      optional: true,
      type: 'password',
      autocomplete: 'off',
    });
    credSection.append(credInputs);
    form.append(credSection);

    replaceCredBox.input.addEventListener('change', () => {
      credInputs.hidden = !replaceCredBox.input.checked;
      if (credInputs.hidden) {
        usernameField.input.value = '';
        passwordField.input.value = '';
      }
    });
  } else {
    usernameField = field(form, 'target-username', 'Usuário da conta de teste', {
      autocomplete: 'off',
    });
    passwordField = field(form, 'target-password', 'Senha da conta de teste', {
      type: 'password',
      autocomplete: 'off',
    });
  }

  const authBox = checkboxField(form, 'target-authorized', 'Confirmo que tenho autorização para testar esta aplicação', {
    hint: 'A autorização do responsável é obrigatória antes do mapeamento e execução.',
  });
  authBox.input.checked = Boolean(access.authorizedTarget);

  const notice = message();
  const submit = button('Salvar acesso');
  submit.type = 'submit';
  form.append(notice, submit);
  editContainer.append(lead, form);
  panel.append(editContainer);

  let saving = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;

    let hasError = false;
    if (invalid(urlField, !urlField.input.value.trim() ? 'Informe o endereço da aplicação.' : '')) hasError = true;
    if (invalid(profileField, !profileField.input.value.trim() ? 'Informe o perfil de acesso.' : '')) hasError = true;
    if (invalid(prepField, !prepField.input.value.trim() ? 'Informe a preparação necessária ou declare ausência de preparo.' : '')) hasError = true;
    if (invalid(authBox, !authBox.input.checked ? 'É necessário confirmar a autorização para testar a aplicação.' : '')) hasError = true;

    const shouldSendCred = !isConfigured || (replaceCredBox && replaceCredBox.input.checked);
    if (shouldSendCred) {
      if (invalid(usernameField, !usernameField.input.value.trim() ? 'Informe o usuário da conta de teste.' : '')) hasError = true;
      if (invalid(passwordField, !passwordField.input.value ? 'Informe a senha da conta de teste.' : '')) hasError = true;
    }

    if (hasError) return;

    const payload = {
      expectedAccessRevision: access.revision,
      startUrl: urlField.input.value.trim(),
      accessProfile: profileField.input.value.trim(),
      dataPreparation: prepField.input.value.trim(),
      authorizedTarget: true,
      ...(shouldSendCred ? { credential: { username: usernameField.input.value.trim(), password: passwordField.input.value } } : {}),
    };

    if (bytes(JSON.stringify(payload)) > limit) {
      tell(notice, 'O conteúdo informado excede o limite. Reduza os dados e tente novamente.', true);
      return;
    }

    saving = true;
    submit.disabled = true;
    tell(notice, 'Salvando configuração de acesso…');

    try {
      await sameAccount(accountId);
      if (user?.id !== accountId) return;

      await api(`/runs/${encodeURIComponent(run.id)}`, {
        accountId,
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      // Limpa os campos secretos da memória e do DOM
      if (passwordField) passwordField.input.value = '';
      if (usernameField && shouldSendCred) usernameField.input.value = '';

      await detailPage('Acesso salvo.');
      main.focus();
    } catch (error) {
      if (user?.id !== accountId) return;
      if (passwordField) passwordField.input.value = '';
      if (error.status === 409) {
        tell(notice, `${errorText(error)} Consulte a configuração salva antes de tentar novamente; a credencial não será reenviada automaticamente.`, true);
        form.append(button('Consultar registro atualizado', () => detailPage('', false), 'secondary'));
      } else {
        tell(notice, errorText(error), true);
        saving = false;
        submit.disabled = false;
      }
    }
  });

  return panel;
}

function casesPanel(run, accountId, pending) {
  const cases = run.cases;
  const panel = el('section', null, 'panel');
  const verdicts = cases.validations.filter(value => value.validator === 'output-validator' && value.status !== 'error');
  const caseDecisions = run.approvals.filter(d => d.outputId === cases.id);
  const currentDecision = caseDecisions.find(d => d.outputRevision === cases.revision);

  const statusText = !cases.current
    ? 'Estes casos precisam ser atualizados após as alterações anteriores.'
    : currentDecision
    ? (currentDecision.decision === 'approved'
      ? (run.routeDetail ? 'Casos aprovados. Consulte o detalhamento e suas pendências abaixo.'
        : run.mapping ? 'Casos aprovados. O mapa está disponível para definir os percursos.'
        : run.canMap ? 'Casos aprovados. Pronto para mapear a aplicação.'
        : run.targetAccess?.revision > 0 ? 'Casos aprovados. O mapeamento ainda não foi iniciado.'
        : 'Casos aprovados. Configure o acesso à aplicação antes do mapeamento.')
      : 'Alterações solicitadas. Os casos aguardam revisão.')
    : (verdicts.length === 1 && verdicts[0].status === 'approved'
      ? 'Casos validados. Prontos para sua revisão.'
      : 'Casos em revisão. Aguarde a validação para aprová-los.');

  panel.append(el('p', `Casos de teste / Revisão ${cases.revision}`, 'eyebrow'), el('h2', 'Casos de teste'),
    el('p', run.routeDetail ? 'Consulte os percursos dos casos aprovados abaixo.'
      : run.mapping ? 'O mapa está disponível. Defina os percursos dos casos para continuar.'
      : 'O percurso será definido após o mapeamento.', 'lead'),
    message(statusText));
  for (const item of cases.payload.testCases) {
    const detail = el('details', null, 'plan-section'); detail.append(el('summary', `${referenceLabel(item.id, 'Caso')} · ${referenceList(item.ruleIds, 'Critério')}`));
    detail.append(planSection('Requisitos referenciados', item.requirementIds, id => referenceLabel(id, 'Requisito')), planSection('Regras referenciadas', item.ruleIds, id => referenceLabel(id, 'Critério')),
      planSection('Pré-condições', item.preconditions), el('h3', 'Preparação'), el('p', item.setup, 'text-content'),
      planSection('Dados', Object.entries(item.data), ([key, value]) => `${key}: ${JSON.stringify(value)}`),
      planSection('Técnicas', item.techniques, value => `${value.name} — ${value.description}\nValores: ${value.values.map(item => JSON.stringify(item)).join(', ')}`),
      el('h3', 'Resultado esperado'), el('p', item.expected, 'text-content'), el('h3', 'Fontes'));
    for (const source of item.sources) detail.append(el('p', sourceLabel(source), 'hint'), el('blockquote', source.quote, 'text-content'));
    if (run.routeDetail) detail.append(caseRoute(run, item.id));
    panel.append(detail);
  }
  panel.append(planSection('Situação da validação', cases.validations,
    value => `${validations[value.status] || value.status} · Revisão ${value.outputRevision} · ${roles[value.validator] || value.validator}${value.reason ? ` — ${value.reason}` : ''}`));
  for (const verdict of cases.validations) {
    if (verdict.findings?.length) panel.append(planSection('Achados da validação', verdict.findings, value => `${value.location} — ${value.message}`));
  }

  const decisions = el('section', null, 'plan-section');
  decisions.append(el('h3', 'Decisões registradas'));
  if (!caseDecisions.length) decisions.append(el('p', 'Nenhuma decisão registrada.', 'hint'));
  for (const decision of caseDecisions) {
    const item = el('div', null, 'decision');
    item.append(el('p', `${decision.decision === 'approved' ? 'Casos aprovados' : 'Alterações solicitadas'} · Revisão ${decision.outputRevision}${!cases.current || decision.outputRevision !== cases.revision ? ' · Conteúdo desatualizado' : ''}`), el('p', date(decision.at), 'hint'));
    if (decision.comment) item.append(el('p', decision.comment, 'text-content'));
    decisions.append(item);
  }
  panel.append(decisions);

  if (currentDecision?.decision === 'approved' && run.canMap) {
    const map = el('section', null, 'next-action mapping-start');
    map.append(el('h3', 'Mapear aplicação'),
      el('p', 'Vamos acessar a aplicação e identificar os caminhos necessários para os testes.'));
    const notice = message(); map.append(notice);
    const start = button('Mapear aplicação', async () => {
      start.disabled = true; tell(notice, 'Solicitando o mapeamento da aplicação…');
      try {
        await sameAccount(accountId); if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(run.id)}/continue`, { accountId, method: 'POST',
          body: JSON.stringify({ outputId: cases.id, outputRevision: cases.revision, expectedAccessRevision: run.targetAccess.revision }) });
        await detailPage('Mapeamento aceito. Acompanhe a exploração e a validação visual na aba Mapa.');
      } catch (error) { if (user?.id === accountId) await detailPage(errorText(error), true); }
    });
    map.append(start); panel.append(map);
  }

  const restoreCaseComment = pending && run.cases?.id === pending.outputId && run.cases.revision === pending.outputRevision &&
    !run.approvals.some(decision => decision.outputId === pending.outputId && decision.outputRevision === pending.outputRevision);

  if (run.canDecideCases && !currentDecision) {
    const review = el('section', null, 'plan-section');
    review.append(el('h3', 'Decidir sobre os casos de teste'), el('p', 'Revise os casos antes de aprová-los. Depois, inicie o mapeamento da aplicação.'));
    const notice = message(); review.append(notice);
    const form = el('form'); form.noValidate = true;
    const comment = field(form, 'case-comment', 'Comentário sobre os casos', { optional: true, textarea: true, hint: 'Obrigatório ao solicitar alterações. Até 4.000 caracteres.' });
    if (restoreCaseComment) comment.input.value = pending.comment;
    const actions = el('div', null, 'actions');
    const approve = button('Aprovar casos de teste');
    const change = button('Solicitar alterações nos casos', null, 'secondary');
    actions.append(approve, change); form.append(actions); review.append(form); panel.append(review);
    form.addEventListener('submit', event => event.preventDefault());
    let submitting = false;
    const decide = async changes => {
      if (submitting) return;
      if (changes && invalid(comment, !comment.input.value.trim() ? 'Informe um comentário para solicitar alterações.' : count(comment.input.value) > 4000 ? 'Use até 4.000 caracteres.' : '')) {
        comment.input.focus(); return;
      }
      const payload = { outputId: cases.id, outputRevision: cases.revision, ...(changes ? { comment: comment.input.value } : {}) };
      if (bytes(JSON.stringify(payload)) > limit) {
        invalid(comment, 'O comentário excede o limite. Reduza-o e tente novamente.'); comment.input.focus(); return;
      }
      pending = { accountId, runId: run.id, outputId: cases.id, outputRevision: cases.revision, comment: comment.input.value,
        decision: changes ? 'changes_requested' : 'approved' };
      submitting = true; approve.disabled = change.disabled = comment.input.readOnly = true; tell(notice, 'Registrando decisão…');
      try {
        await sameAccount(accountId);
        if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(run.id)}/${changes ? 'request-changes' : 'approve'}`, {
          accountId, method: 'POST', body: JSON.stringify(payload),
        });
        await detailPage('Decisão registrada.', false, pending);
        main.focus();
      } catch (error) {
        if (!user) return;
        if (error.status === 409) {
          await detailPage(`Decisão recusada. ${errorText(error)} Nenhuma decisão foi reaplicada.`, true, pending);
          main.focus();
        } else if (!error.status || error.status >= 500) {
          await detailPage('Não foi possível confirmar a decisão pela resposta. Consulte o registro salvo antes de decidir novamente; nenhuma decisão será reaplicada automaticamente.', true, pending);
          main.focus();
        } else {
          tell(notice, errorText(error), true);
          submitting = false; approve.disabled = change.disabled = comment.input.readOnly = false;
        }
      }
    };
    approve.addEventListener('click', () => decide(false));
    change.addEventListener('click', () => decide(true));
  } else if (restoreCaseComment) {
    panel.append(preservedComment(pending));
  }

  return panel;
}
function captureFigure(run, observation, accountId) {
  const figure = el('figure', null, 'evidence-shot');
  const img = el('img');
  img.alt = 'Captura da tela observada'; img.loading = 'lazy';
  if (observation.width && observation.height) { img.width = observation.width; img.height = observation.height; }
  const caption = el('figcaption', [referenceLabel(observation.id || observation.assetId, 'Captura'), observation.at ? date(observation.at) : '', observation.caseId ? `${referenceLabel(observation.caseId, 'Caso')} · ${referenceLabel(observation.attemptId, 'Tentativa')}` : ''].filter(Boolean).join(' · '));
  figure.append(img, caption);
  img._evidenceReady = evidenceUrl(run.id, observation.assetId, accountId).then(url => {
    if (user?.id !== accountId || evidenceRunId !== run.id || !img.isConnected) { URL.revokeObjectURL(url); evidenceUrls.delete(url); throw new Error('Conta alterada.'); }
    img.src = url;
  });
  img._evidenceReady.catch(() => { img.alt = 'Captura indisponível'; caption.textContent = 'Captura indisponível para esta observação.'; });
  return figure;
}
function caseRoute(run, caseId) {
  const routes = run.routeDetail;
  const panel = el('section', null, 'plan-section');
  const item = routes.payload.testCases.find(item => item.id === caseId);
  panel.append(el('h3', 'Percurso do caso'));
  if (!item) { panel.append(message('Caso ausente desta revisão do detalhamento.')); return panel; }
  const quality = routes.validations.filter(value => value.validator === 'output-validator' && value.status !== 'error');
  const approved = routes.current && quality.length === 1 && quality[0].status === 'approved';
  panel.append(message(!routes.current ? 'Associação desatualizada.' : approved ? 'Associação validada.' : 'Associação provisória — sem aprovação do validador.'));
  panel.append(el('p', `Casos aprovados · Revisão ${item.approvedCaseRevision.revision}`, 'hint'));
  if (item.pathId === null) {
    panel.append(el('p', routes.payload.pending.find(value => value.caseId === caseId)?.reason || 'Percurso pendente.', 'text-content'));
  } else {
    const map = run.mapping;
    const sameMap = map && routes.dependsOn.some(ref => ref.outputId === map.id && ref.revision === map.revision);
    const path = sameMap && map.payload.map.paths.find(path => path.id === item.pathId);
    panel.append(el('p', `Caminho: ${referenceLabel(item.pathId, 'Percurso')}`));
    if (path) {
      const screens = new Map(map.payload.map.screens.map(screen => [screen.id, screen.name]));
      const transitions = new Map(map.payload.map.transitions.map(transition => [transition.id, transition]));
      const steps = [screens.get(path.startScreenId) || referenceLabel(path.startScreenId, 'Tela')];
      for (const id of path.transitionIds) {
        const transition = transitions.get(id);
        steps.push(`${screens.get(transition.to) || referenceLabel(transition.to, 'Tela')}`);
      }
      panel.append(planSection('Sequência observada', steps));
    } else panel.append(el('p', 'O mapa desta associação é histórico; consulte a revisão referenciada.', 'hint'));
  }
  return panel;
}

function routeDetailPanel(run, accountId) {
  const panel = el('section', null, 'panel');
  panel.append(el('h2', 'Detalhamento dos percursos'));
  if (run.canDetailRoutes && run.mapping) {
    panel.append(el('p', 'Defina os percursos dos casos a partir do mapa da aplicação.'));
    const notice = message();
    const start = button('Detalhar percursos', async () => {
      start.disabled = true; tell(notice, 'Solicitando o detalhamento dos percursos…');
      try {
        await sameAccount(accountId); if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(run.id)}/continue`, { accountId, method: 'POST',
          body: JSON.stringify({ outputId: run.mapping.id, outputRevision: run.mapping.revision }) });
        await detailPage('Detalhamento aceito. Acompanhe a geração e a validação.');
      } catch (error) { if (user?.id === accountId) await detailPage(errorText(error), true); }
    });
    panel.append(start, notice);
  }
  if (run.phase === 'route_detail' && run.status === 'running') panel.append(message(activities[run.progress.activity] || 'Preparando o detalhamento…'));
  const routes = run.routeDetail;
  if (routes) {
    panel.append(el('p', `Revisão ${routes.revision}`, 'eyebrow'));
    if (routes.ready && run.phase === 'route_detail') panel.append(message('Percursos validados — aguardando execução dos testes'));
    else if (!routes.current) panel.append(message('Detalhamento desatualizado — as dependências foram alteradas.'));
    else if (routes.validations.some(value => value.status === 'approved')) panel.append(message('Detalhamento validado. Consulte os percursos e as pendências de cada caso.'));
    else if (run.status === 'awaiting_input') panel.append(message('Detalhamento com impedimentos. Responda às perguntas e consulte as opções de retomada.'));
    else panel.append(message('Percursos em revisão. Aguarde a validação para executar os testes.'));
    panel.append(planSection('Pareceres sobre o detalhamento', routes.validations,
      value => `${validations[value.status] || value.status} · Revisão ${value.outputRevision} · ${value.reason}`));
    for (const verdict of routes.validations) if (verdict.findings.length) panel.append(planSection('Achados do detalhamento', verdict.findings,
      value => `${value.location || 'Geral'} — ${value.message}`));
    if (routes.payload.pending.length) panel.append(planSection('Casos com percurso pendente', routes.payload.pending, value => `${referenceLabel(value.caseId, 'Caso')} — ${value.reason}`));
    panel.append(el('p', 'Os percursos de cada caso estão na aba Casos. Nenhum teste foi executado nesta etapa.', 'hint'));
  }
  return panel;
}

function mappingPanel(run, accountId) {
  const mapping = run.mapping;
  const panel = el('section', null, 'panel');
  const last = mapping.validations.at(-1);
  let statusText = 'Mapa em elaboração — aguardando parecer do validador visual.';
  if (run.status === 'ready' && run.phase === 'mapping') statusText = 'Mapa validado — aguardando detalhamento dos percursos.';
  else if (mapping.current && last?.status === 'approved') statusText = 'Mapa validado.';
  else if (last?.status === 'changes_requested') statusText = 'Validador solicitou alterações; o executor prepara uma nova revisão.';
  else if (last?.status === 'blocked') statusText = 'Validação bloqueada.';
  else if (last?.status === 'error') statusText = 'Falha técnica na validação visual desta revisão.';
  panel.append(el('p', `Mapa de navegação / Revisão ${mapping.revision}`, 'eyebrow'), el('h2', 'Mapa de navegação'),
    message(statusText));
  const auth = mapping.payload.authentication;
  panel.append(el('p', auth.status === 'authenticated'
    ? `Acesso autenticado observado · ${referenceLabel(auth.observationId, 'Captura')}.`
    : 'Acesso autenticado ainda não observado.', 'hint'));

  const screens = el('details', null, 'plan-section'); screens.open = true;
  screens.append(el('summary', `Telas observadas (${mapping.payload.map.screens.length})`));
  if (!mapping.payload.map.screens.length) screens.append(el('p', 'Nenhuma tela registrada.', 'hint'));
  for (const screen of mapping.payload.map.screens) {
    const item = el('div', null, 'plan-section');
    item.append(el('h3', screen.name || referenceLabel(screen.id, 'Tela')), el('p', screen.recognition, 'text-content'));
    const captures = el('div', null, 'evidence-grid');
    for (const observationId of screen.observationIds) {
      const observation = run.observations.find(value => value.id === observationId);
      if (observation) captures.append(captureFigure(run, observation, accountId));
      else captures.append(el('p', `${referenceLabel(observationId, 'Captura')} indisponível.`, 'hint'));
    }
    item.append(captures); screens.append(item);
  }
  panel.append(screens);

  const transitions = el('details', null, 'plan-section');
  transitions.append(el('summary', `Transições (${mapping.payload.map.transitions.length})`));
  if (!mapping.payload.map.transitions.length) transitions.append(el('p', 'Nenhuma transição registrada.', 'hint'));
  for (const transition of mapping.payload.map.transitions) {
    transitions.append(el('p', `${referenceLabel(transition.id, 'Transição')}: ${referenceLabel(transition.from, 'Tela')} → ${referenceLabel(transition.to, 'Tela')} · ${referenceLabel(transition.actionId, 'Ação')}`, 'text-content'),
      el('p', `Capturas: ${referenceList(transition.observationIds, 'Captura')}`, 'hint'));
  }
  panel.append(transitions);

  const paths = el('details', null, 'plan-section');
  paths.append(el('summary', `Caminhos (${mapping.payload.map.paths.length})`));
  if (!mapping.payload.map.paths.length) paths.append(el('p', 'Nenhum caminho registrado.', 'hint'));
  for (const path of mapping.payload.map.paths) {
    paths.append(el('p', `${referenceLabel(path.id, 'Percurso')}: ${[path.startScreenId, ...path.transitionIds.map(id => mapping.payload.map.transitions.find(item => item.id === id)?.to).filter(Boolean)].map(id => referenceLabel(id, 'Tela')).join(' → ')}`, 'text-content'));
  }
  panel.append(paths);

  const pendings = el('details', null, 'plan-section');
  pendings.append(el('summary', `Pendências (${mapping.payload.pending.length})`));
  if (!mapping.payload.pending.length) pendings.append(el('p', 'Nenhuma pendência registrada.', 'hint'));
  for (const item of mapping.payload.pending) {
    pendings.append(el('p', `${referenceLabel(item.id, 'Pendência')} — ${item.description}`, 'text-content'),
      el('p', `Casos afetados: ${referenceList(item.affectedCaseIds, 'Caso') || 'Nenhum'}`, 'hint'));
  }
  panel.append(pendings);

  if (mapping.payload.limitations.length) panel.append(planSection('Limitações do mapa', mapping.payload.limitations));
  panel.append(planSection('Situação da validação', mapping.validations,
    value => `${validations[value.status] || value.status} · Revisão ${value.outputRevision} · ${roles[value.validator] || value.validator}${value.reason ? ' — ' + value.reason : ''}`));
  for (const verdict of mapping.validations) {
    if (verdict.findings?.length) panel.append(planSection('Achados da validação', verdict.findings,
      value => `${value.location || 'Geral'} — ${value.message}`));
  }

  if (run.mappingActions.length) {
    const actions = el('details', null, 'plan-section');
    actions.append(el('summary', `Ações registradas (${run.mappingActions.length})`));
    for (const action of run.mappingActions) {
      actions.append(el('p', `${toolNames[action.tool] || 'Ação de navegação'} · ${date(action.at)}${action.observationId ? ' · ' + referenceLabel(action.observationId, 'Captura') : ''}${action.note ? ' — ' + action.note : ''}`, 'hint'));
    }
    panel.append(actions);
  }

  if (run.canMap && run.status === 'awaiting_input' && run.cases) {
    const retrySection = el('section', null, 'plan-section');
    retrySection.append(el('h3', 'Nova tentativa de mapeamento'),
      el('p', 'Corrija a credencial de teste na aba Visão geral e solicite explicitamente uma nova tentativa. O histórico e o tempo consumido são preservados.'));
    const notice = message(); retrySection.append(notice);
    const retry = button('Mapear aplicação (nova tentativa)', async () => {
      retry.disabled = true; tell(notice, 'Solicitando nova tentativa de mapeamento…');
      try {
        await sameAccount(accountId); if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(run.id)}/continue`, { accountId, method: 'POST',
          body: JSON.stringify({ outputId: run.cases.id, outputRevision: run.cases.revision, expectedAccessRevision: run.targetAccess.revision }) });
        await detailPage('Nova tentativa aceita. Acompanhe o mapeamento na aba Mapa.');
      } catch (error) { if (user?.id === accountId) await detailPage(errorText(error), true); }
    });
    retrySection.append(retry); panel.append(retrySection);
  }
  return panel;
}
function pendingComment(run, accountId, pending) {
  const planComment = document.getElementById('comment')?.value;
  if (planComment && run.plan) {
    return { accountId, runId: run.id, outputId: run.plan.id, outputRevision: run.plan.revision, comment: planComment, decision: 'changes_requested' };
  }
  const caseComment = document.getElementById('case-comment')?.value;
  if (caseComment && run.cases) {
    return { accountId, runId: run.id, outputId: run.cases.id, outputRevision: run.cases.revision, comment: caseComment, decision: 'changes_requested' };
  }
  return pending;
}
const canAnswer = run => run.canAnswer ?? (['curation', 'planning', 'mapping', 'route_detail', 'execution'].includes(run.phase) && ['awaiting_input', 'awaiting_approval', 'ready'].includes(run.status));
function questionPanel(run, accountId, pending) {
  const panel = el('section', null, 'panel'); panel.append(el('h2', 'Perguntas e esclarecimentos'),
    el('p', 'Responda às perguntas para continuar. Mudanças de regra ou escopo precisarão de nova revisão e aprovação.'));
  const editable = canAnswer(run);
  for (const [index, question] of run.questions.entries()) {
    const item = el('section', null, 'plan-section');
    const scope = question.caseIds?.length ? `Casos afetados: ${referenceList(question.caseIds, 'Caso')}` : question.ruleIds?.length ? `Critérios afetados: ${referenceList(question.ruleIds, 'Critério')}` : question.requirementIds.length ? `Requisitos afetados: ${referenceList(question.requirementIds, 'Requisito')}` : 'Afeta todo o material';
    item.append(el('h3', referenceLabel(question.id, 'Pergunta')), el('p', question.description, 'text-content'),
      el('p', `${scope}. ${question.blocking ? 'Os itens indicados aguardam esta resposta.' : 'Não bloqueia o planejamento.'}`, 'hint'));
    for (const source of question.sources) item.append(el('p', sourceLabel(source), 'hint'), el('blockquote', source.quote, 'text-content'));
    const key = `${accountId}:${run.id}:${question.outputId}:${question.outputRevision}:${question.id}`;
    const answer = run.answers?.find(value => value.id === question.answerId);
    if (answer) {
      if (answerDrafts.get(key)?.text === answer.text) answerDrafts.delete(key);
      item.append(el('p', `Resposta · Versão ${answer.revision || 1} registrada em ${date(answer.at)}`, 'hint'), el('p', answer.text, 'text-content'));
    }
    if (editable && question.outputId) {
      const correction = answer ? el('details', null, 'plan-section') : null;
      if (correction) { correction.append(el('summary', 'Corrigir resposta')); item.append(correction); }
      const form = el('form'); form.noValidate = true;
      const response = field(form, `answer-${index}`, `Resposta para ${referenceLabel(question.id, 'Pergunta')}`, { textarea: true, hint: 'Até 4.000 caracteres. Confirme o comportamento esperado; não inclua senhas.' });
      response.input.value = answerDrafts.get(key)?.text ?? answer?.text ?? '';
      const remember = () => answerDrafts.set(key, { text: response.input.value, questionId: question.id, outputRevision: question.outputRevision });
      response.input.addEventListener('input', remember);
      const notice = message(); const save = button(answer ? 'Registrar correção' : 'Registrar resposta'); save.type = 'submit'; form.append(save, notice); (correction || item).append(form);
      let sending = false;
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (sending) return;
        const payload = { outputId: question.outputId, outputRevision: question.outputRevision, questionId: question.id, text: response.input.value, expectedAnswerRevision: answer?.revision ?? 0 };
        const problem = !payload.text.trim() ? 'Informe a resposta.' : count(payload.text) > 4000 ? 'Use até 4.000 caracteres.' : bytes(JSON.stringify(payload)) > limit ? 'A resposta excede o limite. Reduza-a e tente novamente.' : '';
        if (invalid(response, problem)) { response.input.focus(); return; }
        remember(); const activeComment = pendingComment(run, accountId, pending);
        sending = true; save.disabled = response.input.readOnly = true; tell(notice, 'Registrando resposta…');
        try {
          await sameAccount(accountId); if (user?.id !== accountId) return;
          await api(`/runs/${encodeURIComponent(run.id)}/answer`, { accountId, method: 'POST', body: JSON.stringify(payload) });
          answerDrafts.delete(key); await detailPage('Resposta registrada. Confira as demais dúvidas antes de retomar.', false, activeComment);
        } catch (error) {
          if (user?.id !== accountId) return;
          if (error.status === 409 || !error.status || error.status >= 500) {
            tell(notice, `${errorText(error)} Consulte o registro antes de tentar novamente. A resposta digitada está preservada nesta aba; não será reenviada automaticamente.`, true);
            item.append(button('Consultar registro atualizado', () => detailPage('', false, activeComment), 'secondary'));
          } else { tell(notice, errorText(error), true); sending = false; save.disabled = response.input.readOnly = false; }
        }
      });
    }
    panel.append(item);
  }
  return panel;
}
async function detailPage(noticeText = '', isError = false, pending = null) {
  if (!user) return;
  clearTimeout(detailTimer); const sequence = ++detailSequence;
  const accountId = user.id;
  const focusedTab = document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.id : null;
  selectDetailTab = null;
  main.replaceChildren(); main.append(message('Carregando execução…')); main.setAttribute('aria-busy', 'true');
  const id = location.pathname.split('/')[2]; let run;
  if (pending && (pending.accountId !== accountId || pending.runId !== id)) pending = null;
  // Capturas da execução anterior são revogadas ao trocar de execução.
  if (evidenceRunId && evidenceRunId !== id) revokeEvidence();
  evidenceRunId = id;
  try { run = await api(`/runs/${encodeURIComponent(id)}`, { accountId }); if (user?.id !== accountId || sequence !== detailSequence) return; }
  catch (error) {
    if (user && sequence === detailSequence) { main.replaceChildren(link('← Minhas execuções', '/execucoes', 'back-link'), message([noticeText, errorText(error)].filter(Boolean).join(' '), true));
      if (pending) main.append(preservedComment(pending));
      if (error.status !== 404) main.append(button('Tentar novamente', () => detailPage(noticeText, isError, pending), 'secondary')); }
    main.setAttribute('aria-busy', 'false'); return;
  }
  main.setAttribute('aria-busy', 'false'); revokeEvidence(); main.replaceChildren(link('← Minhas execuções', '/execucoes', 'back-link'));
  currentArtifacts = run.artifacts || []; currentAnswerSources = run.answers || []; prepareReferenceNames(run);
  heading(run.name, run.applicationName); if (noticeText) main.append(message(noticeText, isError));
  const metadata = el('dl', null, 'metadata');
  for (const [title, value] of [['Criada em', date(run.createdAt)], ['Etapa', phases[run.phase] || run.phase], ['Situação', statuses[run.status] || run.status]]) { const item = el('div'); item.append(el('dt', title), el('dd', value, title === 'Situação' ? `status-badge status-${run.status}` : '')); metadata.append(item); }
  const summary = el('section', null, 'panel run-summary'); summary.setAttribute('aria-label', 'Resumo da execução');
  const summaryHeading = el('div', null, 'summary-heading'); summaryHeading.append(metadata, runManagement(run, accountId)); summary.append(summaryHeading); main.append(summary);
  const views = detailTabs();
  if (focusedTab) document.getElementById(focusedTab)?.focus({ preventScroll: true });
  views.results.append(resultsPanel(run, accountId));
  if (run.versions?.length) views.overview.append(planSection('Histórico de versões', run.versions, item => `${referenceLabel(item.id, 'Saída')} · Revisão ${item.revision}`));
  if (run.invalidations?.length) views.overview.append(planSection('Versões invalidadas', run.invalidations, item => `${referenceLabel(item.outputId, 'Saída')} · Revisão ${item.outputRevision} — ${item.reason}`));
  if (currentArtifacts.length) views.overview.append(planSection('Fontes recebidas', currentArtifacts, item => `${item.name} · ${item.pages?.length ? `${item.pages.length} páginas · ` : ''}Revisão ${item.version}`));
  if (run.progress?.activeRole || run.progress?.activity) {
    summary.append(message(activities[run.progress.activity] || 'Processando a execução…'));
  }
  if (run.stopReason) {
    const technical = ['AUTH_NOT_CONFIGURED', 'MODEL_NOT_CONFIGURED', 'MODEL_UNAVAILABLE', 'CREDENTIAL_UNAVAILABLE', 'MODEL_ERROR', 'INVALID_OUTPUT', 'INVALID_MODEL_OUTPUT', 'STORAGE_FAILURE', 'TIMEOUT', 'VALIDATOR_LIMIT', 'REVISION_LIMIT', 'CONTEXT_LIMIT', 'TARGET_NOT_ALLOWED'].includes(run.stopReason.code);
    summary.append(message(technical ? errorText(run.stopReason) : run.stopReason.message, ['error', 'interrupted'].includes(run.status)));
  }
  const summaryActions = el('div', null, 'actions summary-actions'); summary.append(summaryActions);
  if (run.targetAccess) views.overview.append(targetAccessPanel(run, accountId));
  if (run.cases) views.cases.append(casesPanel(run, accountId, pending));
  else {
    const empty = el('section', null, 'panel empty');
    const text = run.canCreateCases ? 'Selecione “Gerar casos de teste” para continuar.'
      : run.status === 'running' && run.phase === 'case_design' ? 'Criando os casos de teste. Acompanhe o progresso da execução.'
      : ['completed', 'cancelled', 'interrupted', 'error'].includes(run.status) ? 'Nenhum caso está disponível nesta execução.'
      : 'Os casos ficarão disponíveis após a aprovação do plano e sua geração.';
    empty.append(el('h2', 'Casos de teste'), el('p', text)); views.cases.append(empty);
  }
  if (run.mapping) views.map.append(mappingPanel(run, accountId));
  else {
    const empty = el('section', null, 'panel empty');
    const text = run.canMap ? 'Selecione “Mapear aplicação” para continuar.'
      : run.status === 'running' && run.phase === 'mapping' ? 'Mapeando a aplicação. Acompanhe o progresso da execução.'
      : ['completed', 'cancelled', 'interrupted', 'error'].includes(run.status) ? 'Nenhum mapa está disponível nesta execução.'
      : 'O mapa ficará disponível após a aprovação dos casos, a configuração do acesso e o mapeamento da aplicação.';
    empty.append(el('h2', 'Mapa de navegação'), el('p', text)); views.map.append(empty);
  }
  const mappingStart = views.cases.querySelector('.mapping-start');
  if (mappingStart) summary.append(mappingStart);
  if (run.canDetailRoutes || run.routeDetail || run.phase === 'route_detail') views.cases.append(routeDetailPanel(run, accountId));
  if (run.curation) views.overview.append(curationPanel(run.curation, run));
  if (run.questions?.length) views.overview.append(questionPanel(run, accountId, pending));
  for (const [key, draft] of answerDrafts) {
    if (!key.startsWith(`${accountId}:${id}:`) || !draft.text.trim()) continue;
    if (canAnswer(run) && run.questions.some(question => question.outputId && !question.answerId && key === `${accountId}:${id}:${question.outputId}:${question.outputRevision}:${question.id}`)) continue;
    const copy = el('section', null, 'panel'); copy.append(el('h3', `Texto não enviado · ${referenceLabel(draft.questionId, 'Pergunta')} · Revisão ${draft.outputRevision}`),
      el('p', 'A pergunta ou sua resposta mudou. Este texto foi preservado para consulta e cópia; não será reaplicado.'), el('blockquote', draft.text, 'text-content'),
      button('Descartar este texto não enviado', () => { answerDrafts.delete(key); copy.remove(); }, 'secondary'));
    views.overview.append(copy);
  }
  if (run.answers?.length) views.overview.append(planSection('Histórico de esclarecimentos', run.answers,
    value => `${referenceLabel(value.questionId, 'Pergunta')} · Resposta · Versão ${value.revision || 1} · Versão relacionada ${value.outputRevision} · ${date(value.at)} — ${value.text}`));
  if (run.canResume) {
    const notice = message(); const resume = button(['curation', 'planning'].includes(run.phase) ? 'Retomar preparação com as respostas' : 'Retomar com as respostas', async () => {
      if ([...answerDrafts].some(([key, draft]) => key.startsWith(`${accountId}:${id}:`) && draft.text.trim())) {
        tell(notice, 'Há uma resposta digitada que ainda não foi registrada. Registre-a ou apague o texto antes de retomar.', true); return;
      }
      const activeComment = pendingComment(run, accountId, pending);
      resume.disabled = true; tell(notice, 'Solicitando análise das respostas e retomada…');
      try {
        await sameAccount(accountId); if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(id)}/resume`, { accountId, method: 'POST', body: '{}' });
        await detailPage('Retomada aceita. As novas revisões aparecerão abaixo.', false, activeComment);
      } catch (error) { if (user?.id === accountId) await detailPage(errorText(error), true, activeComment); }
    });
    summaryActions.append(resume, notice);
  }
  if ((run.status === 'draft' && run.phase === 'intake') || (run.canCancel ?? ['running', 'ready', 'awaiting_input', 'awaiting_approval'].includes(run.status))) {
    const operation = run.status === 'draft' ? 'start' : 'cancel';
    const notice = message(); const action = button(operation === 'start' ? 'Preparar plano' : run.status === 'running' && ['curation', 'planning'].includes(run.phase) ? 'Cancelar preparação' : 'Cancelar execução', async () => {
      action.disabled = true; clearTimeout(detailTimer); detailSequence++;
      tell(notice, operation === 'start' ? 'Solicitando a preparação do plano…' : 'Solicitando cancelamento…');
      try {
        await sameAccount(accountId); if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(id)}/${operation}`, { accountId, method: 'POST', body: '{}' });
        await detailPage(operation === 'start' ? 'Preparação aceita. Acompanhe o progresso abaixo.' : 'Cancelamento registrado.');
      } catch (error) {
        if (user?.id === accountId) await detailPage(errorText(error), true);
      }
    }, operation === 'cancel' ? 'secondary' : '');
    summaryActions.append(action, notice);
  }
  const nextActions = [
    [run.canExecute, 'Executar testes', 'continue', run.routeDetail ? { outputId: run.routeDetail.id, outputRevision: run.routeDetail.revision, expectedAccessRevision: run.targetAccess.revision } : {}],
    [run.canWriteReport, 'Gerar relatório', 'report', {}],
    [run.canClosePending && !run.canWriteReport, 'Encerrar com pendências', 'finish-with-pending', {}],
    [run.canPartialReport, 'Gerar relatório parcial', 'partial-report', {}],
    [run.canAnalyzeFeedback, 'Aplicar alterações solicitadas', 'continue', (() => { const decision = run.approvals.findLast(item => item.decision === 'changes_requested' && [run.plan, run.cases].some(output => output?.id === item.outputId && output.revision === item.outputRevision)); return decision ? { outputId: decision.outputId, outputRevision: decision.outputRevision } : {}; })()],
  ];
  for (const [available, label, operation, body] of nextActions) {
    if (!available) continue;
    const notice = message(); const action = button(label, async () => {
      action.disabled = true; tell(notice, 'Solicitando continuidade…');
      try { await sameAccount(accountId); await api(`/runs/${encodeURIComponent(id)}/${operation}`, { accountId, method: 'POST', body: JSON.stringify(body) }); await detailPage('Solicitação aceita. Acompanhe o progresso.'); }
      catch (error) { if (user?.id === accountId) await detailPage(errorText(error), true); }
    }); summaryActions.append(action, notice);
  }
  if (run.questions?.length) summaryActions.append(button('Ver perguntas e respostas', () => views.choose('overview', true), 'secondary'));
  if (run.status === 'awaiting_approval' && run.phase === 'planning') summaryActions.append(button('Revisar plano', () => views.choose('plan', true), 'secondary'));
  if (run.canDecideCases) summaryActions.append(button('Revisar casos', () => views.choose('cases', true), 'secondary'));
  if (run.canDetailRoutes) summaryActions.append(button('Ver etapa de percursos', () => views.choose('cases', true), 'secondary'));
  if (run.canCreateCases && run.plan) {
    const notice = message(); const generate = button('Gerar casos de teste', async () => {
      generate.disabled = true; tell(notice, 'Solicitando a geração dos casos de teste…');
      try {
        await sameAccount(accountId); if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(id)}/continue`, { accountId, method: 'POST',
          body: JSON.stringify({ outputId: run.plan.id, outputRevision: run.plan.revision }) });
        await detailPage('Geração aceita. Acompanhe a produção e a validação independente dos casos.');
      } catch (error) { if (user?.id === accountId) await detailPage(errorText(error), true); }
    });
    summaryActions.append(generate, notice);
  }
  if (run.status === 'running') {
    // ponytail: consulta simples durante o trabalho; a revisão humana não reconstrói formulários.
    const poll = () => {
      if (user?.id !== accountId || sequence !== detailSequence) return;
      if (document.hidden) detailTimer = setTimeout(poll, 2000);
      else void detailPage('', false, pending);
    };
    detailTimer = setTimeout(poll, 2000);
  }
  if (pending && run.approvals.some(decision => decision.outputId === pending.outputId &&
      decision.outputRevision === pending.outputRevision && decision.decision === pending.decision &&
      (pending.decision === 'approved' || decision.comment === pending.comment))) pending = null;
  const restorePlanComment = pending && run.plan?.id === pending.outputId && run.plan.revision === pending.outputRevision &&
    !run.approvals.some(decision => decision.outputId === pending.outputId && decision.outputRevision === pending.outputRevision);
  const restoreCaseComment = pending && run.cases?.id === pending.outputId && run.cases.revision === pending.outputRevision &&
    !run.approvals.some(decision => decision.outputId === pending.outputId && decision.outputRevision === pending.outputRevision);
  if (pending && !restorePlanComment && !restoreCaseComment) main.append(preservedComment(pending));
  if (!run.plan) {
    const empty = el('section', null, 'panel empty'); empty.append(el('h2', 'Plano de testes'), el('p', run.status === 'draft' ? 'Selecione “Preparar plano” para começar.' : run.status === 'running' ? 'Preparando o plano. Acompanhe o progresso da execução.' : 'Ainda não há plano disponível para consulta.')); views.plan.append(empty);
    if (run.status === 'draft') summary.append(message('Material recebido. O processamento ainda não foi iniciado.'));
    return;
  }
  const plan = run.plan; const content = plan.payload.testPlan; const panel = el('section', null, 'panel');
  panel.append(el('p', `Plano de testes / Revisão ${plan.revision}`, 'eyebrow'), el('h2', 'Revisão do plano'), el('h3', 'Objetivo'), el('p', content.objective, 'text-content'));
  panel.append(planSection('Requisitos referenciados', content.requirementIds, id => referenceLabel(id, 'Requisito')), planSection('Critérios referenciados', content.ruleIds, id => referenceLabel(id, 'Critério')), planSection('Prioridades', content.priorities, item => `${referenceLabel(item.ruleId, 'Critério')} — ${item.reason}`), planSection('Exclusões', content.exclusions, item => `${item.description} — ${item.reason}`), planSection('Abordagem', content.approach), planSection('Pré-condições', content.preconditions));
  const sources = el('section', null, 'plan-section'); sources.append(el('h3', 'Fontes'));
  if (!content.sources.length) sources.append(el('p', 'Nenhuma fonte informada.', 'hint'));
  for (const source of content.sources) { sources.append(el('p', sourceLabel(source), 'text-content'), el('blockquote', source.quote, 'text-content')); }
  panel.append(sources, planSection('Situação da validação', plan.validations, value => `${validations[value.status] || value.status} · Revisão ${value.outputRevision} · ${roles[value.validator] || value.validator}`));
  const planDecisions = run.approvals.filter(value => value.outputId === plan.id);
  const decisions = el('section', null, 'plan-section'); decisions.append(el('h3', 'Decisões registradas'));
  if (!planDecisions.length) decisions.append(el('p', 'Nenhuma decisão registrada.', 'hint'));
  for (const decision of planDecisions) {
    const item = el('div', null, 'decision'); item.append(el('p', `${decision.decision === 'approved' ? 'Plano aprovado' : 'Alterações solicitadas'} · Revisão ${decision.outputRevision}`), el('p', date(decision.at), 'hint'));
    if (decision.comment) item.append(el('p', decision.comment, 'text-content')); decisions.append(item);
  }
  panel.append(decisions); views.plan.append(panel);
  const currentDecisions = planDecisions.filter(value => value.outputRevision === plan.revision);
  const verdicts = plan.validations.filter(value => value.validator === 'output-validator' && value.status !== 'error');
  const eligible = run.status === 'awaiting_approval' && run.phase === 'planning' && verdicts.length === 1 && verdicts[0].status === 'approved' && currentDecisions.length === 0;
  if (!eligible) {
    const waiting = run.status === 'awaiting_approval' && run.phase === 'planning';
    views.plan.append(message(currentDecisions.length ? `A decisão desta revisão está registrada.${waiting ? ' A execução permanece em espera; a continuidade ainda não foi iniciada.' : ''}` : 'A revisão está disponível para consulta. Uma decisão exige a etapa de aprovação e um parecer aprovado do validador.'));
    if (restorePlanComment) views.plan.append(preservedComment(pending));
    summaryActions.append(button('Atualizar consulta', () => detailPage('', false, pendingComment(run, accountId, pending)), 'secondary')); return;
  }
  const review = el('section', null, 'panel'); review.append(el('h2', `Decidir sobre a revisão ${plan.revision}`), el('p', 'Revise o plano antes de aprová-lo. Depois, gere os casos de teste.'));
  const notice = message(); review.append(notice); const form = el('form'); form.noValidate = true;
  const comment = field(form, 'comment', 'Comentário', { optional: true, textarea: true, hint: 'Obrigatório ao solicitar alterações. Até 4.000 caracteres.' });
  if (restorePlanComment) comment.input.value = pending.comment;
  const actions = el('div', null, 'actions'); const approve = button('Aprovar plano'); const change = button('Solicitar alterações', null, 'secondary'); actions.append(approve, change); form.append(actions); review.append(form); views.plan.append(review);
  form.addEventListener('submit', event => event.preventDefault()); let submitting = false;
  const decide = async changes => {
    if (submitting) return;
    if (changes && invalid(comment, !comment.input.value.trim() ? 'Informe um comentário para solicitar alterações.' : count(comment.input.value) > 4000 ? 'Use até 4.000 caracteres.' : '')) { comment.input.focus(); return; }
    const payload = { outputId: plan.id, outputRevision: plan.revision, ...(changes ? { comment: comment.input.value } : {}) };
    if (bytes(JSON.stringify(payload)) > limit) { invalid(comment, 'O comentário excede o limite. Reduza-o e tente novamente.'); comment.input.focus(); return; }
    pending = { accountId, runId: id, outputId: plan.id, outputRevision: plan.revision, comment: comment.input.value,
      decision: changes ? 'changes_requested' : 'approved' };
    submitting = true; approve.disabled = change.disabled = comment.input.readOnly = true; tell(notice, 'Registrando decisão…');
    try {
      await sameAccount(accountId);
      if (user?.id !== accountId) return;
      await api(`/runs/${encodeURIComponent(id)}/${changes ? 'request-changes' : 'approve'}`, { accountId, method: 'POST', body: JSON.stringify(payload) });
      await detailPage('Decisão registrada.', false, pending); main.focus();
    } catch (error) {
      if (!user) return;
      if (error.status === 409) { await detailPage(`Decisão recusada. ${errorText(error)} Nenhuma decisão foi reaplicada.`, true, pending); main.focus(); }
      else if (!error.status || error.status >= 500) { await detailPage('Não foi possível confirmar a decisão pela resposta. Consulte o registro salvo antes de decidir novamente; nenhuma decisão será reaplicada automaticamente.', true, pending); main.focus(); }
      else { tell(notice, errorText(error), true); submitting = false; approve.disabled = change.disabled = comment.input.readOnly = false; }
    }
  };
  approve.addEventListener('click', () => decide(false)); change.addEventListener('click', () => decide(true));
}

async function boot() {
  try {
    const session = await api('/auth/me'); user = session.user;
    if (location.pathname === '/acesso') { location.replace(target()); return; }
    navigation();
    if (location.pathname === '/execucoes') historyPage();
    else if (location.pathname === '/execucoes/nova') intakePage();
    else if (location.pathname === '/perfil') profilePage();
    else await detailPage();
    if (!user) return;
    sessionTimer = setInterval(() => { if (!document.hidden) void sessionCheck(); }, 30000);
  } catch (error) {
    if (location.pathname === '/acesso') access(error.code === 'INVALID_SESSION' ? '' : errorText(error));
    else if (error.code !== 'INVALID_SESSION') main.replaceChildren(message(errorText(error), true), button('Tentar novamente', boot, 'secondary'));
  }
}
// Limpa o snapshot privado antes de entrar no cache de navegação do navegador.
addEventListener('pagehide', () => { if (rememberForm) rememberForm(); revokeEvidence(); clearTimeout(detailTimer); detailSequence++; selectDetailTab = null; main.replaceChildren(); account.replaceChildren(); });
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
addEventListener('hashchange', () => selectDetailTab?.());
addEventListener('popstate', () => selectDetailTab?.());
document.addEventListener('visibilitychange', () => {
  if (!user) return;
  if (document.hidden) { main.hidden = true; account.hidden = true; }
  else void sessionCheck().then(() => { if (user) { main.hidden = false; account.hidden = false; } });
});
void boot();
