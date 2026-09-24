'use strict';

const main = document.querySelector('#main');
const account = document.querySelector('#account');
const storagePrefix = 'akcit.intake.v1:';
const limit = 16 * 1024;
const statuses = { draft: 'Rascunho', running: 'Em andamento', awaiting_approval: 'Aguardando aprovação', awaiting_input: 'Aguardando informações', completed: 'Concluída', interrupted: 'Interrompida', error: 'Erro', cancelled: 'Cancelada' };
const phases = { intake: 'Recebimento do material', curation: 'Curadoria', planning: 'Planejamento', case_design: 'Criação dos casos', mapping: 'Mapeamento', route_detail: 'Detalhamento dos percursos', execution: 'Execução dos testes', report: 'Relatório' };
const validations = { approved: 'Aprovado pelo validador', changes_requested: 'Validador solicitou alterações', blocked: 'Validação bloqueada', error: 'Erro de validação' };
const roles = { 'artifact-curator': 'Curador', 'test-designer': 'Designer de testes', 'output-validator': 'Validador independente' };
const activities = { curating: 'Organizando requisitos e fontes', planning: 'Elaborando o plano de testes', validating_curation: 'Revisando a curadoria', validating_planning: 'Revisando o plano de testes', case_design: 'Gerando casos de teste', validating_case_design: 'Validando os casos de teste' };
let user = null;
let rememberForm = null;
let sessionTimer;
let checkingSession = null;
let signedOut = false;
let detailTimer;
let detailSequence = 0;
const answerDrafts = new Map();

// Dados da API entram somente como texto. Nenhum conteúdo recebido vira HTML.
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
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
  document.title = `${title} · AKCIT`;
  const header = el('div', null, 'page-heading'); const copy = el('div');
  copy.append(el('p', 'Workspace / Qualidade de software', 'eyebrow'), el('h1', title));
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
function invalid(fieldRef, text) {
  fieldRef.error.textContent = text; fieldRef.input.setAttribute('aria-invalid', String(!!text));
  return !!text;
}
const count = value => [...value].length;
const bytes = value => new TextEncoder().encode(value).byteLength;
const date = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const internal = value => /^\/execucoes(?:\/(?:nova|[A-Za-z0-9][A-Za-z0-9_-]{0,127}))?(?:\?[^#]*)?$/.test(value || '') ? value : '/execucoes';
const target = () => internal(new URLSearchParams(location.search).get('next'));

function errorText(error) {
  const texts = {
    INVALID_CREDENTIALS: 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
    REGISTRATION_NOT_ALLOWED: 'Este participante não está habilitado. Solicite a liberação à equipe do piloto.',
    ACCOUNT_EXISTS: 'Este e-mail já tem uma conta. Use Entrar para continuar.',
    TOO_MANY_ATTEMPTS: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.',
    ORIGIN_REJECTED: 'Este endereço não está habilitado para envio. Peça à equipe para conferir a origem configurada.',
    AUTH_NOT_CONFIGURED: 'O acesso ainda não foi configurado. Entre em contato com a equipe do piloto.',
    INVALID_INPUT: 'Confira os campos e seus limites antes de tentar novamente.',
    BODY_TOO_LARGE: 'O envio completo ultrapassa 16 KiB. Reduza o texto ou os demais campos.',
    COMMENT_REQUIRED: 'Informe um comentário para solicitar alterações.',
    STALE_VERSION: 'A revisão ou suas dependências mudaram. Consulte o plano atualizado antes de decidir novamente.',
    DECISION_CONFLICT: 'Esta revisão já possui uma decisão diferente. Consulte a decisão salva.',
    DECISION_MISSING: 'Aprove a revisão vigente do plano antes de gerar os casos de teste.',
    INVALID_STATE: 'A execução não permite esta operação no estado atual. Consulte o estado atualizado.',
    INSUFFICIENT_VALIDATION: 'O plano e a curadoria precisam de validação aprovada. A decisão foi recusada.',
    IDEMPOTENCY_CONFLICT: 'A chave já está associada a outro conteúdo. A tentativa foi preservada; consulte o histórico e solicite ajuda à equipe.',
    RUN_NOT_FOUND: 'Execução não encontrada ou indisponível para esta conta.',
    RESOURCE_UNAVAILABLE: 'O ambiente está ocupado com outra execução. O material e as decisões foram preservados; tente novamente após a conclusão.',
    MODEL_NOT_CONFIGURED: 'A preparação exige a configuração do provedor e modelo para curador, planejador e validador. Solicite a configuração à equipe do piloto.',
    MODEL_UNAVAILABLE: 'O modelo configurado não está disponível. Solicite à equipe a conferência da configuração.',
    CREDENTIAL_UNAVAILABLE: 'A credencial do modelo não está disponível. Solicite a configuração à equipe do piloto.',
    ANSWER_CONFLICT: 'Esta pergunta já possui outra resposta. Consulte a resposta registrada.',
    QUESTION_NOT_FOUND: 'A pergunta não está disponível nesta revisão. Consulte o material atualizado.',
    ACTIVE_LIMIT: 'Esta execução atingiu o limite de processamento ativo. As respostas e os resultados salvos estão preservados.',
  };
  return texts[error.code] || (error.status === 409 ? 'O registro não permite esta operação. Atualize a consulta e, se persistir, solicite ajuda à equipe.' : 'Não foi possível concluir a solicitação. Verifique a conexão e tente novamente.');
}
async function api(path, { accountId, ...options } = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
  if (rememberForm) rememberForm();
  user = null; rememberForm = null; answerDrafts.clear(); clearInterval(sessionTimer); clearTimeout(detailTimer); detailSequence++;
  main.replaceChildren(); account.replaceChildren(); main.hidden = false;
  location.replace(`/acesso?expired=1&next=${encodeURIComponent(internal(location.pathname + location.search))}`);
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
  account.replaceChildren(link('Minhas execuções', '/execucoes'), el('span', user.name, 'account-name'));
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
  }, 'secondary'); account.append(exit);
}

