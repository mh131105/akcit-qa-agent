# Sprint única: entrega em 26/09 às 17h

Horário usado: Manaus. Plano preparado em 22/09/2026. Marcos internos e divisão de
trabalho são propostas; a equipe escolhe os responsáveis. Disponibilidade alta não
significa trabalhar sem descanso nem quatro pessoas alterando os mesmos arquivos.

## Quatro frentes em paralelo

| Frente | Entrega e primeiro trabalho | Onde desenvolver | Dependências |
| --- | --- | --- | --- |
| A — Interface | Configuração, progresso e relatório; começar pelo JSON de exemplo | Diretório `src/web/` proposto; contrato de API com B | Exemplo hoje; API real durante integração |
| B — Backend e orquestração | Entrada, persistência, estados, limites, sessões Pi; começar pelo contrato | `src/`, `src/runtime/`, `agents/orchestrator/` | Acesso ao modelo para substituir os mocks |
| C — Curadoria, metodologia e validação | Normalização, PCE/AVL, relatório e critérios do validador; começar pelo exemplo | `agents/artifact-curator/`, `agents/test-designer/`, `agents/report-writer/`, `agents/output-validator/` | Contrato; modelo; depois artefatos do alvo |
| D — Navegador e evidências | Mapeamento, cursor/teclado, casos e vídeos; começar provando um percurso real | `agents/test-executor/`, apoio em `scripts/` | Alvo controlado; tools; modelo para autonomia |

Cada frente tem um responsável principal e pede revisão a outra pessoa. O número
de especialistas de IA não determina o número de integrantes. A frente C estrutura
o conteúdo do relatório e a metodologia do validador, D captura as evidências e A
exibe o resultado. B conecta a sessão independente do validador e o controle de passagem.
O orquestrador aplica os pareceres; não avalia a qualidade das saídas.

Escolher os responsáveis na abertura do trabalho. O responsável por B coordena a
integração técnica; o responsável por D define com C como restaurar dados entre casos.
Redistribuir tarefas menores quando houver bloqueio, mantendo clara a responsabilidade.

## Lista de tarefas

