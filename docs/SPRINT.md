# Sprint única: entrega em 26/09 às 17h

Atualizado em 23/09/2026. Horário de Manaus. A equipe mantém quatro frentes, com
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
resposta/retomada de perguntas, casos e relatório permanecem nas tarefas
correspondentes. T4.1 acrescenta preparação e exibição de pendências; T2.1 implementa entrada textual e
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
`04f8b01`. [PR #22](https://github.com/mh131105/akcit-qa-agent/pull/22) aberto como rascunho para `develop`.
**Implementação em revisão; entrega não concluída.**

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
de modelo e não comprovam CA-12. Código `be5aad2`: check/build aprovados,
**84/84 testes** (59 anteriores preservados), seis testes operacionais e ambos os
smokes aprovados no container final. O smoke web passou em 24 verificações com
Node.js 24.21.0 e Chromium 153.0.8010.52. Resultados e limites estão em
[evidencias/t4.1](evidencias/t4.1/README.md).

**Dependência aberta em T0 #3:** o responsável ainda precisa disponibilizar
credencial real, confirmar provedor/modelos e orçamento no ambiente privado.
Nenhuma inferência paga foi executada nesta implementação. A demonstração real
com o artefato sintético, as duas validações e aprovação pelo site permanece
pendente, assim como avaliação humana da frente C de limites, comentário
opcional, fontes/cobertura e ensaio do validador com saída deliberadamente errada.
O gabarito humano fica fora do contexto do agente. Revisão de integração, PR
aprovado e merge em `develop` também são necessários para a definição de pronto.

Limite do recorte: termina na revisão humana do plano; `/continue`, criação de
casos, mapeamento, navegação, execução, vídeos, relatório, upload e `/answer`
permanecem nas tarefas correspondentes. A decisão humana não dispara casos.
Contratos em [CONTRATOS.md](requisitos/CONTRATOS.md#preparação-do-plano-com-especialistas--t41);
configuração e roteiro real em [OPERACAO.md](OPERACAO.md#modelos-e-preparação-do-plano--t41).

## Marcos propostos a partir de agora

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

## Como encerrar uma tarefa

O PR referencia requisitos e mostra o critério funcionando na integração. Anexar
apenas dados sintéticos ou evidências com acesso adequado. Alterar contrato e exemplo
junto do código quando necessário. Escolhas de modelo usam os mesmos exemplos,
com revisão humana de qualidade, duração e custo disponível; o validador não julga
recursivamente a si mesmo. O estado real de cada trabalho fica na issue correspondente.
