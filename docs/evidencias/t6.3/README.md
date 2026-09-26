# T6.3 — Detalhamento validado dos percursos

Data: 26/09/2026. [PR #30 para develop](https://github.com/mh131105/akcit-qa-agent/pull/30). Branch: `feat/validated-route-detail`; base `develop` em
`58a6311` (PR #29 integrado). Escopo: associar casos aprovados ao mapa existente,
validar as associações e apresentar percursos/pendências. Execução dos testes e
relatório permanecem pendentes nas issues #9, #11 e #14.

## Base e isolamento

A árvore inicial estava limpa, incluindo `compose.yml`. O commit `1d3e87c`
mencionado no card não existe nas referências locais/remotas consultadas nem na
consulta do commit pela API do GitHub (422). Não foi incorporada uma correção
desconhecida e nenhum critério dos smokes foi removido.

O ensaio real agora usa `mkdtemp`, ignora o `DATA_DIR` da instância para os dados
do teste e só remove seu próprio diretório. O teste automatizado mantém um arquivo
sentinela em um `DATA_DIR` sintético e confirma sua preservação.

## Verificações do candidato

Os resultados abaixo distinguem implementação, testes com modelos substituídos e
ensaio com inferência real. A aprovação deste card depende também do ensaio e da
revisão humana, que não são substituídos por testes determinísticos.

| Verificação | Estado |
| --- | --- |
| Node.js | 24.21.0, distribuição oficial com checksum conferido |
| Dependências | `npm ci`, versões do `package-lock.json`, sem alteração do lockfile |
| `npm run check` | Aprovado no candidato local |
| `npm run build` | Aprovado no candidato local |
| `npm test` | Aprovado: 227 testes, zero falhas, zero ignorados (31 testes novos) |
| Smoke web local | Aprovado com navegador Chromium baseado em Brave, modelos explicitamente simulados; capturas finais abaixo |
| Smokes na imagem candidata | Consultar [checks do PR #30](https://github.com/mh131105/akcit-qa-agent/pull/30/checks): quatro smokes na imagem `akcit-qa:ci`; Docker local recusou acesso e sudo requer senha |
| `npm run eval:routes:real -- --run` | Tentativa recusada antes da inferência: `EVAL_HUMAN_DIR` não configurado |
| Inferência real / revisão humana | Pendente; não há aprovação humana, controle negativo real ou qualidade semântica comprovada nesta entrega ainda |
| Commit da implementação | `090f42f8847a9f56002c55dfbfe65a569bcb2371`; candidato com correções isoladas dos smokes em `f68455846c732e297de655df928e8c7c415d4c6e`; evidências em commit posterior, sem mudança funcional |
| Imagem | Nenhum digest foi atestado localmente; o CI constrói e testa a imagem candidata |

Os perfis exigidos são projetista e validador textual `deepseek-v4-pro` / `high`.
Os testes conferem seleção da tarefa, perfil aplicado e isolamento das sessões.
Isso não constitui chamada real ao provedor. O ensaio preserva a composição real
do aplicativo; sem substituições de modelos, navegador ou pareceres.

## Cobertura automatizada

- Fluxo `ready/mapping` → produção → validação → `ready/route_detail`.
- Casos omitidos/duplicados/desconhecidos, caminhos inexistentes, pendências sem
  motivo e alterações dos campos protegidos são recusados.
- Casos lógicos e aprovações permanecem iguais; `pathId: null` é preservado na origem.
- Elegibilidade, contexto completo, versões, acessos e esclarecimentos vigentes.
- Correções/revisões, limite de três produções e duas tentativas de validação;
  falha técnica conserva a causa, sem aprovação por padrão.
- Pendências parciais preservam percursos válidos; todos pendentes/bloqueados
  terminam em `awaiting_input`, sem oferecer retomada inexistente.
- Repetição e envio concorrente não duplicam o processamento; tempo anterior não
  é zerado e espera humana não entra na soma.
- Alteração de acesso/mapa/casos, cancelamento e reinício durante produção ou
  validação impedem publicação tardia; registros permanecem consultáveis.
- API e interface preservam isolamento entre contas, rótulos de conteúdo
  provisório, percursos por caso, pendências, parecer e estado após recarga.

Na primeira suíte, as verificações novas passaram. Os testes antigos da projeção
passaram a exigir os dois campos novos (`routeDetail`, `canDetailRoutes`); o
exemplo sintético foi alinhado ao contrato. Dois testes antigos de cancelamento
dependiam de 20/50 ms para a sessão/executor iniciar: foram substituídos por
sincronização com o início real da operação, mantendo aborto, descarte e liberação
do recurso. O teste de orçamento injetado agora cruza 60 s pelo relógio controlado;
o watchdog real, já testado separadamente, não vence durante o preparo sob carga.
Esses ajustes estão no commit separado `5049604`, sem mudanças no produto anterior.

No smoke novo, o cartão de um caso pendente deve ser aberto antes de conferir seu
conteúdo. A proteção contra HTML continua integral nos painéis textuais; as
capturas legítimas do mapa não são tratadas como injeção de conteúdo.

Uma repetição adicional expôs uma corrida no smoke antigo de resposta perdida:
o rótulo do botão de recuperação já estava visível enquanto a gravação ainda
ocorria. O commit `723f647` espera a resposta 201 da API e o botão de recuperação
habilitado antes de conferir os dois registros. Preserva o cenário de resposta
perdida, a idempotência e todas as asserções; não modifica a aplicação.

Também foi identificada uma corrida entre o progresso salvo e o início da chamada
simulada (contagem 8 antes da nona chamada). O commit `f684558` sincroniza as pausas
do modelo com a entrada efetiva na simulação, incluindo validação e cancelamento.
As contagens exatas e a verificação de ausência de duplicação foram preservadas.

### Capturas e comando local

Conteúdo e respostas de modelo sintéticos, sem documentos privados. O navegador,
a API, o coordenador e a persistência são reais. Chromium `154.0.8037.58` e Node
`24.21.0`; aprovação humana e adequação semântica não foram avaliadas nesse smoke.

```sh
CHROMIUM_PATH=/opt/brave.com/brave/brave SMOKE_ARTIFACT_DIR=artifacts/t6.3-web npm run smoke:web
```

- [Desktop, 1366 px](19-percursos-desktop.png)
- [Celular, 390 px](20-percursos-mobile.png)
- [Resultado completo do smoke](web-result.json)

## Ensaio e avaliação humana pendentes

Procedimento completo em [OPERACAO.md](../../OPERACAO.md#detalhar-percursos-dos-casos--t63).
Execute na imagem candidata com credenciais privadas, `EVAL_HUMAN_DIR`,
`EVAL_EVIDENCE_DIR`, `APP_REVISION`, `EVAL_IMAGE` e identificação do implementador.

Uma pessoa deve ler e aprovar plano/casos pelos arquivos de decisão ou registrar
a recusa. Outro integrante confere as associações e pendências contra o mapa e os
casos. Cada decisão registra `human: true`, `reviewer` e `decision`; o implementador
não preenche esses registros em nome de uma pessoa.

O controle negativo usa um caminho existente no mapa, mas inadequado para o caso,
selecionado pelo revisor com justificativa externa. A cópia passa pelo parser e
é enviada somente ao validador; não altera a execução persistida. Registrar
parecer, localização do achado, duração/consumo disponível e resultado efetivo.
Uma aprovação incorreta falha o ensaio. Sem caminho inadequado existente ou
revisão humana, registrar o cenário como incompleto.

Capturas do smoke são sintéticas quanto ao conteúdo/modelo; capturas do ensaio
real e decisões permanecem fora do Git até revisão de privacidade. Não há vídeo
exigido no protótipo pela decisão de 26/09/2026. Capturas de mapeamento não provam
execução de casos, e T6.3 não produz esse tipo de evidência.

A publicação usou a conexão GitHub do aplicativo, pois o Git local não possuía autenticação de escrita. Cada árvore remota foi comparada com a árvore local testada, incluindo as capturas; os SHAs acima identificam os commits publicados.