As onze tarefas estão no [marco da entrega no GitHub](https://github.com/mh131105/akcit-qa-agent/milestone/1).
Os códigos T0–T9 permanecem estáveis; T10 incorpora o validador decidido pela equipe.
Cada issue deve receber responsável e PR.

As dependências abaixo são necessárias para **concluir**, não para começar.
T4 começa com persistência mínima, e T9 começa no primeiro dia: cada frente integra
o trecho disponível enquanto desenvolve o restante.

| ID | Frente | Resultado esperado e critério para encerrar | Depende de |
| --- | --- | --- | --- |
| [T0 · #3](https://github.com/mh131105/akcit-qa-agent/issues/3) | Todas; coordenação B | Definir responsáveis; registrar alvo/acesso/artefatos e provedor quando chegarem; indicar o que segue pendente. Segredos fora da issue | Disponibilidade dos insumos, sem prazo confirmado |
| [T1 · #4](https://github.com/mh131105/akcit-qa-agent/issues/4) | B + revisão A/C/D | Tipos e verificações estruturais; contratos de saída/revisão e parecer; mesmo exemplo na interface e backend | Documentos desta proposta |
| [T2 · #5](https://github.com/mh131105/akcit-qa-agent/issues/5) | A | Criar execução, mostrar fase/questões e relatório com casos, esperado/observado e vídeo; indicar simulação, captura ausente e revisão pendente; conclusões só depois da validação | T1; API de T3 e mídia de T8 para concluir; começa com fixture |
| [T3 · #6](https://github.com/mh131105/akcit-qa-agent/issues/6) | B | Persistir entradas, saídas por revisão, pareceres, estados, casos, tentativas e mídia; servir API; preservar histórico após reinício | T1 |
| [T4 · #7](https://github.com/mh131105/akcit-qa-agent/issues/7) | B | Ligar Pi às etapas e tools; encaminhar cada saída ao validador; aplicar parecer sem julgar qualidade; limitar tempo/correções e registrar consumo | T1, T3 e T10 para concluir; credencial para execução real |
| [T5 · #8](https://github.com/mh131105/akcit-qa-agent/issues/8) | C | Curar texto/PDF textual; preservar significado e origem; sinalizar conflito localizado; humano confere limites e exceções | T1; começa com artefato sintético |
| [T6 · #9](https://github.com/mh131105/akcit-qa-agent/issues/9) | C | Planejar com mapa + requisitos; gerar PCE/AVL justificada; estruturar relatório sem alterar vereditos ou inventar evidências | T1, T5; mapa de exemplo até T8 |
| [T7 · #10](https://github.com/mh131105/akcit-qa-agent/issues/10) | A + C; revisão D | Montar alvo controlado separado com login, navegação, regra explícita, defeito conhecido e reset documentado; manter gabarito fora do contexto do executor | Escolha local do exemplo; independente do alvo externo |
| [T8 · #11](https://github.com/mh131105/akcit-qa-agent/issues/11) | D | Habilitar visão/cursor/teclado; mapear percurso e executar caso; produzir vídeo vinculado à tentativa; registrar bloqueio e falha de captura | T1, T7; modelo para navegação autônoma |
| [T9 · #12](https://github.com/mh131105/akcit-qa-agent/issues/12) | Todas; coordenação B | Integrar RF-01 a RF-09 em dev, verificar critérios de pronto, ensaiar e promover imagem validada; registrar limitações externas | T2–T8 e T10; credenciais utilizáveis |
| [T10 · #14](https://github.com/mh131105/akcit-qa-agent/issues/14) | C + B | Implementar validador com contexto próprio; revisar cada saída por versão; pedir correção ao autor ou bloquear; testar rejeição, aprovação, falha e limite sem bypass | T1; T3/T4 para integrar, começando em paralelo |

T7 deve ser pequena: a frente A prepara telas simples e C fornece requisitos e
gabarito. O código do alvo e seu reset ficam separados da aplicação de QA. O agente
recebe o acesso e os requisitos, sem o código ou a lista dos defeitos. Não investir
em aparência ou funcionalidades do alvo além do necessário para verificar o produto.

## Agenda proposta

| Data | Marco de integração dentro da mesma sprint |
| --- | --- |
| 22/09 | Escolher responsáveis; revisar contratos; A usa fixture, B inicia API/estado, C prepara metodologia e revisão independente, D prova as tools; iniciar alvo controlado |
| 23/09, fim do dia | Primeiro percurso completo com modelo, navegador e validador reais; pelo menos um caso e vídeo no relatório revisado |
| 24/09 | Completar classes e limites da demonstração; exercitar defeito, bloqueio, captura ausente, reinício, saída rejeitada e limite/erro do validador |
| 25/09 | Validar ponta a ponta em dev, corrigir falhas, ensaiar; congelar ampliação de escopo |
| 26/09, até 12h | Ensaiar a demonstração na versão candidata e conferir acesso aos vídeos |
| 26/09, até 14h | Promover a imagem validada e conferir o ambiente de apresentação |
| 26/09, 17h | Entrega informada pela equipe |

O marco de 23/09 depende de acesso a um provedor. Se não houver credencial ou se a
integração falhar, registrar o impedimento no mesmo dia. Reduzir fluxos, formatos e
quantidade de casos; preservar entrada, curadoria, mapa, planejamento, execução,
relatório e validação independente das saídas. Mocks ajudam o desenvolvimento,
mas não satisfazem esse marco.

Quando o alvo externo chegar, D verifica acesso e navegação enquanto C confere os
artefatos. O time avalia se há tempo para uma execução completa e correções. A aplicação
controlada mantém a demonstração possível, com a limitação de validação externa explícita.

## Como escolher modelos sem travar a sprint

Primeiro garantir acesso e compatibilidade com imagens/tools onde necessário. Usar
uma configuração funcional para integrar. Depois comparar, nos mesmos exemplos, até
dois candidatos disponíveis para os papéis que mais afetam a qualidade.

| Tarefa | O que a equipe confere |
| --- | --- |
| Curadoria | Limites, condições e exceções preservados; ausência de regras inventadas; origens corretas |
| Planejamento | Casos executáveis; classes e limites justificados; expectativas sustentadas |
| Navegação/execução | Conclusão do percurso, ações recuperáveis, observação correta e ausência de falsos defeitos |
| Relatório | Fidelidade aos resultados e associação correta das evidências |
| Validador | Detectar erros introduzidos, justificar achados, aceitar saídas corretas e não aprovar conclusões sem suporte |

Registrar configuração, entradas, resultado revisado, tempo e custo/consumo quando
disponível. Qualidade é o primeiro filtro. Entre opções que atendem aos exemplos,
comparar custo e latência. Repetir o percurso escolhido ajuda a revelar instabilidade;
uma demonstração bem-sucedida isolada não estabelece uma taxa de confiabilidade.
Não condicionar a integração a descobrir o modelo “ideal” para os seis papéis.
Medir também tempo e consumo das revisões. A equipe humana confere uma amostra
de pareceres; o validador não avalia a si mesmo.

## Documentar enquanto desenvolve

- **Ao iniciar:** assumir uma issue, identificar critério de pronto e dependências.
- **Ao decidir:** atualizar a linha de decisão em PROTOTIPO.md, indicando responsável,
  data e razão; uma hipótese só vira decisão depois da escolha explícita da equipe.
- **Ao mudar a integração:** atualizar CONTRATOS.md e o exemplo no mesmo PR.
- **Ao concluir:** ligar o PR à issue, descrever a verificação e as limitações; anexar
  apenas evidências sintéticas ou links com acesso adequado, sem segredos.
- **Na integração diária:** mostrar comportamento funcionando e registrar o bloqueio
  que precisa de outra frente. Evitar reunião longa de relato individual.

Uma tarefa termina quando seu critério funciona na versão integrada. O protótipo
termina quando atende ao [critério de pronto](requisitos/PROTOTIPO.md#critério-de-pronto-do-protótipo).
