# T6.2 — Aprovar ou solicitar alterações nos casos de teste

Verificação realizada em **25/09/2026**.
Vínculo: avanço de [T6 · #9](https://github.com/mh131105/akcit-qa-agent/issues/9).
Requisitos atendidos: RF-14, RN-04, RN-05, RN-06 e RNF-04/RNF-06.
Base verificada: `develop`, merge [`8b46434`](https://github.com/mh131105/akcit-qa-agent/commit/8b464344fe38c4fb2478d591c25c3451e06fa8dc) do PR #25.
Branch de trabalho: `feat/case-approval`.
Ambiente de execução: Node.js **24.21.0**, Chromium **153.0.8010.52** em container Debian Bookworm (`akcit-qa:t62`).

> **Aviso sobre os dados:** Todos os dados, requisitos, respostas e pareceres utilizados nestas verificações são **estritamente sintéticos**. Nenhum documento de usuário, credencial real ou chamada paga a modelos de linguagem foi utilizada.

---

## 1. Verificações automatizadas

Foram executadas com sucesso as etapas de validação em Node.js 24:

```sh
npm run check
npm test
npm run build
npm run smoke:web
```

### Resultados obtidos:
- **`npm run check`:** Verificação de tipos TypeScript sem nenhum erro (`tsc --noEmit`).
- **`npm test`:** **144/144 testes** unitários e de integração aprovados (0 falhas).
  - Regras puras de aprovação e solicitação de alterações de casos (`test/case-approval.test.ts`).
  - Persistência atômica, concorrência, recuperação e reinício de servidor (`test/plan-approval-storage.test.ts`).
  - Endpoints autenticados, isolamento entre contas, validação de entradas e dependências (`test/authenticated-api.test.ts`).
- **`npm run build`:** Compilação do projeto para `dist/` concluída sem divergências.
- **`npm run smoke:web`:** **28 verificações aprovadas em 22.611 ms** com Playwright em Chromium headless. A jornada valida o fluxo completo pelo navegador, incluindo criação, geração de casos, validação, revisão humana, recuperação de resposta incerta, persistência após recarregamento e separação estrita de históricos.

---

## 2. Critérios de Aceite demonstrados

| Critério | Descrição | Como foi comprovado |
| --- | --- | --- |
| **CA-01** | **Aprovação válida:** Casos vigentes, validados e dependentes de plano aprovado permitem registrar decisão humana da revisão exata. | Testes em `test/case-approval.test.ts`, `test/authenticated-api.test.ts` e jornada de smoke web. A decisão é registrada em `run.approvals` com `decision: 'approved'`, autor e data UTC. |
| **CA-02** | **Pedido de alteração:** Comentário não vazio é obrigatório e preservado com autor, data e revisão. | Validado com erro `400 / COMMENT_REQUIRED` para comentários vazios ou com espaços em branco. Comentário preenchido é salvo intacto sem truncamento. |
| **CA-03** | **Consistência:** Casos antigos, dependências alteradas, parecer ausente/rejeitado ou plano sem aprovação impedem a decisão. | Testes em `case-approval.test.ts` e `authenticated-api.test.ts` confirmam recusa com `409 / STALE_VERSION` ou `409 / INSUFFICIENT_VALIDATION`, sem alterar os registros salvos. |
| **CA-04** | **Repetição e concorrência:** Envios iguais não duplicam; decisões diferentes para a mesma revisão retornam conflito. | Repetição idêntica é idempotente (`200 OK` retornando a decisão existente). Decisão conflitante (ex: tentar aprovar após pedir alteração na mesma revisão) retorna `409 / DECISION_CONFLICT`. |
| **CA-05** | **Persistência:** Recarregar, sair da conta e reiniciar o servidor preservam a decisão confirmada. | Verificado em `test/plan-approval-storage.test.ts` (releitura por nova instância de `RunStore`) e no smoke web (recarregamento da página). |
| **CA-06** | **Isolamento:** Outra conta não consulta nem decide sobre a execução; troca de conta durante o envio é recusada. | Testado em `test/authenticated-api.test.ts`: requisições de outros usuários retornam `404 / RUN_NOT_FOUND` e cabeçalhos `X-Expected-User-Id` incompatíveis são barrados. |
| **CA-07** | **Interface correta:** Decisões de plano e casos aparecem nos lugares certos; comentários não migram entre saídas ou revisões. | Corrigido em `src/web/app.js`: históricos de decisões agora filtram estritamente por `outputId`. Decisões de casos não são exibidas como aprovações do plano e vice-versa. |
| **CA-08** | **Recuperação:** Falhas antes da gravação e perda da resposta após gravar preservam o comentário e permitem consultar o estado, sem reenvio automático. | Testado no smoke web com aborto intencional de rede: a mensagem de orientação é exibida, o comentário digitado permanece no formulário e não há reenvio automático. |
| **CA-09** | **Limite da entrega:** Decidir não inicia modelos, navegador, nova revisão ou intenção de trabalho. | Conferido no smoke web e testes de integração: `phase` permanece `case_design`, status permanece `awaiting_approval`, nenhuma saída de `mapping` é criada e nenhuma intenção pendente é gerada. |
| **CA-10** | **Regressão:** Aprovação do plano e geração dos casos continuam funcionando plenamente. | Todo o conjunto de 144 testes e os 28 checks do smoke web cobrem regressão das entregas T2.1, T3.1, T3.2, T3.3, T4.1 e T6.1. |

---

## 3. Evidências Visuais da Interface

As capturas foram geradas automaticamente pelo teste de fumaça (`scripts/smoke-web.mjs`), conferindo tanto desktop (1366 px) quanto visualização mobile (390 px):

### Revisão humana dos casos de teste
Casos validados aguardando decisão humana, com botões para aprovação e solicitação de alterações:
- [Visualização Desktop (1366 px)](web-cases-review.png)
- [Visualização Mobile (390 px)](web-cases-review-mobile.png)

### Casos de teste aprovados
Confirmação registrada, mantendo o estado de espera e informando que o mapeamento ainda não foi iniciado:
- [Visualização Desktop (1366 px)](web-cases-approved.png)
- [Visualização Mobile (390 px)](web-cases-approved-mobile.png)

### Solicitação de alterações nos casos
Confirmação da alteração solicitada, exibindo o comentário registrado, autor e data, mantendo a espera de revisão:
- [Visualização Desktop (1366 px)](web-cases-changes.png)
- [Visualização Mobile (390 px)](web-cases-changes-mobile.png)

### Persistência após recarregar
Confirmação de que o estado e a decisão registrada permanecem após atualização da página no navegador:
- [Visualização Desktop (1366 px)](web-cases-persisted.png)

---

## 4. Limitações e Escopo desta Entrega

1. **Nenhum navegador ou mapeamento iniciado:** A aprovação humana dos casos é a segunda autorização exigida pelo fluxo do produto antes de qualquer ação na aplicação testada. Esta entrega não inicia navegador, não agenda tarefas de mapeamento (`mapping`) e não chama modelos de IA.
2. **Processamento automático de alterações pendente:** O registro da solicitação de alterações e seu comentário é persistido de forma imutável. A interpretação e o reprocessamento dessa alteração (revisão de plano ou regeneração de casos) não estão incluídos neste card e exigirão entrega futura com revisão de dependências.
3. **Escopo do `/continue`:** Permanece restrito à geração dos casos lógicos a partir do plano aprovado.

## 5. BUG-T6.2-01 — Comentário preservado e casos desatualizados

Verificação em **25/09/2026 (UTC)**, no próprio [PR #26](https://github.com/mh131105/akcit-qa-agent/pull/26).
Base reproduzida: [`41d8b20`](https://github.com/mh131105/akcit-qa-agent/commit/41d8b20ae8514c6caca67323422890402566d07f).
Correção e regressões: [`063e19a`](https://github.com/mh131105/akcit-qa-agent/commit/063e19ae34c4cdc179951457d57080191c4e7dd5).
Os resultados e as capturas das seções anteriores correspondem à entrega original;
esta seção registra a validação adicional do bug.

### Reprodução e correção

1. Após abortar uma decisão antes da gravação, o campo manteve A. Ao editar para
   `  B: Revisar também os dados do CT-03.\n  ` e clicar em **Atualizar consulta**,
   o smoke falhou: recebeu `Revisar o resultado esperado do caso CT-03.` (A).
   A consulta reutilizava o comentário capturado no envio. Agora chama
   `pendingComment(run, accountId, pending)` antes de reconstruir a página,
   preservando os vínculos de conta, execução, saída e revisão.
2. Com apenas a correção do comentário aplicada, aprovar os casos e acrescentar
   uma revisão da curadoria pelo armazenamento sintético ainda deixou a tela
   mostrando a confirmação de aprovação. O smoke falhou aguardando o aviso de
   casos desatualizados. Agora `cases.current` é verificado antes da decisão:
   o aviso tem precedência e a aprovação permanece no histórico com a indicação
   **Conteúdo desatualizado**. Decisões de revisões anteriores recebem a mesma indicação.

### Resultados obtidos

Executado em containers locais Debian Bookworm, **Node.js 24.21.0** e dependências
do `package-lock.json`. `check`, testes e build usaram o estágio `dependencies`
do Dockerfile; o smoke usou `akcit-qa:t62` com os arquivos corrigidos de interface
e smoke montados, em **Chromium 153.0.8010.52**.

| Comando | Resultado |
| --- | --- |
| `npm run check` | Aprovado, sem erros de TypeScript. |
| `npm test` | **144/144 aprovados**, 0 falhas, 0 ignorados; 7.684,701 ms. |
| `npm run build` | Aprovado, compilação concluída. |
| `npm run smoke:web` | **33 verificações aprovadas**, incluindo os cinco CA abaixo; 24.991 ms. |

| Critério deste bug | Evidência automatizada em `scripts/smoke-web.mjs` |
| --- | --- |
| CA-01 | POST de alteração com A abortado antes da gravação; editar para B e atualizar conserva B literalmente. Continua apenas um POST e nenhuma decisão de casos gravada. |
| CA-02 | Após a falha e edição para B, criar a revisão 2 sintética e consultar deixa B em campo somente leitura da revisão 1; o comentário da revisão 2 fica vazio. Outra execução também começa vazia. Cabeçalho de conta e referência da saída são conferidos nos envios. |
| CA-03 | Aprovar casos, alterar a dependência de curadoria no armazenamento e consultar mostra **Casos desatualizados**, identifica a aprovação histórica como desatualizada e remove os dois botões de decisão. `cases.current` e `canDecideCases` são falsos; a coleção de aprovações permanece intacta. |
| CA-04 | Antes de alterar a dependência, recarregar conserva a confirmação de aprovação e `cases.current: true`, com uma única aprovação de casos. |
| CA-05 | Gravar o pedido de alteração da revisão 2 com resposta 200 e abortar sua entrega ao navegador. A consulta recupera uma única decisão com o comentário correto; recuperação e reload não acrescentam POST. |

O smoke gera `web-result.json`, `web-cases-stale.png`,
`web-cases-stale-mobile.png` e `web-cases-comment-recovery.png` quando
`SMOKE_ARTIFACT_DIR` está definido. As capturas adicionais foram inspecionadas:
aviso e histórico legíveis em 390 px, sem transbordamento; comentário antigo
somente para cópia e campo da revisão nova vazio. Na CI, ficam no artefato `web-smoke`.

Dados, contas e armazenamento temporário exclusivamente sintéticos; chamadas de
modelo substituídas no teste, **nenhuma inferência paga**. As consultas e decisões
mantiveram a contagem de chamadas simuladas, sem iniciar mapeamento. Revisão técnica
do ajuste realizada pelo Codex, conforme solicitado pelo responsável, sem achados
bloqueantes nos cinco critérios.
