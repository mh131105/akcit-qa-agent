# Matriz de aceite — T9.1

As referências automatizadas apontam para testes do candidato. O resultado final
da suíte e dos smokes deve ser conferido no CI/PR do SHA publicado. **Manual por
Matheus** significa validação delegada expressamente pelo usuário, ainda sem
resultado registrado; não significa critério entregue ou reprovado. Evidências
brutas e capturas permanecem privadas. [Identificação e ensaios](README.md).

## Requisitos funcionais

| Requisito | Teste/evidência automatizada | Conferência manual necessária | Resultado e responsável |
| --- | --- | --- | --- |
| RF-01 — Entrada/arquivos | `test/artifacts.test.ts`, `test/run-intake-api.test.ts` | Texto, TXT, MD, PDF, duas fontes, limites/erro preservando formulário. | Automação no CI; manual Matheus (R1/A-01). |
| RF-02 — Curadoria | `test/preparation-domain.test.ts`, `test/preparation-answers.test.ts` | Fidelidade às US/CA e linhas/páginas sem regra inventada. | Automação no CI; manual Matheus (R1). |
| RF-03 — Mapeamento | `test/navigation.test.ts`, `test/pi-visual.test.ts`, smoke mapping | Caminho real, acesso, capturas e bloqueio localizado. | Automação no CI; manual Matheus (R1/R3). |
| RF-04 — Casos/percursos | `test/create-cases.test.ts`, `test/route-detail.test.ts` | 0/1/10/11, interno/não inteiro/comentário; técnicas, fontes e preservação lógica. | Automação no CI; manual Matheus (R1/R2). |
| RF-05 — Execução visual | `test/test-execution.test.ts`, `scripts/smoke-execution.mjs` | Preparo, caminho natural, dados reais, sem atalhos de API/DOM. | Automação no CI; manual Matheus (R1/R2). |
| RF-06 — Capturas | `test/test-execution.test.ts`, `test/test-report.test.ts` | Legibilidade, passos/resultado, vínculo caso/tentativa, ausência de segredo. | Automação no CI; manual Matheus (R1/R2/A-08). |
| RF-07 — Relatório | `test/test-report.test.ts`, `test/flow-completion.test.ts` | Todos os vereditos, fontes, tentativas, cobertura, limitações e clareza. | Automação no CI; manual Matheus (R1/R2/R4). |
| RF-08 — Persistência | `test/plan-approval-storage.test.ts`, `test/test-execution.test.ts` | Reabrir, reiniciar após resultado confirmado, conservar capturas. | Automação no CI; manual Matheus (R4/A-06). |
| RF-09 — Validação | `test/pi-runtime.test.ts`, `test/pi-visual.test.ts`, `test/test-report.test.ts` | Controles com imagem real e contradição textual; não basta assetId ausente. | Automação no CI; manual Matheus (R5). |
| RF-10 — Conta/perfil | `test/authenticated-api.test.ts`, `test/run-intake-api.test.ts` | Editar nome/equipe, sessão e diferenciação do acesso ao alvo. | Automação no CI; manual Matheus (A-01). |
| RF-11 — Histórico/exclusão | `test/artifacts.test.ts`, `test/run-intake-api.test.ts` | Buscar/filtrar/reabrir, excluir encerrada com confirmação e conferir arquivos. | Automação no CI; manual Matheus (A-06). |
| RF-12 — Board/cobertura | `test/test-report.test.ts`, smoke web | Expandir US/CA, fontes/casos, cobertura parcial e critérios não cobertos. | Automação no CI; manual Matheus (A-07). |
| RF-13 — Plano | `test/prepare-plan.test.ts`, `test/plan-approval.test.ts` | Objetivo, prioridades, exclusões e plano distinto dos casos. | Automação no CI; manual Matheus (A-02). |
| RF-14 — Revisão humana | `test/feedback.test.ts`, `test/case-approval.test.ts`, `test/flow-completion.test.ts` | Alterar plano e casos, validar revisões, reaprovar sem herdar decisão antiga. | Automação no CI; manual Matheus (R3/A-02). |
| RF-15 — Perguntas/retomada | `test/preparation-answers.test.ts`, `test/flow-completion.test.ts` | Resposta localizada, correção da resposta, caminho alternativo e início do caso. | Automação no CI; manual Matheus (R3/A-04). |
| RF-16 — Encerramento/gestão | `test/flow-completion.test.ts`, `test/test-report.test.ts`, `test/artifacts.test.ts` | Cancelar em ready/espera, parcial, fim com pendências, duplicar sem segredo/aprovações. | Automação no CI; manual Matheus (R3/R4/A-06). |
| RF-17 — PDF | CSS/fluxo de impressão em `src/web/`; smoke web | Mesmo snapshot web/PDF, imagens carregadas, paginação, fontes e revisão publicada. | Manual Matheus (A-07); leitura visual não substituída por teste de texto. |

## Cenários A-01 a A-08

| Cenário | Evidência técnica disponível | Resultado manual a registrar | Responsável |
| --- | --- | --- | --- |
| A-01 — Entrar/enviar/organizar | API de conta/upload, extração/PDF/fontes e smoke web. | Duas fontes e formulário preservado; desktop 1366 px, mobile 390 px, teclado. | Matheus; pendente manual. |
| A-02 — Revisar planejamento | Aprovações por revisão, análise de feedback e fluxo integrado. | Comentários reais, novas versões, duas aprovações humanas efetivas. | Matheus; pendente manual. |
| A-03 — Explorar/testar | Navegador/tentativas/validação/smoke execution com modelos substituídos. | R1/R2 com LLM real, capturas e gabarito externo ao contexto do executor. | Matheus; pendente manual. |
| A-04 — Esclarecer bloqueio | Retomada de feedback, independentes preservados, relatório com pendências. | R3: indisponível + independente; responder, remapear, retomar; encerrar outra execução. | Matheus; pendente manual. |
| A-05 — Recusar saída ruim | Revisões, erros técnicos, limites, publicação só após aprovação. | R5: controles visual/textual examinando evidência, sem aprovação pelo orquestrador. | Matheus; pendente manual. |
| A-06 — Encerrar/recuperar | Cancelamento, persistência/restart, duplicação e exclusão. | R4: confirmar registros/mídias e ausência de ações novas/repetição após reinício. | Matheus; pendente manual. |
| A-07 — Conferir relatório | Snapshot determinístico, cinco vereditos, versão publicada e histórico. | Comparar web/PDF, clareza das capturas, critérios sem cobertura e relatório parcial. | Matheus; pendente manual. |
| A-08 — Operação | Isolamento de conta/API/mídia, allowlist, testes de deploy/backup. | Duas contas; segredo fictício ausente; destino recusado; restore sintético; retorno visual ≤1 s, progresso ≤5 s e 20 consultas ≤2 s cada. | Matheus; pendente manual. |

## Regras de decisão

R1–R5 estão detalhados no [README](README.md#ensaios-manuais-com-modelos-reais).
Para cada linha manual, anexar ID/versão, resultado observado, referência privada
à evidência e decisão. Divergência exige correção e nova avaliação documentada;
preservar o resultado anterior. Registrar consumo e duração efetivos quando
disponíveis, sem converter ausência de medição em zero.

A revisão humana das evidências é aceite da equipe, não uma terceira aprovação
obrigatória dentro do produto. Merge/publicação/promoção da imagem só devem ser
registrados quando ocorrerem; CI verde não comprova sozinho os cenários manuais.