function access(serviceMessage = '') {
  main.replaceChildren(); document.title = 'Acesso · AKCIT';
  const layout = el('div', null, 'auth-layout'); const story = el('section', null, 'auth-story');
  story.append(el('p', 'AKCIT / Qualidade de software', 'eyebrow'), el('h1', 'Seu próximo teste começa com o comportamento esperado.'), el('p', 'Reúna histórias, requisitos ou exemplos do comportamento esperado. Salve o material e revise o plano quando estiver disponível.', 'lead'));
  const steps = el('div', null, 'auth-steps');
  for (const [number, title] of [['01', 'Reúna o material'], ['02', 'Salve a execução'], ['03', 'Revise o plano']]) { const step = el('div'); step.append(el('strong', number), el('span', title)); steps.append(step); }
  story.append(steps); const panel = el('section', null, 'panel'); layout.append(story, panel); main.append(layout);
  let register = false;
  const render = () => {
    panel.replaceChildren(); const tabs = el('div', null, 'auth-switch');
    for (const [label, value] of [['Entrar', false], ['Criar conta', true]]) {
      const tab = button(label, () => { register = value; render(); panel.querySelector('input').focus(); }, 'secondary');
      tab.setAttribute('aria-pressed', String(register === value)); tabs.append(tab);
    }
    panel.append(tabs, el('h2', register ? 'Participe do piloto' : 'Bem-vindo de volta'));
    const cleanupMessage = new URLSearchParams(location.search).has('cleanup') ? 'Saída confirmada, mas não foi possível limpar a recuperação local desta aba. Feche a aba ou limpe o armazenamento do navegador.' : '';
    const notice = message(cleanupMessage || serviceMessage || (new URLSearchParams(location.search).has('expired') ? 'Sua sessão expirou ou mudou. Entre novamente. Conteúdo pendente só será recuperado para a mesma conta.' : ''), !!serviceMessage || !!cleanupMessage); panel.append(notice);
    const form = el('form'); form.noValidate = true; const fields = {};
    if (register) fields.name = field(form, 'name', 'Nome', { autocomplete: 'name', hint: 'Até 120 caracteres.' });
    fields.email = field(form, 'email', 'E-mail', { type: 'email', autocomplete: 'username' });
    fields.password = field(form, 'password', 'Senha', { type: 'password', autocomplete: register ? 'new-password' : 'current-password', hint: 'De 15 a 128 caracteres. Espaços fazem parte da senha.' });
    if (register) fields.teamName = field(form, 'teamName', 'Nome da equipe (opcional)', { optional: true, autocomplete: 'organization', hint: 'Até 120 caracteres.' });
    const submit = button(register ? 'Cadastrar e entrar' : 'Entrar na conta', null, 'auth-submit'); submit.type = 'submit'; form.append(submit);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submit.disabled) return; let first;
      for (const [name, ref] of Object.entries(fields)) {
        const value = ref.input.value; let problem = '';
        if (name === 'password' && (count(value) < 15 || count(value) > 128)) problem = 'Use de 15 a 128 caracteres.';
        if (name === 'email' && (!ref.input.validity.valid || count(value.trim()) > 254)) problem = 'Informe um e-mail válido.';
        if (['name', 'teamName'].includes(name) && ((name === 'name' && !value.trim()) || count(value.trim()) > 120)) problem = 'Informe até 120 caracteres; nome é obrigatório.';
        if (invalid(ref, problem) && !first) first = ref.input;
      }
      if (first) { first.focus(); return; }
      const body = { email: fields.email.input.value.trim(), password: fields.password.input.value };
      if (register) { body.name = fields.name.input.value.trim(); if (fields.teamName.input.value.trim()) body.teamName = fields.teamName.input.value.trim(); }
      submit.disabled = true; tabs.querySelectorAll('button').forEach(node => { node.disabled = true; }); tell(notice, 'Conferindo seu acesso…');
      try {
        await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
        fields.password.input.value = ''; await api('/auth/me'); location.replace(target());
      } catch (error) { tell(notice, errorText(error), true); submit.disabled = false; tabs.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
    });
    panel.append(form, el('p', 'Esta é a conta do produto. O acesso usado pelo agente na aplicação testada será configurado separadamente.', 'auth-help'), el('p', 'Precisa recuperar o acesso? Procure a equipe responsável pelo piloto.', 'auth-help'));
  }; render();
}

