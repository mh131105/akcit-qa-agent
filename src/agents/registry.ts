/** Estrutura proposta; comportamento dos especialistas depende dos RF, RN, RG e US. */
export const agentRoles = [
  { id: 'orchestrator', name: 'Orquestrador', responsibility: 'Delegar tarefas, acompanhar a sessão e aplicar os pareceres do validador, sem julgar as saídas.' },
  { id: 'artifact-curator', name: 'Curadoria de artefatos', responsibility: 'Analisar histórias de usuário, backlog e requisitos.' },
  { id: 'test-designer', name: 'Planejamento de testes', responsibility: 'Elaborar casos com PCE e AVL.' },
  { id: 'test-executor', name: 'Execução de testes', responsibility: 'Navegar pela interface e coletar evidências.' },
  { id: 'report-writer', name: 'Relatório da sessão', responsibility: 'Organizar resultados e evidências verificáveis.' },
  { id: 'output-validator', name: 'Validação das saídas', responsibility: 'Avaliar as saídas dos demais especialistas e emitir pareceres de aprovação, correção ou bloqueio com justificativa.' },
] as const;

export type AgentRole = typeof agentRoles[number]['id'];
