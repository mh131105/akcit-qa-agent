# Comecem por aqui

A [especificação do protótipo](PROTOTIPO.md) é a referência para implementar:
**17 requisitos funcionais, 15 regras de negócio, 12 requisitos não funcionais,
sete vistas de interface e oito cenários de aceitação**.

Ela incorpora o fluxo aprovado em 23/09: plano e casos antes do mapeamento, duas
aprovações humanas e validador independente. Os limites operacionais e o recorte das
telas são a base técnica proposta pelo CTO; devem ser verificados na implementação.
Entrega: **26/09/2026 às 17h, horário de Manaus**, com quatro integrantes.

## Onde trabalhar

| Precisa saber | Leia ou use |
| --- | --- |
| O que entregar, telas, regras e critérios de pronto | [PROTOTIPO.md](PROTOTIPO.md) |
| Dados, estados, versões, aprovações e operações | [CONTRATOS.md](CONTRATOS.md) |
| Exemplo compartilhado para integrar as partes | [execucao-demo.json](exemplos/execucao-demo.json) e [artefato de origem](exemplos/artefato-demo.md) |
| Responsabilidades, dependências e tarefas | [SPRINT.md](../SPRINT.md) e GitHub Issues |
| Ambiente, código e publicação | [README](../../README.md) e [OPERACAO.md](../OPERACAO.md) |

A especificação descreve o comportamento esperado. O contrato descreve como as
partes trocam dados. A issue registra trabalho e bloqueios. O PR registra mudança
e verificação. Se uma mudança afetar outro componente, atualizar contrato e exemplo
no mesmo PR, junto de quem fornece e de quem consome os dados.

O exemplo é sintético: não houve teste real nem validação de IA. Ele ilustra plano,
casos, aprovações humanas, mapa, detalhamento e uma correção antes do relatório parcial.

## Estado conferido da base

Estão implementadas e integradas na base as etapas fundamentais de preparação textual e acesso:
- **Autenticação e sessão:** cadastro, login, logout, expiração e isolamento de contas (T3.2, T3.3, BUG-T2.1-01).
- **Entrada e histórico:** criação de rascunhos com requisitos em texto, preservação literal dos artefatos e busca/filtros no histórico (T3.3).
- **Curadoria, plano e esclarecimentos:** coordenação em pipeline com Pi, curador de artefatos, designer de testes e validador independente; ciclo de perguntas/respostas de esclarecimento com retomada sem reprocessamento redundante (T4.1, ajuste 24/09).
- **Aprovação do plano:** revisão humana obrigatória, separação entre aprovação e continuidade (`applyPlanApprovalCommand`, T1.1, T3.1, T4.1).
- **Casos de teste lógicos:** geração dos casos a partir do plano aprovado com validação independente por `output-validator` (T6.1) e aprovação humana ou solicitação de alterações nos casos pelo site (T6.2).
- **Aplicação controlada de reservas:** alvo sintético de demonstração com login, reservas, regras de limite, defeito conhecido e reset (T7).
- **Configuração de acesso ao alvo:** configuração da URL inicial autorizada (`TARGET_ALLOWED_ORIGINS`), credencial privada em envelope seguro e controle de revisão (T8.1).

- **Mapeamento visual validado (T8.2):** navegador real, capturas e revisão visual independente; termina em `ready / mapping`.
- **Detalhamento de percursos (T6.3):** associação pelo projetista e revisão independente; preserva casos/aprovações, mantém pendências locais e termina em `ready / route_detail` quando há caminho elegível. O estado das verificações deste candidato está em [T6.3](../evidencias/t6.3/README.md).

As etapas seguintes continuam pendentes:
- Execução dos casos na interface, tentativas, capturas e validação dos resultados (T8/T10).
- Retomada de dúvidas de navegação/detalhamento e tratamento completo de bloqueios.
- Redação/validação do relatório final e impressão/PDF (T6/T10).

**Decisão de 26/09/2026:** capturas por caso/tentativa são as evidências do relatório;
vídeos curtos são evolução futura, fora do aceite do protótipo. Capturas do mapa
não comprovam execução dos casos. T6.3 não entrega execução nem relatório.

Documentos de clientes, credenciais, sessões e evidências ficam no armazenamento da
aplicação, fora do Git. No repositório, manter apenas exemplos sintéticos e metodologia.