function historyPage() {
  const accountId = user.id;
  main.replaceChildren(); heading('Minhas execuções', 'Seu material, seus planos e as decisões de cada revisão.', link('Nova execução', '/execucoes/nova', 'button'));
  try { if (readAttempt()?.key) main.append(message('Há um salvamento sem confirmação nesta aba.'), link('Recuperar tentativa de salvamento', '/execucoes/nova', 'back-link')); }
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
        const empty = el('div', null, 'empty'); empty.append(el('span', '+', 'empty-symbol'), el('h2', query.size ? 'Nenhum resultado para este filtro' : 'Sua primeira execução começa aqui'), el('p', query.size ? 'Experimente outro nome, aplicação ou situação.' : 'Você ainda não tem execuções. Reúna requisitos, histórias ou exemplos para salvar o primeiro rascunho.'));
        empty.append(query.size ? link('Limpar filtros', '/execucoes', 'button secondary') : link('Criar primeira execução', '/execucoes/nova', 'button')); results.append(empty);
      } else {
        results.append(el('p', `${data.items.length} ${data.items.length === 1 ? 'execução encontrada' : 'execuções encontradas'}`, 'list-caption'));
        const list = el('ul', null, 'run-list');
        for (const run of data.items) {
          const row = el('li', null, 'run-row'); const identification = el('div'); const name = el('h2'); name.append(link(run.name, `/execucoes/${encodeURIComponent(run.id)}`));
          identification.append(name, el('p', run.applicationName)); const state = el('div'); state.append(el('span', statuses[run.status] || run.status, 'badge'), el('p', phases[run.phase] || run.phase));
          row.append(identification, el('p', date(run.createdAt)), state); list.append(row);
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
  main.replaceChildren(); heading('Nova execução', 'Reúna o material que vai orientar a revisão do plano.');
  const split = el('div', null, 'split'); const panel = el('section', null, 'panel');
  const note = el('aside', null, 'side-note'); note.append(el('span', 'Antes de começar', 'step'), el('h2', 'Um rascunho é o primeiro passo.'), el('p', 'Salvar confirma o recebimento do material. A curadoria e a geração do plano ainda não são iniciadas.'), el('p', 'Neste momento, use texto. Arquivos e acesso à aplicação serão configurados em uma etapa futura.'));
  split.append(panel, note); main.append(split);
  const notice = message(); panel.append(notice); const form = el('form'); form.noValidate = true;
  form.append(el('span', '01 / Identificação', 'step')); const pair = el('div', null, 'two-fields'); form.append(pair);
  const fields = { name: field(pair, 'name', 'Nome da execução', { hint: 'Até 120 caracteres.' }), applicationName: field(pair, 'applicationName', 'Aplicação', { hint: 'Até 120 caracteres.' }) };
  fields.objective = field(form, 'objective', 'Objetivo (opcional)', { textarea: true, optional: true, hint: 'Até 2.000 caracteres.' });
  form.append(el('span', '02 / Material de entrada', 'step'));
  fields.text = field(form, 'text', 'Material de requisitos', { textarea: true, className: 'material', hint: 'Cole histórias, requisitos, critérios ou cenários Gherkin. Gherkin é opcional. Preserve o texto original; dúvidas poderão ser esclarecidas depois.' });
  const meter = el('small'); const footer = el('div', null, 'form-footer'); const submit = button('Salvar rascunho'); submit.type = 'submit'; footer.append(meter, submit); form.append(footer); panel.append(form);
  let attempt = null; let sending = false; let blocked = false;
  const body = () => JSON.stringify(Object.fromEntries(Object.entries(fields).map(([name, ref]) => [name, ref.input.value])));
  const update = () => { meter.textContent = `${bytes(body()).toLocaleString('pt-BR')} / 16.384 bytes do envio completo`; };
  const lock = () => { Object.values(fields).forEach(ref => { ref.input.readOnly = !!attempt?.key; }); submit.textContent = attempt?.key ? 'Tentar confirmar salvamento' : 'Salvar rascunho'; };
  try {
    attempt = readAttempt();
    if (attempt) { const values = JSON.parse(attempt.body); for (const [name, ref] of Object.entries(fields)) ref.input.value = values[name];
      tell(notice, attempt.key ? 'O salvamento anterior ainda não foi confirmado. Tente confirmar usando o conteúdo original abaixo. Ele ficará bloqueado até a confirmação.' : 'Seu formulário pendente foi recuperado para esta conta.'); }
  } catch { blocked = true; submit.disabled = true; tell(notice, 'Não foi possível ler a tentativa salva. O envio está bloqueado para evitar duplicação. Verifique o armazenamento da aba e solicite ajuda à equipe.', true); }
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
        if (name !== 'objective' && !value) problem = 'Preencha este campo.';
        const max = name === 'objective' ? 2000 : name === 'text' ? Infinity : 120;
        if (count(value) > max) problem = `Use até ${max.toLocaleString('pt-BR')} caracteres.`;
        if (name === 'text' && bytes(body()) > limit) problem = 'O JSON completo excede 16 KiB. Reduza o material ou os demais campos.';
        if (invalid(ref, problem) && !first) first = ref.input;
      }
      if (first) { first.focus(); return; }
    }
    sending = true; submit.disabled = true; tell(notice, 'Conferindo sessão e salvando o rascunho…');
    try {
      const candidate = attempt?.key ? attempt : { accountId, key: crypto.randomUUID(), body: body() };
      // Guardar e reler antes de qualquer POST. Falha local nunca dispara um envio.
      try { saveAttempt(candidate); } catch { tell(notice, 'Não foi possível guardar a tentativa nesta aba. Nenhuma solicitação de salvamento foi enviada. Habilite o armazenamento do navegador e tente novamente.', true); return; }
      attempt = candidate;
      lock();
      await sameAccount(candidate.accountId);
      if (user?.id !== accountId) return;
      let run;
      try { run = await api('/runs', { accountId: attempt.accountId, method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: attempt.body }); }
      catch (error) {
        if (!user) return;
        if ([400, 413, 415].includes(error.status)) {
          try { sessionStorage.removeItem(storagePrefix + accountId); attempt = null; lock(); }
          catch { blocked = true; }
          tell(notice, errorText(error), true);
        } else { tell(notice, `${errorText(error)} O salvamento ainda não foi confirmado. Use “Tentar confirmar salvamento” para repetir a tentativa original.`, true); }
        return;
      }
      if (user?.id !== accountId) return;
      if (!run?.id || typeof run.id !== 'string') throw new Error('Resposta sem identificação.');
      try { sessionStorage.removeItem(storagePrefix + accountId); }
      catch { tell(notice, 'Rascunho salvo, mas não foi possível limpar a recuperação local. Repetir esta tentativa é seguro.', true); panel.append(link('Abrir execução salva', `/execucoes/${encodeURIComponent(run.id)}`, 'button')); return; }
      rememberForm = null; tell(notice, 'Rascunho salvo. Abrindo execução…'); location.assign(`/execucoes/${encodeURIComponent(run.id)}`);
    } catch (error) { if (user) tell(notice, `${errorText(error)}${attempt?.key ? ' Confirme a tentativa original antes de iniciar outra.' : ''}`, true); }
    finally { sending = false; submit.disabled = blocked; lock(); }
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
function curationPanel(curation) {
  const panel = el('details', null, 'panel'); panel.append(el('summary', `Entendimento do material · Revisão ${curation.revision}`));
  for (const requirement of curation.payload.requirements) {
    panel.append(el('h3', requirement.id), el('p', requirement.statement, 'text-content'));
    for (const rule of requirement.rules) {
      panel.append(el('p', `${rule.id}${rule.kind === 'example' ? ' · Exemplo recebido' : ''} — ${rule.statement}`, 'text-content'));
      for (const example of rule.examples || []) panel.append(planSection(`Exemplo ${example.id}`, [
        ...example.given.map(value => `Dado: ${value}`), ...example.when.map(value => `Quando: ${value}`), ...example.then.map(value => `Então: ${value}`),
      ]));
      for (const source of rule.sources) panel.append(el('p', `${source.artifactId} · ${source.locator}`, 'hint'), el('blockquote', source.quote, 'text-content'));
    }
  }
  return panel;
}
function casesPanel(cases) {
  const panel = el('section', null, 'panel');
  const verdicts = cases.validations.filter(value => value.validator === 'output-validator' && value.status !== 'error');
  const approved = cases.current && verdicts.length === 1 && verdicts[0].status === 'approved';
  panel.append(el('p', `Casos de teste / Revisão ${cases.revision}`, 'eyebrow'), el('h2', 'Casos de teste'),
    el('p', 'Casos lógicos — percurso ainda não mapeado.', 'lead'),
    message(approved ? 'Conjunto validado. Disponível para revisão humana; a aprovação dos casos será integrada na próxima etapa.'
      : cases.current ? 'Conteúdo provisório — a validação desta revisão ainda não foi aprovada.'
      : 'Conteúdo provisório — as dependências desta revisão foram alteradas.'));
  for (const item of cases.payload.testCases) {
    const detail = el('details', null, 'plan-section'); detail.append(el('summary', `${item.id} · ${item.ruleIds.join(', ')}`));
    detail.append(planSection('Requisitos referenciados', item.requirementIds), planSection('Regras referenciadas', item.ruleIds),
      planSection('Pré-condições', item.preconditions), el('h3', 'Preparação'), el('p', item.setup, 'text-content'),
      planSection('Dados', Object.entries(item.data), ([key, value]) => `${key}: ${JSON.stringify(value)}`),
      planSection('Técnicas', item.techniques, value => `${value.name} — ${value.description}\nValores: ${value.values.map(item => JSON.stringify(item)).join(', ')}`),
      el('h3', 'Resultado esperado'), el('p', item.expected, 'text-content'), el('h3', 'Fontes'));
    for (const source of item.sources) detail.append(el('p', `${source.artifactId} · ${source.locator}`, 'hint'), el('blockquote', source.quote, 'text-content'));
    panel.append(detail);
  }
  panel.append(planSection('Situação da validação', cases.validations,
    value => `${validations[value.status] || value.status} · Revisão ${value.outputRevision} · ${value.validator}${value.reason ? ` — ${value.reason}` : ''}`));
  for (const verdict of cases.validations) {
    if (verdict.findings?.length) panel.append(planSection('Achados da validação', verdict.findings, value => `${value.location} — ${value.message}`));
  }
  return panel;
}
function pendingPlanComment(run, accountId, pending) {
  const comment = document.getElementById('comment')?.value;
  return comment && run.plan ? { accountId, runId: run.id, outputId: run.plan.id, outputRevision: run.plan.revision, comment, decision: 'changes_requested' } : pending;
}
const canAnswer = run => ['curation', 'planning'].includes(run.phase) && ['awaiting_input', 'awaiting_approval'].includes(run.status);
function questionPanel(run, accountId, pending) {
  const panel = el('section', null, 'panel'); panel.append(el('h2', 'Esclarecimentos do material'),
    el('p', 'Responda às dúvidas conhecidas e depois retome a preparação. A resposta será preservada como nova fonte e o plano precisará de nova validação.'));
  const editable = canAnswer(run);
  for (const [index, question] of run.questions.entries()) {
    const item = el('section', null, 'plan-section');
    const scope = question.ruleIds?.length ? `Critérios afetados: ${question.ruleIds.join(', ')}` : question.requirementIds.length ? `Requisitos afetados: ${question.requirementIds.join(', ')}` : 'Afeta todo o material';
    item.append(el('h3', question.id), el('p', question.description, 'text-content'),
      el('p', `${scope}. ${question.blocking ? 'Bloqueia apenas esse escopo.' : 'Não bloqueia o planejamento.'}`, 'hint'));
    for (const source of question.sources) item.append(el('p', `${source.artifactId} · ${source.locator}`, 'hint'), el('blockquote', source.quote, 'text-content'));
    const key = `${accountId}:${run.id}:${question.outputId}:${question.outputRevision}:${question.id}`;
    const answer = run.answers?.find(value => value.id === question.answerId);
    if (answer) {
      if (answerDrafts.get(key)?.text === answer.text) answerDrafts.delete(key);
      item.append(el('p', `Resposta registrada em ${date(answer.at)}`, 'hint'), el('p', answer.text, 'text-content'));
    } else if (editable && question.outputId) {
      const form = el('form'); form.noValidate = true;
      const response = field(form, `answer-${index}`, `Resposta para ${question.id}`, { textarea: true, hint: 'Até 4.000 caracteres. Confirme o comportamento esperado; não inclua senhas.' });
      response.input.value = answerDrafts.get(key)?.text || '';
      const remember = () => answerDrafts.set(key, { text: response.input.value, questionId: question.id, outputRevision: question.outputRevision });
      response.input.addEventListener('input', remember);
      const notice = message(); const save = button('Registrar resposta'); save.type = 'submit'; form.append(save, notice); item.append(form);
      let sending = false;
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (sending) return;
        const payload = { outputId: question.outputId, outputRevision: question.outputRevision, questionId: question.id, text: response.input.value };
        const problem = !payload.text.trim() ? 'Informe a resposta.' : count(payload.text) > 4000 ? 'Use até 4.000 caracteres.' : bytes(JSON.stringify(payload)) > limit ? 'O envio excede 16 KiB. Reduza a resposta.' : '';
        if (invalid(response, problem)) { response.input.focus(); return; }
        remember(); const planComment = pendingPlanComment(run, accountId, pending);
        sending = true; save.disabled = response.input.readOnly = true; tell(notice, 'Registrando resposta…');
        try {
          await sameAccount(accountId); if (user?.id !== accountId) return;
          await api(`/runs/${encodeURIComponent(run.id)}/answer`, { accountId, method: 'POST', body: JSON.stringify(payload) });
          answerDrafts.delete(key); await detailPage('Resposta registrada. Confira as demais dúvidas antes de retomar.', false, planComment);
        } catch (error) {
          if (user?.id !== accountId) return;
          if (error.status === 409 || !error.status || error.status >= 500) {
            tell(notice, `${errorText(error)} Consulte o registro antes de tentar novamente. A resposta digitada está preservada nesta aba; não será reenviada automaticamente.`, true);
            item.append(button('Consultar registro atualizado', () => detailPage('', false, planComment), 'secondary'));
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
  main.replaceChildren(); main.append(message('Carregando execução…')); main.setAttribute('aria-busy', 'true');
  const id = location.pathname.split('/')[2]; let run;
  if (pending && (pending.accountId !== accountId || pending.runId !== id)) pending = null;
  try { run = await api(`/runs/${encodeURIComponent(id)}`, { accountId }); if (user?.id !== accountId || sequence !== detailSequence) return; }
  catch (error) {
    if (user && sequence === detailSequence) { main.replaceChildren(link('← Minhas execuções', '/execucoes', 'back-link'), message([noticeText, errorText(error)].filter(Boolean).join(' '), true));
      if (pending) main.append(preservedComment(pending));
      if (error.status !== 404) main.append(button('Tentar novamente', () => detailPage(noticeText, isError, pending), 'secondary')); }
    main.setAttribute('aria-busy', 'false'); return;
  }
  main.setAttribute('aria-busy', 'false'); main.replaceChildren(link('← Minhas execuções', '/execucoes', 'back-link'));
  heading(run.name, run.applicationName); if (noticeText) main.append(message(noticeText, isError));
  const metadata = el('dl', null, 'metadata');
  for (const [title, value] of [['Criada em', date(run.createdAt)], ['Etapa', phases[run.phase] || run.phase], ['Situação', statuses[run.status] || run.status]]) { const item = el('div'); item.append(el('dt', title), el('dd', value)); metadata.append(item); }
  const summary = el('section', null, 'panel'); summary.append(metadata, el('p', `Identificação: ${run.id}`, 'run-id')); main.append(summary);
  if (run.progress?.activeRole || run.progress?.activity) {
    summary.append(message([roles[run.progress.activeRole] || run.progress.activeRole, activities[run.progress.activity] || run.progress.activity].filter(Boolean).join(' · ')));
  }
  if (run.stopReason) main.append(message(run.stopReason.message, ['error', 'interrupted'].includes(run.status)));
  if (run.cases) main.append(casesPanel(run.cases));
  if (run.curation) main.append(curationPanel(run.curation));
  if (run.questions?.length) main.append(questionPanel(run, accountId, pending));
  for (const [key, draft] of answerDrafts) {
    if (!key.startsWith(`${accountId}:${id}:`) || !draft.text.trim()) continue;
    if (canAnswer(run) && run.questions.some(question => question.outputId && !question.answerId && key === `${accountId}:${id}:${question.outputId}:${question.outputRevision}:${question.id}`)) continue;
    const copy = el('section', null, 'panel'); copy.append(el('h3', `Texto não enviado · ${draft.questionId} · Curadoria r${draft.outputRevision}`),
      el('p', 'A pergunta ou sua resposta mudou. Este texto foi preservado para consulta e cópia; não será reaplicado.'), el('blockquote', draft.text, 'text-content'),
      button('Descartar este texto não enviado', () => { answerDrafts.delete(key); copy.remove(); }, 'secondary'));
    main.append(copy);
  }
  if (run.answers?.length) main.append(planSection('Histórico de esclarecimentos', run.answers,
    value => `${value.questionId} · Curadoria r${value.outputRevision} · ${date(value.at)} — ${value.text}`));
  if (run.canResume) {
    const notice = message(); const resume = button('Retomar preparação com as respostas', async () => {
      if ([...answerDrafts].some(([key, draft]) => key.startsWith(`${accountId}:${id}:`) && draft.text.trim())) {
        tell(notice, 'Há uma resposta digitada que ainda não foi registrada. Registre-a ou apague o texto antes de retomar.', true); return;
      }
      const planComment = pendingPlanComment(run, accountId, pending);
      resume.disabled = true; tell(notice, 'Solicitando nova curadoria e planejamento…');
      try {
        await sameAccount(accountId); if (user?.id !== accountId) return;
        await api(`/runs/${encodeURIComponent(id)}/resume`, { accountId, method: 'POST', body: '{}' });
        await detailPage('Retomada aceita. As novas revisões aparecerão abaixo.', false, planComment);
      } catch (error) { if (user?.id === accountId) await detailPage(errorText(error), true, planComment); }
    });
    summary.append(resume, notice);
  }
  if ((run.status === 'draft' && run.phase === 'intake') || run.status === 'running') {
    const operation = run.status === 'draft' ? 'start' : 'cancel';
    const notice = message(); const action = button(operation === 'start' ? 'Preparar plano' : 'Cancelar preparação', async () => {
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
    summary.append(action, notice);
  }
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
    summary.append(generate, notice);
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
  const restoreComment = pending && run.plan?.id === pending.outputId && run.plan.revision === pending.outputRevision &&
    !run.approvals.some(decision => decision.outputId === pending.outputId && decision.outputRevision === pending.outputRevision);
  if (pending && !restoreComment) main.append(preservedComment(pending));
  if (!run.plan) { main.append(message(run.status === 'draft' ? 'Material recebido. O processamento ainda não foi iniciado.' : 'Ainda não há plano disponível para consulta.')); return; }
  const plan = run.plan; const content = plan.payload.testPlan; const panel = el('section', null, 'panel');
  panel.append(el('p', `Plano de testes / Revisão ${plan.revision}`, 'eyebrow'), el('h2', 'Revisão do plano'), el('h3', 'Objetivo'), el('p', content.objective, 'text-content'));
  panel.append(planSection('Requisitos referenciados', content.requirementIds), planSection('Critérios referenciados', content.ruleIds), planSection('Prioridades', content.priorities, item => `${item.ruleId} — ${item.reason}`), planSection('Exclusões', content.exclusions, item => `${item.description} — ${item.reason}`), planSection('Abordagem', content.approach), planSection('Pré-condições', content.preconditions));
  const sources = el('section', null, 'plan-section'); sources.append(el('h3', 'Fontes'));
  if (!content.sources.length) sources.append(el('p', 'Nenhuma fonte informada.', 'hint'));
  for (const source of content.sources) { sources.append(el('p', `${source.artifactId} · ${source.locator}`, 'text-content'), el('blockquote', source.quote, 'text-content')); }
  panel.append(sources, planSection('Situação da validação', plan.validations, value => `${validations[value.status] || value.status} · Revisão ${value.outputRevision} · ${value.validator}`));
  const decisions = el('section', null, 'plan-section'); decisions.append(el('h3', 'Decisões registradas'));
  if (!run.approvals.length) decisions.append(el('p', 'Nenhuma decisão registrada.', 'hint'));
  for (const decision of run.approvals) {
    const item = el('div', null, 'decision'); item.append(el('p', `${decision.decision === 'approved' ? 'Plano aprovado' : 'Alterações solicitadas'} · Revisão ${decision.outputRevision}`), el('p', date(decision.at), 'hint'));
    if (decision.comment) item.append(el('p', decision.comment, 'text-content')); decisions.append(item);
  }
  panel.append(decisions); main.append(panel);
  const currentDecisions = run.approvals.filter(value => value.outputId === plan.id && value.outputRevision === plan.revision);
  const verdicts = plan.validations.filter(value => value.validator === 'output-validator' && value.status !== 'error');
  const eligible = run.status === 'awaiting_approval' && run.phase === 'planning' && verdicts.length === 1 && verdicts[0].status === 'approved' && currentDecisions.length === 0;
  if (!eligible) {
    const waiting = run.status === 'awaiting_approval' && run.phase === 'planning';
    main.append(message(currentDecisions.length ? `A decisão desta revisão está registrada.${waiting ? ' A execução permanece em espera; a continuidade ainda não foi iniciada.' : ''}` : 'A revisão está disponível para consulta. Uma decisão exige a etapa de aprovação e um parecer aprovado do validador.'));
    if (restoreComment) main.append(preservedComment(pending));
    main.append(button('Atualizar consulta', () => detailPage('', false, pending), 'secondary')); return;
  }
  const review = el('section', null, 'panel'); review.append(el('h2', `Decidir sobre a revisão ${plan.revision}`), el('p', 'Aprovar registra sua decisão e mantém a execução em espera. O servidor confere a revisão e suas dependências antes de aceitar.'));
  const notice = message(); review.append(notice); const form = el('form'); form.noValidate = true;
  const comment = field(form, 'comment', 'Comentário', { optional: true, textarea: true, hint: 'Obrigatório ao solicitar alterações. Até 4.000 caracteres.' });
  if (restoreComment) comment.input.value = pending.comment;
  const actions = el('div', null, 'actions'); const approve = button('Aprovar plano'); const change = button('Solicitar alterações', null, 'secondary'); actions.append(approve, change); form.append(actions); review.append(form); main.append(review);
  form.addEventListener('submit', event => event.preventDefault()); let submitting = false;
  const decide = async changes => {
    if (submitting) return;
    if (changes && invalid(comment, !comment.input.value.trim() ? 'Informe um comentário para solicitar alterações.' : count(comment.input.value) > 4000 ? 'Use até 4.000 caracteres.' : '')) { comment.input.focus(); return; }
    const payload = { outputId: plan.id, outputRevision: plan.revision, ...(changes ? { comment: comment.input.value } : {}) };
    if (bytes(JSON.stringify(payload)) > limit) { invalid(comment, 'O comentário torna o envio maior que 16 KiB. Reduza seu tamanho.'); comment.input.focus(); return; }
    pending = { accountId, runId: id, outputId: plan.id, outputRevision: plan.revision, comment: comment.input.value,
      decision: changes ? 'changes_requested' : 'approved' };
    submitting = true; approve.disabled = change.disabled = comment.input.readOnly = true; tell(notice, 'Registrando decisão…');
    try {
      await sameAccount(accountId);
      if (user?.id !== accountId) return;
      await api(`/runs/${encodeURIComponent(id)}/${changes ? 'request-changes' : 'approve'}`, { accountId, method: 'POST', body: JSON.stringify(payload) });
      await detailPage('A solicitação foi aceita. Confira abaixo a decisão consultada no registro salvo.', false, pending); main.focus();
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
    else await detailPage();
    if (!user) return;
    sessionTimer = setInterval(() => { if (!document.hidden) void sessionCheck(); }, 30000);
  } catch (error) {
    if (location.pathname === '/acesso') access(error.code === 'INVALID_SESSION' ? '' : errorText(error));
    else if (error.code !== 'INVALID_SESSION') main.replaceChildren(message(errorText(error), true), button('Tentar novamente', boot, 'secondary'));
  }
}
// Limpa o snapshot privado antes de entrar no cache de navegação do navegador.
addEventListener('pagehide', () => { if (rememberForm) rememberForm(); clearTimeout(detailTimer); detailSequence++; main.replaceChildren(); account.replaceChildren(); });
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('visibilitychange', () => {
  if (!user) return;
  if (document.hidden) { main.hidden = true; account.hidden = true; }
  else void sessionCheck().then(() => { if (user) { main.hidden = false; account.hidden = false; } });
});
void boot();
