/** Estrutura proposta; comportamento dos especialistas depende dos RF, RN, RG e US. */
export const agentRoles = [
  { id: 'orchestrator', name: 'Orquestrador', responsibility: 'Delegar tarefas e acompanhar a sessão.' },
  { id: 'artifact-curator', name: 'Curadoria de artefatos', responsibility: 'Analisar histórias de usuário, backlog e requisitos.' },
  { id: 'test-designer', name: 'Planejamento de testes', responsibility: 'Elaborar casos com PCE e AVL.' },
  { id: 'test-executor', name: 'Execução de testes', responsibility: 'Navegar pela interface e coletar evidências.' },
  { id: 'report-writer', name: 'Relatório da sessão', responsibility: 'Organizar resultados e evidências verificáveis.' },
] as const;

export type AgentRole = typeof agentRoles[number]['id'];
