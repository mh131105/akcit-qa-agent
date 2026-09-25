# Sprint única: entrega em 26/09 às 17h

Atualizado em 24/09/2026. Horário de Manaus. A equipe mantém quatro frentes, com
responsáveis a escolher. A [especificação](requisitos/PROTOTIPO.md) define a entrega;
as tarefas abaixo implementam seus requisitos, sem uma segunda sprint no plano.

## Quatro frentes

| Frente | Responsabilidade | Primeiro trabalho |
| --- | --- | --- |
| A · Interface | Acesso, histórico e nova execução; página de execução com abas, aprovações, dúvidas, vídeos e impressão | Integrar T2.1 às APIs de T3.2/T3.3 e seguir com as demais vistas |
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

### T1.1 · Controlar a aprovação do plano antes de criar casos

História técnica de suporte ao fluxo do usuário, de prioridade alta, **parte de
[T1 · Contratos](https://github.com/mh131105/akcit-qa-agent/issues/4)**.
Responsável: um desenvolvedor da frente B. Entrega: [PR #17](https://github.com/mh131105/akcit-qa-agent/pull/17),
**integrado em `develop`**, merge `4b00ef2`; T1.1 está integrada.

Dependência satisfeita: especificação, contratos atuais e exemplo sintético foram
integrados em `develop` pelo [PR #15](https://github.com/mh131105/akcit-qa-agent/pull/15),
commit `f037a63`, presentes na base desta branch. O recorte atende parcialmente
RF-09, RF-14, RN-04, RN-05, RN-06 e RN-12.

A função pura `applyPlanApprovalCommand` separa registro da decisão e continuidade:
aprovação fica registrada enquanto a continuidade aguarda reserva; pedido de alteração
exige comentário e encaminha análise;
criação dos casos exige plano e curadoria vigentes validados, aprovação humana da
mesma revisão e recurso reservado. Inclui recusa de estados e versões incompatíveis,
preservação do histórico e proteção contra repetição/conflito. Contrato, transições,
erros e limites estão em [CONTRATOS.md](requisitos/CONTRATOS.md#controle-implementado-da-aprovação-do-plano--t11).

Os testes automatizados comprovam CA-01 a CA-08 com pareceres sintéticos, sem modelo
ou VPS; a entrega exige `npm run check`, `npm test` e `npm run build` aprovados.
T3.1 consome a função sobre estado salvo e confere o proprietário pelo contexto
interno; autenticação e API continuam em T3. T4 — Orquestração obterá a reserva e
despachará as intenções persistidas, integrando especialistas, validador, Pi e navegador.

**T1 permanece aberta:** T1.1 comprova somente este controle. Persistência,
concorrência real, orquestração e validação por IA continuam nas tarefas seguintes;
o fluxo completo ainda precisa ser integrado e verificado.

### T3.1 · Persistir decisões do plano e trabalho autorizado

História técnica de suporte ao usuário, de prioridade alta, **parte de
[T3 · #6 — API, persistência e recuperação](https://github.com/mh131105/akcit-qa-agent/issues/6)**.
Responsável: um desenvolvedor da frente B. Entrega: [PR #18](https://github.com/mh131105/akcit-qa-agent/pull/18),
**integrado em `develop`**, merge `31fc732`; T3.1 está integrada.
Dependência atendida: T1.1 integrada
pelo [PR #17](https://github.com/mh131105/akcit-qa-agent/pull/17), merge `4b00ef2`.
Cobertura parcial: RF-08, RF-14; RN-05, RN-06; RNF-06.

O recorte salva a execução completa e suas intenções em um JSON por execução,
reutiliza `applyPlanApprovalCommand` e separa decisão de continuidade. Aprovação
ou pedido de alteração persistem sem reserva; continuar exige confirmação interna
da reserva e grava estado e intenção juntos. A atualização serializa leitura,
aplicação e gravação, preserva os demais dados e recusa revisões ambíguas. Reinício
interrompe execuções ativas e intenções pendentes, preservando o histórico, sem
despacho automático.

Os testes de CA-01 a CA-10 usam arquivos reais temporários, releitura após reabrir
o armazenamento, repetição e conflito concorrentes, falha antes da substituição e
recuperação idempotente. O PR preservou os 18 testes anteriores e ampliou a suíte
para 35 testes. Contrato e limites estão em
[CONTRATOS.md](requisitos/CONTRATOS.md#persistência-da-aprovação-do-plano--t31).

**T3 e T4 permanecem abertas.** T3.1 é dependência da integração de
[T4 · #7](https://github.com/mh131105/akcit-qa-agent/issues/7), que fornecerá a
reserva real e consumirá as intenções pelo Pi. API, autenticação, reserva do
navegador e execução dos especialistas não fazem parte deste recorte; o registro
único de intenção não garante execução do agente exatamente uma vez.

### T3.2 · Consultar e decidir sobre o plano com autenticação

História de usuário com implementação de backend, prioridade alta, **parte de
[T3 · #6 — API, persistência e recuperação](https://github.com/mh131105/akcit-qa-agent/issues/6)**.
Responsável: um desenvolvedor da frente B. Entrega:
[PR #19](https://github.com/mh131105/akcit-qa-agent/pull/19), **integrado em
`develop`**, merge `e18bcec`; T3.2 está integrada.
Dependências atendidas: T1.1 e T3.1
integradas pelos [PRs #17](https://github.com/mh131105/akcit-qa-agent/pull/17) e
[#18](https://github.com/mh131105/akcit-qa-agent/pull/18).
Cobertura parcial: RF-08, RF-10, RF-14; RN-05; RNF-04 e RNF-06.

Como participante habilitado do piloto, quero entrar, consultar minha execução,
aprovar ou solicitar alterações no plano vigente e reencontrar a decisão ao
retornar, mantendo os dados acessíveis somente à minha conta.

T3.2 acrescentou sete operações HTTP: cadastro, login, logout, sessão atual,
consulta de execução própria, aprovação e pedido de alteração. Usa contas
persistidas, senha com scrypt assíncrono, sessão em memória por oito horas, cookie
protegido, origem configurada, lista de e-mails habilitados e limites de tentativas.
A identidade vem da sessão; consulta e decisões reutilizam o serviço de T3.1.
Decisão anterior inválida deixa de produzir sucesso idempotente, sem correção
silenciosa do registro. Aprovação mantém a espera, sem criar trabalho.

CA-01 a CA-10 são verificados por jornada HTTP real com duas contas e armazenamento
temporário: unicidade concorrente, sessão, isolamento, persistência após reinício,
repetição/conflito, entrada protegida e ausência de campos privados. A regressão
de T1.1 falha antes da correção e passa depois; os 35 testes anteriores foram
preservados, totalizando 46 testes na base integrada. Execute com Node.js 24:
`npm run check`, `npm test`, `npm run build`.
Para reproduzir somente a jornada, use
`node --import tsx --test test/authenticated-api.test.ts`. Contrato, DTO público,
exemplos e limites estão em
[CONTRATOS.md](requisitos/CONTRATOS.md#api-autenticada-de-revisão-do-plano--t32);
a configuração do piloto está em [OPERACAO.md](OPERACAO.md#acesso-dos-participantes-do-piloto).

Desbloqueia a integração das telas de acesso e revisão do plano. **T3 e T4
permanecem abertas.** Criação e histórico estão em T3.3 e a interface inicial em
T2.1; upload, `/continue`, reserva real e execução de especialistas continuam pendentes.
Dados sintéticos existem somente no preparo dos testes; continuidade e despacho
pertencem à integração de orquestração.

### T3.3 · Criar e encontrar execuções com entrada textual

História de usuário, prioridade alta, **parte de
[T3 · #6 — API, persistência e recuperação](https://github.com/mh131105/akcit-qa-agent/issues/6)**.
Responsável: um desenvolvedor da frente B. Entrega:
[PR #20](https://github.com/mh131105/akcit-qa-agent/pull/20), **integrado em
`develop`**, merge `d5e4cf2`; T3.3 está integrada. Dependências atendidas:
armazenamento de T3.1 e autenticação de T3.2, integrada pelo PR #19.
Cobertura parcial: RF-01, RF-08, RF-11; RNF-04 e RNF-06.

Como participante autenticado, quero salvar uma execução com nome, aplicação e
texto original das histórias de usuário e critérios de aceite, para organizar o
material e reencontrá-lo no meu histórico.

`POST /api/runs` salva `draft/intake`, artefato original e pendências de acesso,
sem curadoria, plano, orçamento aberto ou trabalho fictício. A chave UUID v4 e o
hash da criação persistido permitem repetição sem duplicação, inclusive em
concorrência, após falha de resposta e reinício. `GET /api/runs` lista somente
resumos da conta, ordenados por data e ID, com busca por nome/aplicação e filtro
por estado. A consulta existente abre o rascunho com `plan: null`.

CA-01 a CA-09 são verificados por `test/run-intake-api.test.ts`: entrar → criar por
POST → histórico → abrir → reiniciar → novo login → reencontrar. Os testes usam
duas contas e diretório temporário, conferem preservação literal, isolamento,
idempotência, entrada inválida e falhas de armazenamento. Estados variados são
simulações somente dos testes; não há carga automática de exemplos ou chamada de
modelo. A base integrada preserva os 46 testes anteriores e totaliza 54 testes.
As verificações da entrega usam Node.js 24: `npm run check`, `npm test` e
`npm run build`. Contratos e limites estão
em [CONTRATOS.md](requisitos/CONTRATOS.md#criação-e-histórico-de-execuções--t33);
repetição após resposta incerta e dados no backup estão em
[OPERACAO.md](OPERACAO.md#criar-e-reencontrar-uma-entrada-textual).

Desbloqueia a entrada persistida para curadoria e a integração das telas de nova
execução e histórico. A definição de pronto exige PR revisado e integrado em
`develop`, com testes, jornada e limitações registrados, referenciando T3 #6 sem
fechá-la automaticamente. **T3, curadoria (T5) e orquestração (T4) permanecem
abertas.** RF-01 e RF-11 continuam parciais: o limite deste card é texto em JSON
de até 16 KiB; upload de `.txt`, `.md` e PDF com limites maiores, edição, exclusão,
curadoria e execução de agentes continuam pendentes. A interface de entrada
textual e histórico é tratada por T2.1 abaixo.

### T2.1 · Acesso, entrada textual, histórico e revisão do plano pelo site

História de usuário, prioridade alta, **parte de
[T2 · #5 — Interface](https://github.com/mh131105/akcit-qa-agent/issues/5)**.
Responsável: um desenvolvedor da frente A; revisão: frente B. Implementação na
branch `feat/web-intake-review`, criada de `origin/develop` atualizado contendo
`d5e4cf2`. Dependências atendidas: T3.2 e T3.3, integradas pelos
[PRs #19](https://github.com/mh131105/akcit-qa-agent/pull/19) e
[#20](https://github.com/mh131105/akcit-qa-agent/pull/20).
Entrega: [PR #21](https://github.com/mh131105/akcit-qa-agent/pull/21), **integrado
em `develop`**, merge `04f8b01`. T2.1 e a correção abaixo estão integradas;
T2 #5 permanece aberta.

Como participante do piloto, quero entrar no site, salvar minhas histórias de
usuário e critérios de aceite, reencontrar a execução e revisar seu plano quando
disponível, para preparar e acompanhar o trabalho sem utilizar comandos técnicos.

As quatro URLs usam HTML, CSS e JavaScript nativos, no mesmo processo Node e com
`fetch` para as APIs reais. Acesso utiliza a sessão existente; histórico aplica
busca/filtro; “Salvar rascunho” registra `draft/intake` e abre o detalhe. O corpo
textual é preservado e o limite é medido no JSON completo em bytes. A tentativa
salva em `sessionStorage`, vinculada ao ID da conta, permite confirmar resposta
incerta com chave e corpo originais após atualizar a página, sem duplicação.
Sessão inválida remove dados privados da tela; outra conta não restaura o
formulário. Logout confirmado limpa a tentativa.

O detalhe mostra somente o que a API retorna. Sem plano, informa que o
processamento não começou. Com plano, apresenta conteúdo, validação e revisão;
aprovação e pedido de alteração usam essa revisão e reconsultam a decisão salva.
Conflitos atualizam a consulta sem reaplicar a decisão. Aprovar mantém a espera.
Não há dados de exemplo carregados pela aplicação nem despacho de agentes.

Cobertura parcial: RF-01, RF-08, RF-10, RF-11, RF-13 e RF-14; RN-05 e RN-06;
RNF-01, RNF-02, RNF-04 e RNF-06. CA-01 a CA-10 do card são verificados por testes
de rotas/cabeçalhos e jornada em Chromium com API e persistência reais. O smoke
cobre duas contas, resposta perdida após gravação, recuperação na mesma aba,
recarregamento e novo login, conteúdo semelhante a HTML e decisões persistidas.
Planos/pareceres são sintéticos, preparados somente no armazenamento temporário;
esse teste não comprova geração por IA. Capturas de 1366 px e 390 px integram a
evidência sintética do PR.

Verificações da implementação inicial: `npm run check`, `npm test` com 55 testes aprovados
(preservando os 54 testes da base), `npm run build`, seis testes Python de
publicação e os dois smokes dentro da imagem final. O smoke web passou nas 16
verificações com Node.js 24.21.0 e Chromium 153.0.8010.52, incluindo as jornadas
do card, clique duplo, troca de conta durante recuperação, conflitos, teclado e
falhas de serviço/armazenamento. Resultado e capturas sintéticos estão em
[evidencias/t2.1](evidencias/t2.1/README.md).
Comandos e artefatos estão em [OPERACAO.md](OPERACAO.md#jornada-pelo-navegador--t21), e o
comportamento em [CONTRATOS.md](requisitos/CONTRATOS.md#interface-inicial--t21).
A definição de pronto exige PR revisado e integrado em `develop`; checks locais
não substituem essa revisão.

#### BUG-T2.1-01 · Isolamento da conta e recuperação durante falhas

Correção P1 no próprio [PR #21](https://github.com/mh131105/akcit-qa-agent/pull/21),
branch `feat/web-intake-review`, sobre `fa91ad2`. Commit de correção:
[`fe61190`](https://github.com/mh131105/akcit-qa-agent/commit/fe6119096f056076e07eb9d05aa9f941422780b6).
Responsável: integração frontend/backend; nova revisão: frente B.

A revisão apontou três bloqueios: troca de cookie entre `/auth/me` e o POST podia
salvar material na conta errada; logout malsucedido apagava a tentativa; falha na
decisão reconstruía a página sem o comentário. As operações de execuções e logout
agora exigem `X-Expected-User-Id`, validado centralmente contra a sessão, sem
atribuir propriedade pelo cliente. A recuperação só é apagada após logout `204`;
falha de limpeza local não desfaz a saída confirmada. Comentários ficam em memória
com conta, execução e revisão originais, inclusive nas reconsultas malsucedidas;
revisão nova ou conflito conserva uma cópia para leitura, sem POST automático.

Antes das correções, quatro testes HTTP novos falharam. Os três cenários de
navegador também falharam na imagem de `fa91ad2`: criação indevida `201` em vez de
`409`, tentativa apagada no logout `503` e comentário vazio após falha de envio.
Depois das correções, `npm run check`, `npm test` (**59/59**, preservando os 55
anteriores) e `npm run build` passaram com Node.js 24.19.0. Os seis testes Python
de publicação passaram. A imagem final local, com Node.js 24.21.0 e Chromium
153.0.8010.52, passou no smoke de infraestrutura e nas **21 verificações do smoke
web**, incluindo os três cenários de regressão, com API e persistência reais,
sem modelo pago. [Evidências e limites](evidencias/t2.1/README.md).

**T2.1 e BUG-T2.1-01 foram integradas pelo PR #21, merge `04f8b01`.**
O merge é a base de T4.1; os resultados acima descrevem a entrega anterior.
**T2 #5 permanece aberta.**
Design definitivo e implementação de agentes estão fora deste card.

**T2 continua aberta.** Upload, edição, exclusão, duplicação, board de US/CA,
resposta/retomada das etapas posteriores à preparação, casos e relatório permanecem
nas tarefas correspondentes. T4.1 e o ajuste de 24/09 acrescentam preparação,
perguntas e esclarecimentos; T2.1 implementa entrada textual e
operações disponíveis; não conclui as sete vistas nem a aceitação completa do
produto. Não há credenciais, sessões ou documentos privados versionados.

Não criar um produto completo para servir de alvo: telas simples com dados
restauráveis bastam. O agente recebe requisitos e acesso; o código e o gabarito dos
defeitos ficam fora de seu contexto.

### T4.1 · Preparar um plano real com curadoria e validação independente

História de usuário, prioridade alta. Responsável: frente B; revisão de metodologia
pela frente C e integração por outro desenvolvedor. Recorte de
[T4 #7](https://github.com/mh131105/akcit-qa-agent/issues/7),
[T5 #8](https://github.com/mh131105/akcit-qa-agent/issues/8),
[T6 #9](https://github.com/mh131105/akcit-qa-agent/issues/9) e
[T10 #14](https://github.com/mh131105/akcit-qa-agent/issues/14), sem encerrá-las.
Branch `feat/prepare-validated-plan`, a partir de `origin/develop` contendo
`04f8b01`. [PR #22](https://github.com/mh131105/akcit-qa-agent/pull/22)
**integrado em `develop` em 24/09/2026, merge `71781a2`**, incluindo o ajuste de
entradas/esclarecimentos abaixo. As demonstrações históricas não passam a representar
aprovação humana ou capacidades de casos por causa desse merge.

O site permite salvar rascunho, preparar plano, acompanhar fase/papel e cancelar.
O coordenador persiste trabalho/orçamento antes do aceite HTTP, executa curador,
validador, planejador e validador, com sessões Pi independentes, revisões limitadas,
originais e fontes literais. Só a revisão vigente aprovada pelo validador chega
aos controles humanos existentes. Repetição, ambiente ocupado, perguntas
localizadas, timeout, cancelamento e recuperação preservam registros e limites.
Não há chamada extra de modelo para encaminhar as etapas, fallback de modelo ou
ferramentas de terminal/navegador nesses especialistas.

Cobertura pretendida: CA-01 a CA-12 do card; RF-02, RF-08, RF-09, RF-13, RF-14
e partes de RF-15/RF-16; RN-01, RN-02, RN-05, RN-06, RN-08, RN-12 e RN-15;
RNF-04, RNF-06, RNF-07, RNF-08 e RNF-10. Os testes automáticos substituem a chamada
de modelo e não comprovam CA-12. Verificação histórica no código `069a5e7`: check/build aprovados,
**87/87 testes** (59 anteriores preservados), seis testes operacionais e ambos os
smokes aprovados no container final; smoke web com 24 verificações. Node.js
24.21.0 e Chromium 153.0.8010.52.

A dependência de credencial local em **T0 #3 foi resolvida** com OAuth de assinatura
OpenAI autorizado pelo responsável. Curador, planejador e validador usam
`openai-codex/gpt-6-astra`, com sessões separadas. Em 24/09/2026 a avaliação foi
refeita com **somente US-01 e CA-01/CA-02**, objetivo vazio e execução nova.
As evidências anteriores com notas de demonstração e percurso sugerido foram
removidas/substituídas; código de produção e skills não foram alterados.

A nova preparação pela API HTTP real produziu curadoria r1 e plano r2 aprovados
pelo validador: **6 chamadas, 76,740 s e 13.632 tokens**. Não há nova captura
nem alegação de nova jornada pela UI. Dois ensaios independentes detectaram
limite 10→11 e comentário opcional→obrigatório com os originais limpos.
O conservadorismo do validador sobre a sequência metodológica permaneceu registrado.
Check, 87/87 testes e build passaram novamente após a limpeza do artefato/fixture.

O plano daquela demonstração permanece em `awaiting_approval/planning`, sem decisão
humana fabricada. A avaliação da frente C e a aprovação daquele plano não são
comprovadas pelo merge do código. Evidências dessa demonstração e limitações:
[evidencias/t4.1](evidencias/t4.1/README.md).

Limite histórico de T4.1: termina na revisão humana do plano; `/continue`, criação de
casos, mapeamento, navegação, execução, vídeos, relatório e upload permanecem nas
tarefas correspondentes. O ajuste abaixo acrescenta `/answer` e `/resume` somente
à preparação. A decisão humana não dispara casos.
Contratos em [CONTRATOS.md](requisitos/CONTRATOS.md#preparação-do-plano-com-especialistas--t41);
configuração e roteiro real em [OPERACAO.md](OPERACAO.md#modelos-e-preparação-do-plano--t41).

### Ajuste de entradas e esclarecimentos · 24/09/2026 · mesmo PR #22

O PR passa a incluir a decisão de entrada mínima por comportamento esperado
verificável (RN-01): US/CA, requisitos funcionais, prosa e Gherkin textual opcional,
sem exigir template formal. A curadoria distingue regras gerais e exemplos
recebidos, preserva fontes e pode bloquear apenas regras dependentes de uma dúvida.
Propostas de regra ficam em perguntas até uma decisão explícita do usuário.

As três skills foram refinadas para fidelidade, perguntas úteis e plano conciso;
o validador deve rejeitar defeitos materiais, sem exigir que um plano correto
recite a sequência de agentes e aprovações. A geração de cenários quando o cliente
não os fornece continua responsabilidade da etapa futura de casos, após plano
aprovado; não foi implementada pela aceitação de Gherkin.

A preparação recebe respostas imutáveis e retoma por ação explícita. Conserva
originais, acrescenta fontes das respostas, invalida imediatamente o avanço pelo
plano antigo e produz revisões crescentes dos mesmos IDs, com novas validações e
nova revisão humana. O ciclo de produção é limitado e os 45 minutos ativos
permanecem cumulativos. Não há retomada automática após erro ou reinício.

Código, verificações e comparação das skills pertencem a esta revisão do PR;
resultados anteriores de T4.1 acima são históricos. Consulte
[evidências do ajuste](evidencias/ajuste-entradas/README.md) para o que efetivamente
foi executado, modelos, limites e pendências. Esta seção não registra aprovação
humana nem encerra T4, T5, T6 ou T10. O código foi integrado pelo PR #22 em
`71781a2`; as pendências de avaliação registradas nas evidências permanecem explícitas.

### T6.1 · Gerar e validar casos do plano aprovado

História técnica de prioridade alta, um desenvolvedor com atuação backend/agentes;
revisão de integração pela frente B e conferência metodológica pela frente C.
Recorte de [T6 #9](https://github.com/mh131105/akcit-qa-agent/issues/9), sobre
`origin/develop` em `71781a2`, branch `feat/validated-test-cases`, entrega pelo
[PR #23](https://github.com/mh131105/akcit-qa-agent/pull/23). Avança RF-04/RF-09;
**não conclui T6 nem TELA-06**.

A página da execução permite aprovar o plano e, separadamente, acionar **Gerar casos
de teste**. `/continue` reconfere revisão, curadoria, pareceres, aprovação humana,
originais, respostas, orçamento e reserva antes de inferir. O designer carrega
somente `create-test-cases`; o validador independente confere a revisão exata com
contexto completo. Correção mantém ID/histórico; bloqueio e limites interrompem
com motivo. Persistência coordena intenção e início, encerra intenções e protege
contra repetição, concorrência, cancelamento, resposta tardia e reinício.

Casos têm dados concretos, técnicas justificadas quando aplicáveis, fontes e
`pathId: null`. O site apresenta detalhes expansíveis, revisão, conteúdo provisório
e pareceres, com o aviso de percurso ainda não mapeado. O resultado aprovado fica
em `awaiting_approval/case_design`. **Aprovação humana dos casos, mapeamento,
navegação, vídeos e relatório ainda serão implementados.**

Critérios CA-01 a CA-09: autorização exata, continuidade pelo site, fidelidade/escopo,
técnicas coerentes, sessões independentes, rastreabilidade, limites cumulativos,
consistência e consulta sem alegação de execução. CA-10 acrescenta demonstração real
com prosa (quantidade inteira 1–10), exemplo pontual Gherkin e erro conhecido no
validador, avaliados contra expectativas escritas antes das chamadas. Não se usa
gabarito nos prompts nem se modifica evidência anterior.

Verificações exigidas: `npm run check`, `npm test`, `npm run build` e
`npm run smoke:web` em Node 24. Os testes substituem respostas dos modelos; o smoke
usa site, API e persistência reais. Comandos executados, commit, modelos, revisões,
resultados e limitações ficam em [evidencias/t6.1](evidencias/t6.1/README.md).
Contrato em [CONTRATOS.md](requisitos/CONTRATOS.md#casos-lógicos-a-partir-do-plano-aprovado--t61)
e roteiro em [OPERACAO.md](OPERACAO.md#gerar-e-consultar-casos-lógicos--t61).

Definição de pronto: novo PR para `develop`, CI aprovada, revisão B, conferência C,
ajustes e merge. A pedido explícito do responsável, houve revisões por agentes,
incluindo revisão cruzada do backend; a revisão C não teve autoria das skills nem
das saídas reais. Esses pareceres não são apresentados como revisão humana.
T6 #9 permanece aberta; o estado dessas verificações será registrado no PR e nas
evidências.

### Política de distribuição de modelos e raciocínio explícito DeepSeek · 24/09/2026

Entrega técnica de padronização da distribuição de modelos e configuração explícita de raciocínio (`thinkingLevel`), integrando as definições de [INSTRUÇÕES.md](../INSTRUÇÕES.md).

- **Configuração e runtime:** `src/config.ts` valida `PI_*_THINKING_LEVEL` (`off`, `low`, `high`) e resolve a configuração antes da execução. `src/runtime/pi.ts` repassa o nível explicitamente à sessão Pi. `src/storage/runs.ts` persiste o nível em `PreparationCall`, preservando compatibilidade com registros legados sem preenchimento retroativo.
- **Distribuição adotada:** oficializa a API oficial DeepSeek como padrão do protótipo: Curador (`deepseek-flash` / `low`), Projetista (`deepseek-v4-pro` / `high`) e Validador textual (`deepseek-v4-pro` / `high`).
- **Vinculação de etapas futuras:** define os contratos das fases futuras vinculados à política:
  - Projetista em `route_detail`: `deepseek-v4-pro` / `high`, preservando campos lógicos aprovados.
  - Executor (mapeamento e execução): `deepseek-flash` / `high` (com suporte a imagem e visão).
  - Redator (relatório): `deepseek-flash` / `low` (consolidação de conclusões validadas).
  - Validador visual: `deepseek-flash` / `high` (revisão independente de mapa e evidências com imagens).
- Fases futuras permanecem desabilitadas até suas entregas específicas; a política documentada não pressupõe implementação ou evidência antecipada dessas fases.

> **Ressalva factual:** A execução existente comprova a integração técnica da preparação textual; ainda não comprova a qualidade do navegador, do relatório ou da validação visual, nem superioridade entre modelos.

### T6.2 · Aprovar ou solicitar alterações nos casos de teste

História de usuário, prioridade alta, **avanço de [T6 · #9](https://github.com/mh131105/akcit-qa-agent/issues/9)**.
Responsável: um desenvolvedor com atuação em backend e frontend.
Revisão: outro integrante, conferindo integração e regras de aprovação.
Requisitos: RF-14, RN-04, RN-05, RN-06 e RNF-04/RNF-06.
Base verificada: `develop`, merge `8b46434` do PR #25. Branch: `feat/case-approval`.
Estado: **Implementação concluída**; revisão por outro integrante e merge para `develop` pendentes (T6 #9 permanece aberta).

Como responsável pelos testes, quero revisar o conjunto de casos validado e aprová-lo ou solicitar alterações com um comentário, para registrar exatamente quais situações, dados e resultados esperados autorizei antes do mapeamento da aplicação.

T6.2 implementa a segunda aprovação humana exigida pelo fluxo:
- **Domínio puro e idempotência:** extrai a lógica compartilhada de registro e conflito de decisões em `src/domain/plan-approval.ts` e implementa `src/domain/case-approval.ts` com validação de fase (`case_design`), situação (`awaiting_approval`), dependências atômicas (`caseDependencies`) e parecer aprovado emitido por `output-validator`. Decisão idêntica é idempotente; decisões divergentes geram conflito (`409`).
- **Aplicação e armazenamento:** atualiza atômica via `RunStore.update`, com `canDecideCases` calculado no DTO `PlanReview`. Reutiliza a coleção existente `run.approvals`, preservando histórico sem necessidade de migração ou nova coleção.
- **Endpoints unificados:** `POST /api/runs/:id/approve` e `POST /api/runs/:id/request-changes` despacham para plano ou casos identificando o `outputId` no registro persistido, sem campos extras de fase enviados pelo cliente. Comentário não vazio é obrigatório para pedidos de alteração e preservado na íntegra.
- **Interface web:** exibe revisão, parecer e botões de aprovação e solicitação de alterações no painel de casos em `/execucoes/:id`; separa os históricos de decisões por `outputId` (evitando misturar decisões de plano e casos); preserva comentários digitados em rascunho (`pendingComment`) contra falhas de rede e transições de tela.
- **Limites da entrega:** decidir não inicia o navegador, não agenda tarefas de mapeamento, não reserva recursos e não chama modelos de IA. A interface informa a espera real. Processamento automático de pedidos de alteração de casos requer card e entrega futuros.

Critérios atendidos:
- **CA-01 (Aprovação válida):** casos vigentes e validados permitem registrar decisão da revisão exata.
- **CA-02 (Pedido de alteração):** comentário não vazio obrigatório, gravado com autor, data e revisão.
- **CA-03 (Consistência):** casos antigos, dependências alteradas ou sem parecer aprovado impedem a decisão.
- **CA-04 (Repetição e concorrência):** envios iguais não duplicam; decisões diferentes geram conflito.
- **CA-05 (Persistência):** recarregar, deslogar e reiniciar o servidor conservam a decisão.
- **CA-06 (Isolamento):** outra conta não consulta nem decide sobre a execução.
- **CA-07 (Interface correta):** decisões de plano e casos aparecem estritamente nos respectivos painéis.
- **CA-08 (Recuperação):** perda de resposta e falha de rede preservam comentário para consulta e reenvio manual.
- **CA-09 (Limite da entrega):** nenhum mapeamento, navegador ou intenção de trabalho é iniciado.
- **CA-10 (Regressão):** aprovação do plano e geração de casos continuam funcionando plenamente.

Verificações realizadas:
- `npm run check`: typecheck TypeScript limpo.
- `npm test`: **144/144 testes** aprovados, cobrindo regras de domínio, persistência, concorrência e API autenticada com isolamento entre contas.
- `npm run build`: compilação completa para `dist/`.
- `npm run smoke:web`: **28 verificações**, 22.611 ms, executadas no container com Node 24.21.0 e Chromium 153.0.8010.52, cobrindo a jornada do site desde a validação até a aprovação, solicitação de alterações, recuperação de falha e persistência.
- Evidências em [docs/evidencias/t6.2/](evidencias/t6.2/README.md) com capturas em 1366 px e 390 px.

| Quando | Verificação |
| --- | --- |
| 23/09 | Contratos alinhados; interface integrada à API; primeiro percurso integrado com aprovações, validador, navegador e evidência reais |
| 24/09 | Fluxo completo e cenários de correção, bloqueio, retomada, cancelamento e relatório parcial |
| 25/09 | A-01 a A-08 em dev, correções e ensaio; encerrar ampliação de escopo |
| 26/09 até 12h | Ensaio na versão candidata; conferir acesso e exportação |
| 26/09 até 14h | Promover imagem validada e conferir ambiente de apresentação |
| 26/09 às 17h | Entrega |

São metas de organização, não atividades já concluídas. Se houver atraso, reduzir
número de fluxos, casos e formatos da demonstração, mantendo todas as etapas e os
requisitos de segurança, integridade e acessibilidade. Registrar qualquer mudança
de escopo de forma explícita; não encerrar tarefas com base apenas em mocks.

### T7 · Disponibilizar aplicação controlada de reservas para demonstração

História de usuário, prioridade alta,
**[T7 · #10](https://github.com/mh131105/akcit-qa-agent/issues/10)**.
Responsável: um desenvolvedor com atuação backend/interface.
Revisão: outro integrante, preferencialmente da frente de navegador.
Base: `develop`, merge `13e39c4`. Branch: `feat/controlled-reservations-target`.
Estado: **Concluído e integrado**; [PR #27](https://github.com/mh131105/akcit-qa-agent/pull/27)
integrado em `develop` no commit `000969b`.

Como responsável pela demonstração, quero uma aplicação controlada com login,
navegação, comportamento correto e um defeito conhecido, para verificar se o
agente consegue percorrer a aplicação e identificar problemas com evidências
reproduzíveis.

Implementação:
- **`scripts/demo-target.mjs`:** servidor `node:http` com login (credencial
  sintética), sessão em memória, navegação, reservas com validação server-side.
  Modos `reference` e `known-defect` (rejeita qty 10). Sem dependências além do
  stdlib. Exporta `createDemoTarget()` para testes.
- **`test/demo-target.test.ts`:** 14 testes cobrindo a matriz completa (1, 2,
  9, 10, 0, 11, 1.5, vazio), comentários, XSS, reset, ambos os modos e
  redirecionamento após POST sem duplicação ao recarregar.
- **`scripts/smoke-target.mjs`:** jornada no Chromium com `playwright-core`,
  cobrindo login incorreto, acesso protegido, percurso completo, defeito
  conhecido, reset com sessão inválida e lista vazia.

Verificações:
- `npm run check`: limpo.
- `npm test`: **158/158 testes** (144 anteriores preservados).
- `npm run build`: compilação completa.
- `npm run smoke:target`: jornada pelo navegador com 15 verificações.
- Validação local na imagem runtime com as restrições do CI: os três smokes
  (runtime, web e alvo) passaram após corrigir o reenvio do POST ao recarregar.
  Reprodução e resultados registrados em [evidencias/t7](evidencias/t7/README.md).
  O resultado remoto vigente fica nos checks do PR.

Critérios:
- **CA-01:** aplicação inicia por `npm run demo:target` e o Chromium do container
  acessa via loopback.
- **CA-02:** login funciona e páginas internas exigem sessão.
- **CA-03:** percurso completo por links, botões e formulários visíveis.
- **CA-04:** modo `reference` cumpre os requisitos e a matriz de testes.
- **CA-05:** modo `known-defect` reproduz somente o defeito da quantidade 10.
- **CA-06:** reiniciar restaura o estado inicial de forma reproduzível.
- **CA-07:** requisitos, gabarito e configuração permanecem separados; o alvo não
  fornece dicas sobre o defeito.
- **CA-08:** testes, smoke e documentação permitem repetição sem orientação verbal.

Evidências em [evidencias/t7](evidencias/t7/README.md). Gabarito humano em
[evidencias/t7/gabarito.md](evidencias/t7/gabarito.md) — arquivo fora do
contexto dos agentes. Operação em
[OPERACAO.md](OPERACAO.md#aplicação-controlada-de-reservas--t7).

**T7 fornece o alvo real e reproduzível para T8 (mapeamento).** Não declara
navegação autônoma nem eficácia do agente.

### T8.1 · Configurar acesso privado ao alvo de uma execução

História de usuário, prioridade alta,
**recorte da [T8 · #11](https://github.com/mh131105/akcit-qa-agent/issues/11)**.
Responsável: um desenvolvedor com atuação em backend e interface.
Revisor: outro integrante, preferencialmente da frente B.
Base: `develop`, contendo o merge `000969b`. Branch: `feat/target-access`.
Estado: **Integrada pelo PR #28** em `develop`.

Como responsável pelos testes, quero informar o endereço, a conta de teste, o
perfil de acesso e a preparação necessária da aplicação, para que o executor
tenha os dados necessários ao mapeamento após a aprovação dos casos,
preservando a privacidade das credenciais.

Implementação:
- **`src/application/target-access.ts`:** validação de formato e origens autorizadas,
  conferência de concorrência por `expectedAccessRevision`, armazenamento atômico e
  projeção pública segura (`targetAccess`) sem expor credenciais.
- **`src/storage/runs.ts`:** suporte ao campo confidencial `targetCredential` no
  envelope `StoredRun` fora de `run`; validação estrutural da referência cruzada
  `run.input.credentialRef` e compatibilidade total com execuções legadas (`revision: 0`).
- **`src/config.ts` e `.env.example`:** leitura e validação estrita de `TARGET_ALLOWED_ORIGINS`
  (apenas origens HTTP/HTTPS exatas, sem caminhos, query strings ou fragmentos).
- **`src/http/api.ts`:** habilitação do método `PATCH` em `/api/runs/:id`, com
  validação obrigatória de sessão ativa, `Origin`, `X-Expected-User-Id` e tradução
  de erros em códigos padronizados do produto.
- **`src/application/plan-approval.ts`:** inclusão da projeção segura `targetAccess`
  no retorno de `GET /api/runs/:id`.
- **`src/web/app.js` e `src/web/styles.css`:** painel "Acesso à aplicação testada"
  em `/execucoes/:id`, exibindo resumo legível quando configurado, formulário expansível
  com suporte a substituição explícita de credenciais, tratamento de erro/conflito
  com consulta sob demanda e zero persistência de senhas no storage do navegador.

Verificações:
- `npm run check`: limpo.
- `npm test`: **166/166 testes aprovados** (8 novos testes em `test/target-access.test.ts`
  cobrindo CA-01 a CA-08, além de testes em `authenticated-api.test.ts` e `run-intake-api.test.ts`).
- `npm run build`: compilação completa.
- `docker run ... akcit-qa:ci node scripts/smoke-web.mjs`: percurso completo pelo Chromium
  real no container com 35 verificações (erro de origem não permitida, rede, conflito de versão,
  salvamento inicial, recarregamento, atualização sem reenviar senha e ausência de segredos no storage).
- `docker run ... akcit-qa:ci node scripts/smoke-target.mjs`: 15 verificações do alvo T7 aprovadas.
- `docker run ... akcit-qa:ci node scripts/smoke-runtime.mjs`: 7 verificações de runtime aprovadas.

Critérios atendidos:
- **CA-01:** proprietário configura o acesso pela página e encontra os dados após reload e reinício.
- **CA-02:** configuração incompleta, URL inválida ou origem não autorizada são recusadas sem alteração parcial.
- **CA-03:** isolamento total entre contas; exigência de sessão, `Origin` e `X-Expected-User-Id`.
- **CA-04:** credencial confidencial não aparece em respostas, logs, artefatos ou storage do navegador.
- **CA-05:** controle de revisão impede sobreposição concorrente; conflitos informam e exigem consulta atualizada.
- **CA-06:** plano, casos, aprovações e estados são preservados; `startUrl` torna-se imutável após início da preparação.
- **CA-07:** interface diferencia claramente "Acesso pendente" de "Acesso configurado. O login ainda não foi verificado pelo navegador".
- **CA-08:** compatibilidade regressiva garantida com execuções legadas (revisão inicial 0).
- **CA-09:** formulário navegável por teclado com foco visível e layout responsivo testado em 1366 px e 390 px.
- **CA-10:** documentação, testes e evidências registradas em `docs/evidencias/t8.1/`.

Evidências em [evidencias/t8.1](evidencias/t8.1/README.md). Captura em
[evidencias/t8.1/acesso-configurado.png](evidencias/t8.1/acesso-configurado.png).
Contratos em [CONTRATOS.md](requisitos/CONTRATOS.md#configuração-do-acesso-privado-ao-alvo--t81)
e operação em [OPERACAO.md](OPERACAO.md#configurar-acesso-ao-alvo-t7-em-uma-execução-t81).

**T8 permanece aberta (Refs #11):** T8.1 entrega exclusivamente a configuração e
armazenamento seguro do acesso ao alvo. Mapeamento autônomo pelo navegador, execução
visual dos casos, captura de evidências e gravação de vídeo continuam pendentes.

### T8.2 · Mapear a aplicação com agente visual e validar os percursos observados

História de usuário, prioridade alta,
**recorte da [T8 · #11](https://github.com/mh131105/akcit-qa-agent/issues/11)**, com
integração ao validador da [T10 · #14](https://github.com/mh131105/akcit-qa-agent/issues/14).
Responsável: um desenvolvedor da frente de navegador/backend. Revisão: outro
integrante para integração e uma pessoa da frente C para conferir a qualidade do mapa.
Base: `develop`, contendo `73063ac`. Branch: `feat/validated-navigation-map`.

Como responsável pelos testes, quero que o agente entre na aplicação e observe seus
caminhos de navegação, depois da aprovação dos casos, para que os testes recebam
percursos reais, sustentados por evidências e revisados por um validador independente.

Implementação:
- **`src/domain/navigation.ts`:** contrato e validação estrutural do mapa (telas,
  transições, caminhos, pendências, limitações), com referências a observações e
  ações reais; referências inventadas são recusadas.
- **`src/application/map-application.ts`:** verificação específica das condições de
  início (não usa `canDecideCases`), rotina de produção do executor e validação visual
  em sessão independente, revisões, pareceres e transições de estado.
- **`src/runtime/pi-visual.ts`:** sessões Pi com `customTools`, imagens e contagem de
  todas as chamadas e ações; 120 s por chamada, orçamento acumulado por execução.
- **`agents/test-executor/tools/browser.mjs`:** navegador real (Chromium/Xvfb/xdotool),
  observar tela, mover/clicar, teclado/rolagem e preenchimento privado de credenciais;
  `TARGET_ALLOWED_ORIGINS` antes de cada requisição; bloqueio de novas abas; captura
  com credencial visível nunca enviada nem persistida.
- **Skills:** `test-executor/map-application` (metodologia de exploração) e
  `output-validator/validate-navigation` (critérios de avaliação visual independente).
- **`src/application/prepare-plan.ts`:** continuidade para mapeamento reutilizando a
  reserva, o cancelamento e o orçamento do coordenador existente; intenção `create_map`
  persistida antes do `202`.
- **`src/storage/runs.ts`:** observações, ações, mídia e limites do mapeamento;
  recuperação após reinício preserva registros.
- **`src/http/api.ts`:** continuidade com `expectedAccessRevision` e rota de mídia
  autenticada `GET /api/runs/:id/evidence/:assetId`.
- **`src/web/app.js`:** botão **Mapear aplicação**, painel do mapa (telas com
  capturas, transições, caminhos, pareceres, pendências, limitações, ações),
  estado `ready / mapping` exibido como *"Mapa validado — aguardando detalhamento dos
  percursos"* e mídia por `blob:` com revogação.
- **Estados:** `ready` introduzido como "etapa concluída, aguardando continuidade";
  `completed` continua reservado ao relatório final validado.

Verificações:
- `npm run check` limpo; `npm run build` completa.
- `npm test`: **176/176** (10 novos testes em `test/navigation.test.ts` cobrindo
  CA-01 a CA-10: aprovações ausentes, concorrência, referências inventadas,
  correções/pareceres, credencial inválida com correção, cancelamento, evidência
  entre contas e transições).
- `scripts/smoke-mapping.mjs` na imagem final: navegador, cursor, capturas e
  destinos bloqueados reais, com respostas de modelo substituídas e identificadas
  como simulação.
- `scripts/smoke-web.mjs`: jornada do site até a consulta do mapa e das capturas.

Critérios de aceitação: CA-01 a CA-12 do card, com destaque para o mapa aprovado
terminando em `ready / mapping` sem nenhum teste apresentado como executado, e a
correção de credencial da mesma aplicação com nova tentativa explícita.

Evidências em [evidencias/t8.2](evidencias/t8.2/README.md). Contratos em
[CONTRATOS.md](requisitos/CONTRATOS.md#mapeamento-visual-validado--t82) e operação em
[OPERACAO.md](OPERACAO.md#mapear-e-validar-a-navegação-t82).

**T8 e T10 permanecem abertas:** detalhamento dos percursos, execução com entradas
válidas/inválidas, vídeos por tentativa, retomada completa das dúvidas visuais e
relatório ainda precisam ser entregues.

### T8.2-R1 · Corrigir e validar o fluxo até o mapa de navegação

Card de correção de bugs e revisão de integração, bloqueando o merge do PR #29.
Branch aproveitada: `feat/validated-navigation-map` (SHA revisado `14ca870`, sem
commits posteriores em `origin`; candidato corrigido registrado em
[ensaio-real.md](evidencias/t8.2/ensaio-real.md)).

Correções (defeito → reprodução → correção → teste de regressão em
[revisao-pr29.md](evidencias/t8.2/revisao-pr29.md)):

- **Build/smoke:** `COPY agents ./agents` antes da compilação (TS2307);
  `smoke-mapping.mjs` registra conta pela API e envia `Cookie` +
  `X-Expected-User-Id` em todas as chamadas (recusas sem sessão preservadas),
  associa a transição de login ao clique em **Entrar** e percorre até
  **Reservas → Nova reserva** sem confirmar; `smoke-web.mjs` tinha a jornada T8.2
  em escopo inexistente (nunca executável) — bloco movido para depois da
  preparação, snapshot devolvido e evidência estrangeira conferida com sessão
  própria (404).
- **Navegador:** aba principal antes do bloqueio de popups; limpeza em falha de
  inicialização; imagem e cursor na mesma geometria real do display (x11grab +
  `getdisplaygeometry`, sem deslocamento fixo); `fill_credential` exige foco em
  campo compatível (`FOCUS_MISMATCH` sem digitar); captura bloqueada quando a
  verificação de privacidade falha ou a credencial está visível (nada salvo nem
  enviado); capturas não consomem ações e a observação final segura permanece.
- **Orçamento/cancelamento/chamadas:** período encerrado não é somado duas vezes
  (compatibilidade legada; espera humana fora da soma); cancelamento atravessa
  navegador e ferramentas e a reserva só é liberada após a limpeza; início e
  término de cada inferência persistidos em `PreparationCall` (histórico
  preservado em erro, timeout, cancelamento e saída inválida); falhas técnicas
  e de navegador conservam a causa, sem virar esgotamento de revisões.
- **Validador:** executor e validador recebem curadoria, plano e casos vigentes;
  manifesto ordenado das imagens (`imageIndex`/`observationId`/`assetId`/dimensões)
  na ordem dos anexos, com as ações das transições; ações com erro não sustentam
  transições; evidências anteriores à correção do acesso não comprovam a nova
  autenticação (`mappingPreparationId`); `not_authenticated` + `approved` é
  validação inválida (`CONTRADICTORY_APPROVAL`) dentro das tentativas; o caminho
  de credencial recusada (`blocked`/`AUTHENTICATION_MISSING` → `awaiting_input` →
  correção → nova tentativa) permanece.

Verificações: `npm run check` limpo; `npm test` **196/196** (regressões de
orçamento, cancelamento, falha de inferência, validação, recarga, reinício,
isolamento e tolerância de formato do modelo; novo `test/pi-visual.test.ts`);
imagem final construída do código versionado com os quatro smokes `passed` na
imagem (`smoke-mapping` com 18 verificações de integração real). Ensaio com LLM
real concluído em [ensaio-real.md](evidencias/t8.2/ensaio-real.md): duas
jornadas completas em `ready / mapping` (uma pela interface, com o plano e os
casos revisados por um avaliador independente via arquivos de decisão; outra
com aprovações automatizadas, registradas como tal), credencial inválida
bloqueada por `AUTHENTICATION_MISSING` e corrigida pelo fluxo suportado
(histórico e tempo acumulado preservados) e controles positivo/negativo do
validador com a inconsistência localizada. O ensaio encontrou e motivou uma
correção real (JSON do executor em cercas de código); o cenário afetado e uma
execução completa foram repetidos no candidato corrigido.

**Pendências verdadeiras:** detalhamento dos percursos (`route_detail`), execução
dos testes com entradas válidas/inválidas, vídeos por tentativa, retomada
completa por esclarecimentos de navegação e relatório final validado. Revisão
independente de outro integrante antes do merge em `develop`.

## Como encerrar uma tarefa

O PR referencia requisitos e mostra o critério funcionando na integração. Anexar
apenas dados sintéticos ou evidências com acesso adequado. Alterar contrato e exemplo
junto do código quando necessário. Escolhas de modelo usam os mesmos exemplos,
com revisão humana de qualidade, duração e custo disponível; o validador não julga
recursivamente a si mesmo. O estado real de cada trabalho fica na issue correspondente.
