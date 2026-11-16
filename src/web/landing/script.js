(() => {
  'use strict';

  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-nav');

  function closeMenu() {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Abrir menu');
    navigation.classList.remove('is-open');
  }

  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    navigation.classList.toggle('is-open', open);
  });

  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });

  const documentExample = (left, right, body) => `<div class="demo-document"><div class="document-header"><span>${left}</span><span>${right}</span></div>${body}</div>`;
  const stages = [
    {
      role: 'CURADOR', label: 'O ponto de partida', title: 'O que precisa funcionar?',
      description: 'Informe requisitos, histórias de usuário ou critérios de aceite. O curador organiza as fontes e identifica dúvidas antes do planejamento.',
      example: documentExample('REQUISITO', 'RQ-01', '<p>Ao criar uma tarefa com um título válido, ela deve aparecer na lista de tarefas.</p><span class="document-note">Exemplo: aplicação de tarefas</span>'),
      hint: 'Comece pelo comportamento que você espera.'
    },
    {
      role: 'PROJETISTA + REVISÃO HUMANA', label: 'Planejamento', title: 'Revise a proposta de teste.',
      description: 'O projetista prepara um plano a partir dos requisitos. Você confere a interpretação, pede ajustes e aprova antes de seguir.',
      example: documentExample('PLANO DE TESTES', 'EXEMPLO', '<ul class="example-list"><li><span class="list-mark">↳</span>Verificar a criação de uma tarefa com título válido.</li><li><span class="list-mark">↳</span>Conferir se a tarefa criada aparece na lista.</li></ul><div class="approval-note">Aprovação humana antes da próxima etapa</div>'),
      hint: 'O plano passa pela sua revisão.'
    },
    {
      role: 'PROJETISTA + REVISÃO HUMANA', label: 'Casos de teste', title: 'O esperado fica explícito.',
      description: 'Examine as pré-condições, os dados e o resultado esperado de cada caso. O conjunto também precisa da sua aprovação.',
      example: documentExample('CASO DE TESTE', 'CT-01 · EXEMPLO', '<dl class="example-fields"><dt>Pré-condição</dt><dd>Conta de teste com acesso à lista.</dd><dt>Ação</dt><dd>Criar a tarefa “Revisar relatório”.</dd><dt>Esperado</dt><dd>A tarefa aparece na lista após salvar.</dd></dl>'),
      hint: 'Casos claros orientam a execução e a análise.'
    },
    {
      role: 'CONFIGURAÇÃO DE ACESSO', label: 'Preparação', title: 'Prepare a aplicação-alvo.',
      description: 'Configure o endereço público da aplicação e uma conta de teste. Esse acesso permite que o executor navegue pelas telas previstas nos casos.',
      example: documentExample('AMBIENTE-ALVO', 'EXEMPLO', '<dl class="example-fields"><dt>Aplicação</dt><dd>Aplicação de tarefas</dd><dt>Acesso</dt><dd>URL pública HTTP/HTTPS</dd><dt>Conta</dt><dd>Conta de teste dedicada</dd></dl><span class="document-note">Escolha um ambiente que permita criar ou alterar dados.</span>'),
      hint: 'Requisitos e acesso precisam corresponder ao mesmo ambiente.'
    },
    {
      role: 'EXECUTOR + PROJETISTA', label: 'Mapeamento', title: 'Das telas aos percursos.',
      description: 'O executor observa a interface. O fluxo associa os percursos encontrados aos casos aprovados e registra impedimentos que precisem da sua ajuda.',
      example: documentExample('PERCURSO', 'CT-01 · EXEMPLO', '<div class="example-path"><span>Lista de tarefas</span><i aria-hidden="true">→</i><span>Nova tarefa</span><i aria-hidden="true">→</i><span>Salvar</span></div><span class="document-note">O mapeamento prepara o caminho para o teste.</span>'),
      hint: 'Conhecer uma tela e executar um caso são etapas distintas.'
    },
    {
      role: 'EXECUTOR + VALIDADOR', label: 'Execução visual', title: 'O teste acontece na interface.',
      description: 'O agente observa a tela e interage com cursor e teclado. As tentativas ficam registradas, e as saídas passam pela revisão do validador.',
      example: '<div class="browser-example"><div class="browser-example-bar"><span>APLICAÇÃO DE TAREFAS</span><span>ILUSTRAÇÃO</span></div><div class="browser-example-body"><strong>Nova tarefa</strong><div class="example-input">Revisar relatório</div><span class="example-action">Salvar tarefa</span><svg class="illustration-cursor" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m5 3 13 10-6 1-3 6-4-17Z"/></svg></div></div>',
      hint: 'Interação visual com a aplicação-alvo, sem seletores DOM.'
    },
    {
      role: 'REDATOR', label: 'Relatório com evidências', title: 'Veja o que sustenta a conclusão.',
      description: 'Consulte a relação entre requisito, caso, tentativa e resultado. O relatório reúne o esperado, o observado, as capturas e as pendências.',
      example: documentExample('REGISTRO DO CASO', 'CT-01 · EXEMPLO', '<div class="report-example"><div><b>ESPERADO</b>A tarefa deve aparecer na lista.</div><div><b>OBSERVADO</b>A tarefa “Revisar relatório” aparece na lista.</div></div><div class="example-proof"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor"/><path d="m4 17 5-5 4 4 3-3 5 5" stroke="currentColor"/><circle cx="16" cy="9" r="2" stroke="currentColor"/></svg>Captura vinculada ao registro</div>'),
      hint: 'Este é um exemplo ilustrativo, não um resultado real de teste.'
    }
  ];

  // The illustrative walkthrough can be removed when a recorded demo replaces it.
  if (!document.querySelector('#workflow-demo')) return;

  const tabs = Array.from(document.querySelectorAll('.step-tab'));
  const tabList = document.querySelector('.step-list');
  const panel = document.querySelector('#step-panel');
  const previous = document.querySelector('#previous-stage');
  const next = document.querySelector('#next-stage');
  let current = 0;

  function renderStage(index, focusTab = false) {
    current = Math.max(0, Math.min(stages.length - 1, index));
    const stage = stages[current];
    tabs.forEach((tab, tabIndex) => {
      const selected = current === tabIndex;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tabs[current].id);
    panel.innerHTML = `<p class="panel-label">${stage.label}</p><h3>${stage.title}</h3><p>${stage.description}</p>${stage.example}`;
    document.querySelector('#stage-role').textContent = stage.role;
    document.querySelector('#stage-counter').textContent = `ETAPA ${String(current + 1).padStart(2, '0')} / 07`;
    document.querySelector('#stage-hint').textContent = stage.hint;
    previous.disabled = current === 0;
    next.disabled = current === stages.length - 1;
    if (focusTab) tabs[current].focus();
  }

  tabs.forEach((tab, index) => tab.addEventListener('click', () => renderStage(index)));
  previous.addEventListener('click', () => renderStage(current - 1));
  next.addEventListener('click', () => renderStage(current + 1));

  tabList.addEventListener('keydown', (event) => {
    const moves = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (event.key in moves) {
      event.preventDefault();
      renderStage((current + moves[event.key] + stages.length) % stages.length, true);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      renderStage(event.key === 'Home' ? 0 : stages.length - 1, true);
    }
  });

  const mobileQuery = window.matchMedia('(max-width: 820px)');
  function updateOrientation() {
    tabList.setAttribute('aria-orientation', mobileQuery.matches ? 'horizontal' : 'vertical');
    if (window.innerWidth > 600) closeMenu();
  }
  mobileQuery.addEventListener('change', updateOrientation);
  window.matchMedia('(max-width: 600px)').addEventListener('change', () => {
    if (window.innerWidth > 600) closeMenu();
  });
  updateOrientation();
})();
