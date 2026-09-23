# Sprint única: entrega em 26/09 às 17h

Atualizado em 23/09/2026. Horário de Manaus. A equipe mantém quatro frentes, com
responsáveis a escolher. A [especificação](requisitos/PROTOTIPO.md) define a entrega;
as tarefas abaixo implementam seus requisitos, sem uma segunda sprint no plano.

## Quatro frentes

| Frente | Responsabilidade | Primeiro trabalho |
| --- | --- | --- |
| A · Interface | Acesso, histórico e nova execução; página de execução com abas, aprovações, dúvidas, vídeos e impressão | Consumir o exemplo e montar os estados das sete vistas |
| B · Backend e orquestração | Acesso aos dados, API, persistência, aprovações, estados, limites e sessões Pi | Alinhar contratos e ligar o fluxo mínimo de ponta a ponta |
| C · Metodologia e validação | Curadoria, plano, casos, detalhamento, relatório e validador independente | Preparar saídas e critérios sobre o artefato sintético |
| D · Navegador e evidências | Acesso ao alvo, mapa, execução visual, captura, bloqueios e retomada de casos | Provar um percurso real e mídia vinculada à tentativa |

A frente C define a revisão; B aplica seus resultados sem julgamento pelo
orquestrador. A exibe as duas aprovações humanas. D fornece o mapa depois da aprovação
dos casos lógicos; C acrescenta os percursos e o validador revisa o detalhamento.

## Tarefas existentes

As onze tarefas estão no [marco da entrega](https://github.com/mh131105/akcit-qa-agent/milestone/1).
As dependências valem para concluir; começar com exemplos e integrar desde o primeiro dia.

| Tarefa | Frente | Escopo da especificação | Dependência principal |
| --- | --- | --- | --- |
| [T0 · #3](https://github.com/mh131105/akcit-qa-agent/issues/3) | Todas / B | Responsáveis, aplicação e acesso da demonstração, provedor, orçamento e limitações externas | Insumos da equipe; não bloqueia trabalho com exemplo |
| [T1 · #4](https://github.com/mh131105/akcit-qa-agent/issues/4) | B + revisão A/C/D | Contratos, saídas, revisões, aprovações humanas, perguntas e transições; RF-08, RF-09, RF-14, RF-15 | Especificação e exemplo |
| [T2 · #5](https://github.com/mh131105/akcit-qa-agent/issues/5) | A | Sete vistas; RF-01, RF-07, RF-10 a RF-17; RNF-01, RNF-02 e apresentação de estados | T1; API/mídia reais para concluir |
| [T3 · #6](https://github.com/mh131105/akcit-qa-agent/issues/6) | B | Conta/sessão, autorização, API, persistência, decisões, exclusão e recuperação; RF-01, RF-08, RF-10, RF-11, RF-14 a RF-16; RNF-04, RNF-06, RNF-12 | T1 |
| [T4 · #7](https://github.com/mh131105/akcit-qa-agent/issues/7) | B | Sequência, pareceres, duas aprovações, disponibilidade do ambiente, limites, cancelamento; RN-04 a RN-08, RN-12, RN-13; RNF-07, RNF-08, RNF-10 | T1, persistência mínima, T10, credencial de modelo |
| [T5 · #8](https://github.com/mh131105/akcit-qa-agent/issues/8) | C | US/CA com significado e fontes, dúvida localizada; RF-02; RN-01, RN-02 | T1 e artefato sintético |
| [T6 · #9](https://github.com/mh131105/akcit-qa-agent/issues/9) | C | Plano, casos lógicos, detalhamento após mapa e relatório; RF-04, RF-07, RF-13; RN-03, RN-06, RN-09 a RN-11, RN-14 | T1, T5; mapa de T8 para detalhar |
| [T7 · #10](https://github.com/mh131105/akcit-qa-agent/issues/10) | A + C / revisão D | Alvo controlado pequeno, login, navegação, regra com limite, defeito conhecido e reset; gabarito humano | Independente do alvo externo |
| [T8 · #11](https://github.com/mh131105/akcit-qa-agent/issues/11) | D | Mapa, casos, mouse/teclado, evidências, bloqueio e retomada; RF-03, RF-05, RF-06, RF-15; RNF-05, RNF-09 | T1, T7; T4 para autonomia |
| [T9 · #12](https://github.com/mh131105/akcit-qa-agent/issues/12) | Todas / B | Cenários A-01 a A-08, metas medidas, validação em dev e promoção da mesma imagem; RNF-03, RNF-11 | T2 a T8 e T10, integrando cada trecho disponível |
| [T10 · #14](https://github.com/mh131105/akcit-qa-agent/issues/14) | C + B | Validação de curadoria, plano, casos, mapa, detalhamento, resultados e relatório; RF-09; RN-05, RN-10 | T1; T3/T4 para aplicar os pareceres |

Não criar um produto completo para servir de alvo: telas simples com dados
restauráveis bastam. O agente recebe requisitos e acesso; o código e o gabarito dos
defeitos ficam fora de seu contexto.

## Marcos propostos a partir de agora

| Quando | Verificação |
| --- | --- |
| 23/09 | Contratos alinhados; interface consome exemplo; primeiro percurso integrado com aprovações, validador, navegador e evidência reais |
| 24/09 | Fluxo completo e cenários de correção, bloqueio, retomada, cancelamento e relatório parcial |
| 25/09 | A-01 a A-08 em dev, correções e ensaio; encerrar ampliação de escopo |
| 26/09 até 12h | Ensaio na versão candidata; conferir acesso e exportação |
| 26/09 até 14h | Promover imagem validada e conferir ambiente de apresentação |
| 26/09 às 17h | Entrega |

São metas de organização, não atividades já concluídas. Se houver atraso, reduzir
número de fluxos, casos e formatos da demonstração, mantendo todas as etapas e os
requisitos de segurança, integridade e acessibilidade. Registrar qualquer mudança
de escopo de forma explícita; não encerrar tarefas com base apenas em mocks.

## Como encerrar uma tarefa

O PR referencia requisitos e mostra o critério funcionando na integração. Anexar
apenas dados sintéticos ou evidências com acesso adequado. Alterar contrato e exemplo
junto do código quando necessário. Escolhas de modelo usam os mesmos exemplos,
com revisão humana de qualidade, duração e custo disponível; o validador não julga
recursivamente a si mesmo. O estado real de cada trabalho fica na issue correspondente.
