# T6.1 — Casos lógicos do plano aprovado

Entradas e [expectativas](expectativas.md) registradas em **24/09/2026 às
23:02:08 UTC**, antes das inferências. SHA-256 das expectativas:
`9a0cf5b2fa27982980e4b1d7bc2530bafd66574d4a60d3133c45842a2bb2cdc0`.
Materiais próprios, controlados e públicos: [prosa](entrada-prosa.txt) e
[Gherkin](entrada-gherkin.feature). Nenhum documento de usuário é usado.

Esta entrega gera, valida, persiste e consulta casos. O fluxo termina em revisão
humana do conjunto; aprovação dos casos, mapeamento, navegação, vídeos e relatório
permanecem futuros. Não encerra [T6 #9](https://github.com/mh131105/akcit-qa-agent/issues/9)
nem TELA-06. Base: PR #22 integrado em `71781a2`.

## Registro da execução

O commit testado, comandos, modelos, revisões e resultados serão preenchidos após
as verificações. `resultados.json` receberá somente saídas/pareceres sanitizados.
Esta preparação das evidências não afirma que a demonstração já passou.

Os testes automatizados usam respostas simuladas. A demonstração usa inferência
real e avaliação posterior contra as expectativas; gabarito não entra nos prompts.
Uma aprovação automatizada pela API em conta de demonstração será identificada
como ação do ensaio, sem atribuí-la a revisão humana. Revisões das frentes B/C,
CI e merge serão registrados separadamente no PR; avaliação por agente não as
substitui.
