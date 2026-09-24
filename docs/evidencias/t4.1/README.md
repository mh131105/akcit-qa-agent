# T4.1 — Preparação e validação do plano

**Implementação e demonstração real executadas; decisão humana e revisão/merge do PR pendentes.**
Em 24/09/2026, o Pi produziu curadoria e plano pelo provedor OpenAI Codex com
OAuth de assinatura. O site recebeu o artefato, iniciou o processamento e chegou
a `awaiting_approval/planning`. A avaliação técnica dos agentes não substitui a
avaliação humana da frente C nem fabrica a decisão no produto.

## Identificação e reprodução

| Campo | Registro |
| --- | --- |
| Branch / PR | `feat/prepare-validated-plan` · [PR #22](https://github.com/mh131105/akcit-qa-agent/pull/22), base `develop` |
| Base | `04f8b0176d8aa458f4eee75d95fc1a49e9270a21`, merge do PR #21 |
| Código final avaliado | `069a5e716a581295e17b257b5de52a2cb932cbae` |
| Pi | `@earendil-works/pi-coding-agent` **0.87.0**, lockfile preservado |
| Papéis / modelo | Curador, planejador e validador: **`openai-codex/gpt-6-astra`**, sessões novas e independentes |
| Entrada | [artefato-demo.md](../../requisitos/exemplos/artefato-demo.md), sintético `demo-v1`, texto integral; objetivo opcional vazio |
| Ambiente real | Local, Node.js 24.21.0, site em `127.0.0.1:3170`; Chromium com interface, operado pelo Playwright |
| Credencial | OAuth autorizado pelo responsável no navegador; arquivo privado explícito via `PI_AUTH_PATH`, fora do Git |
| Execução final | `run-c5ee0c28e6e1d6b56406f924f6b40cb9c38bbaeac6a73931be26a4fbbf77620f` |
| Processamento | `2026-09-24T05:58:09.828Z` → `05:59:51.281Z`, **101.453 ms**, seis chamadas |

A configuração local resolveu a dependência de credencial registrada em
[T0 #3](https://github.com/mh131105/akcit-qa-agent/issues/3); ela não configura
credenciais em dev/prod. O [roteiro operacional](../../OPERACAO.md#demonstração-com-modelo-real-pelo-site)
inclui login, execução e avaliação. Não houve fallback ou inferência extra para
escolher a etapa seguinte. Nenhuma URL/credencial do alvo foi exigida.

## Resultados reais e histórico

O percurso observado foi **salvar rascunho → preparar plano → curadoria → validação
da curadoria → plano r1 → pedido de alteração → plano r2 → validação aprovada**.
Durante o processamento o site mostrou a fase, papel ativo e opção de cancelar;
ao aguardar aprovação, apresentou o plano e os controles humanos existentes.
[Captura do site com dados sintéticos](plano-no-site.png).

| Saída / parecer | Resultado |
| --- | --- |
| Curadoria `074ab12d-01aa-4ad0-ba59-abbbf7b86c06`, r1 | US-01, CA-01 e CA-02 preservados; Q-01 não bloqueante |
| Validação da curadoria `1c433b6e-51c2-42a9-94be-d04b91f45e4a` | `approved`, sem achados |
| Plano `81c3337b-1196-4471-a487-7220a72378d0`, r1 | Cobertura de CA-01/CA-02, fontes e condições corretas |
| Validação do plano r1 `8213f244-4f0f-4a8a-a9fe-0a8676b507f3` | `changes_requested`; pediu detalhar a sequência metodológica em `preconditions[2]` |
| Mesmo plano, r2 | Preserva r1 e explicita as duas validações/aprovações antes do mapeamento |
| Validação do plano r2 `ec8d4bfc-a49b-42a8-bce5-c51a6fba1ceb` | `approved`, sem achados |
| Dependência do plano | Exatamente curadoria `074ab12d-01aa-4ad0-ba59-abbbf7b86c06`, r1 |
| Decisão humana | Pendente; nenhum registro de aprovação fabricado |

[Revisão técnica independente, por agente](revisao-tecnica.md) ·
[Plano legível para revisão](plano-para-revisao.md) ·
[Projeção sintética com todas as revisões, pareceres e chamadas](preparacao-real.json).
A projeção publicada seleciona campos; não contém conta, sessão, credencial,
configuração privada ou raciocínio interno.

| Chamada | Revisão / tentativa | Duração | Entrada | Saída | Tokens totais |
| --- | --- | ---: | ---: | ---: | ---: |
| Curador | r1 / 1 | 21.281 ms | 1.275 | 618 | 1.893 |
| Validador da curadoria | r1 / 1 | 3.965 ms | 1.928 | 62 | 1.990 |
| Planejador | r1 / 1 | 31.135 ms | 1.725 | 934 | 2.659 |
| Validador do plano | r1 / 1 | 8.149 ms | 2.866 | 182 | 3.048 |
| Planejador | r2 / 2 | 32.335 ms | 2.796 | 963 | 3.759 |
| Validador do plano | r2 / 1 | 4.450 ms | 3.123 | 84 | 3.207 |
| Total | seis chamadas | 101.315 ms nas chamadas | 13.713 | 2.843 | **16.556** |

A duração total inclui persistência e coordenação. Contadores de cache informados
pelo Pi foram zero. **Custo por token não foi registrado:** tarifas de API do
catálogo não representam a cobrança da assinatura. Isso não significa custo
zero nem informa saldo/quota. O teste de conectividade anterior consumiu 1.178
tokens em 5.888 ms e não integra os totais da execução.

## Revisão metodológica e limitações observadas

A revisão técnica independente conferiu inteiro de **1 a 10 inclusive**, mensagens
“Reserva criada” e “Quantidade inválida”, ausência de reserva inválida, comentário
**opcional** e persistência quando informado. As fontes literais correspondem a
L8, L12–L15, L19 e L23–L25. O plano cobre os dois critérios, prioriza, justifica
exclusões, apresenta abordagem e pré-condições, sem detalhar casos ou alegar
navegação observada. Q-01 registra futura observação do percurso e não bloqueia
planejamento; não exige resposta para avançar neste recorte.

A primeira execução real, no código `818ffdd`, encontrou **dois falsos positivos**:
o validador solicitou remover a aprovação de plano/casos antes do mapeamento por
não constar do artefato do usuário. Essa é uma regra do produto (RN-04), não do
alvo. O histórico foi preservado em [diagnostico-real.json](diagnostico-real.json)
(curadoria r1 e plano r1/r2/r3; oito chamadas; nenhuma decisão humana).
O commit `069a5e7` esclareceu essa distinção na skill do validador, sem mudar o
coordenador nem converter pareceres antigos em aprovações.

Na execução final, o pedido de alteração de r1 para r2 foi **excessivamente
conservador**: r1 já respeitava as duas aprovações, mas o validador exigiu listar
cada etapa metodológica. A revisão adicional foi limitada, rastreada e produziu
plano correto. Não se declara precisão perfeita do validador. A avaliação humana
continua necessária.

## Ensaios reais com erros conhecidos

Dois payloads derivados da curadoria sintética foram aceitos estruturalmente e
enviados ao validador em sessões novas. Somente originais e saída sob análise
entraram no prompt; mudança deliberada, hipótese, gabarito e resultado esperado
ficaram fora do contexto. A execução original não foi modificada.

| Erro deliberado | Parecer real final | Localização | Duração | Tokens entrada + saída |
| --- | --- | --- | ---: | ---: |
| Limite superior 10 → 11 | `changes_requested`, `SOURCE_MISMATCH` | `requirements[0].rules[0].statement` | 5.971 ms | 1.911 + 116 = 2.027 |
| Comentário opcional → obrigatório | `changes_requested`, `SOURCE_MISMATCH` | `requirements[0].rules[1].statement` | 5.786 ms | 1.910 + 104 = 2.014 |

Total final: **11.757 ms / 4.041 tokens**, `openai-codex/gpt-6-astra`, código
`069a5e7`; SHA-256 da skill:
`eb2634f09aa475f7b1a006208e830082baa701ffb3d4a7194baf80eb043fe860`.
[Requests exatas, pareceres e metadados](validador-erros-conhecidos.json).
Os ensaios anteriores à correção também detectaram os dois erros, em 10.289 ms /
3.776 tokens; foram repetidos com a skill final para verificar a versão entregue.
A detecção foi observada em inferência real, não em respostas programadas.

## Avaliação humana da frente C

O plano r2 e os pareceres foram apresentados ao responsável nesta conversa,
com pedido explícito de avaliação do conteúdo antes da decisão pelo site.
Em 24/09/2026, o responsável respondeu **“Outra pessoa fará a revisão”**. O plano
permanece aguardando essa pessoa; nenhuma aprovação foi registrada por automação.

| Avaliação exigida | Registro humano |
| --- | --- |
| Limites, mensagens e comentário opcional | Pendente |
| Fontes, cobertura, exclusões e pré-condições | Pendente |
| Revisões e dois pareceres independentes | Pendente |
| Ensaios com erros conhecidos e limitações do validador | Pendente |
| Nome/data e conclusão da pessoa responsável | Pendente |
| Aprovação pelo site, revisão e horário | Pendente |

## Verificação automatizada

Versão `069a5e7`, Node.js **24.21.0**, Chromium **153.0.8010.52**:

| Verificação | Resultado |
| --- | --- |
| `npm run check` | Aprovado |
| `npm test` | **87/87**; todos os 59 da base preservados |
| `npm run build` | Aprovado |
| `python3 -m unittest discover -s deploy -p 'test_*.py'` | **6/6** |
| Smoke runtime/container | Aprovado, 4.245 ms internos |
| Smoke web/container | **24 verificações**, 19.008 ms internos |

[Registro completo da verificação](verificacao-automatizada.md). Imagem local:
`sha256:4bfed495bb5cf4668b78b9d68b776c17a540bdda3c335c756ba4bb40b55d96a2`.
Ambos os smokes finais passaram na primeira execução, em container restrito,
CPU=1, memória=2 GiB, filesystem somente leitura, capabilities removidas e sem
credenciais. A versão anterior teve um timeout intermitente no cenário legado
de relogin do smoke web; duas repetições passaram, causa não determinada. Esse
registro não foi ocultado. A imagem não foi publicada/promovida para dev/prod.

As suítes substituem explicitamente a chamada de modelo. Cobrem sequência,
sessões independentes, gates de validação/aprovação, correções/histórico, limites,
JSON/parecer inválido, timeout com abort, cancelamento/resposta tardia, repetição,
reserva exclusiva, recuperação e isolamento entre contas. Não existe opção de
modelo simulado na API ou no formulário.

## Pendências e limite do recorte

Faltam a decisão humana da frente C, revisão de integração por outro desenvolvedor
e merge do PR para concluir a definição de pronto. T4 #7, T5 #8, T6 #9 e T10 #14
permanecem abertas. O fluxo termina na revisão humana do plano; aprovação não
inicia casos. `/continue`, `/answer`, casos, mapeamento, execução, vídeos,
relatório e upload pertencem aos próximos recortes. Um único processo escritor
por ambiente é necessário; não há fila distribuída.
