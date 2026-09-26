# Revisão e ensaio real do PR #30 — 26/09/2026

## Estado

A jornada pela interface atingiu `ready / route_detail` com chamadas reais. Matheus aprovou o plano, os sete casos e os percursos em três decisões explícitas na conversa. Os controles complementares positivo e negativo também passaram com chamadas reais, em sessões independentes. A avaliação técnica deste incremento está concluída; não houve merge automático.

## Código e ambiente

- Produto do PR em `83d438d75ef956d0c5dc94b56bf8f6db00acec2f`, base `develop` em `58a6311`.
- Imagem do ensaio: `akcit-qa:pr30-real`; identidade e alterações do roteiro registradas no manifesto local.
- A imagem inclui a correção de retenção de evidências posteriormente publicada em `edb9c10`.
- Os ajustes `6b0423f` e `4bc2c0b` corrigem sincronização dos smokes. Nenhum desses commits altera `src/`, `agents/` ou dependências do produto testado.
- Node 24.21.0, Chromium/Xvfb, cursor e capturas reais. Diretório exclusivo montado como armazenamento privado; a instância local existente não foi alterada.

## Revisão e correções

A revisão do domínio, coordenação, API, persistência, interface e skills não encontrou bloqueador funcional reproduzível no detalhamento. Foram conferidas preservação dos casos aprovados, quatro dependências, revisão do acesso, validação independente, idempotência, cancelamento e descarte de saídas desatualizadas.

O primeiro CI falhou por capturar o display antes da pintura do Chromium: PNG vazio de 5.650 bytes. A falha foi reproduzida localmente. O autor corrigiu a espera de pintura e posteriormente a espera do bloqueio efetivo de popup. Os critérios das asserções foram preservados.

O roteiro do ensaio também removia os dados privados em qualquer encerramento e tentava capturar a página fora de seu escopo. `edb9c10` corrige a captura da falha, exporta registros sanitizados e conserva o diretório privado quando o ensaio não termina com sucesso. O teste de retenção e limpeza passou.

## Jornada observada

Entrada única, sem percurso sugerido nem gabarito no contexto dos agentes:

> US-01: Criar reservas.
> CA-01: A quantidade de reserva aceita está entre 1 e 10.

1. Curadoria e plano produzidos e validados; plano aprovado por Matheus.
2. Sete casos produzidos, validados e aprovados por Matheus: aceitar 1, 10 e 5; rejeitar 0, 11, -3 e 20.
3. Navegação real observou Login, Início, Reservas e Nova reserva. Foram registradas cinco capturas e oito ações. Nenhuma reserva foi criada durante o mapeamento.
4. Mapa aprovado pelo validador visual. O percurso observado `percurso-criar-reserva` é Início → Reservas → Nova reserva, após autenticação.
5. Os sete casos foram associados a esse percurso. O validador textual aprovou e a interface manteve `ready / route_detail` após recarga. Comparações do ensaio confirmaram preservação das saídas anteriores e aprovações.
6. Matheus revisou os percursos e aprovou os controles separados descritos abaixo.

Perfis efetivamente registrados: curador `deepseek-flash / low`; projetista e validador textual `deepseek-v4-pro / high`; executor e validador visual `deepseek-flash / high`. O validador do plano emitiu uma resposta fora do contrato; a segunda tentativa técnica prevista concluiu corretamente. Não houve aprovação automática da resposta inválida.

A jornada registrou 24 chamadas com consumo informado, 166.643 tokens acumulados e aproximadamente US$ 0,080488 de custo estimado pelo catálogo; não é uma fatura do provedor. Tempo ativo acumulado: 148.951 ms, sem a espera humana.

## Controles do validador

O mapa real tem somente um percurso completo, adequado a todos os casos. O roteiro original exigia uma alternativa inadequada já registrada em `map.paths`, portanto parou nesse requisito do experimento. A jornada, seus artefatos e a falha do roteiro foram preservados; esse encerramento não foi reclassificado como sucesso.

Para completar a avaliação, Matheus autorizou uma cópia isolada do mapa contendo o prefixo observado Início → Reservas. As telas, ações e a transição já constam nas evidências reais; a inclusão desse prefixo em `paths` é uma construção do experimento, não uma saída adicional do agente.

O controle positivo conserva todos os casos no caminho completo. O negativo altera somente `CT-CA01-001` para o prefixo que termina na listagem, sem alcançar o campo Quantidade. Ambos usam o mesmo mapa de teste. A justificativa externa e o resultado esperado do experimento não entram no contexto do modelo. O registro original permanece intacto.

Resultados reais, ambos com `deepseek-v4-pro / high`:

| Controle | Parecer | Resultado |
| --- | --- | --- |
| Positivo, caminho completo | `approved`, sem achados | Passou; 18.218 ms, 11.132 tokens |
| Negativo, prefixo até Reservas | `changes_requested`, `INSUFFICIENT_PATH` em `testCases[0].pathId` | Passou; 20.958 ms, 11.394 tokens |

O parecer negativo explica que o caminho termina na listagem e não alcança Nova reserva, necessária para informar a quantidade. Uma comparação estrutural dos prompts confirmou uma única diferença: `output.payload.testCases[0].pathId`. O caso escolhido já tinha caminho associado; o roteiro exige essa condição para não alterar simultaneamente pendências.

O modo `--route-controls-from` encerrou com código zero e `failures: []`. A avaliação combina a jornada real e os controles complementares; preserva o relatório original que encerrou com código 1 por exigir uma alternativa ausente do mapa. Não foi preciso repetir curadoria, plano, casos, mapeamento ou aprovações humanas.

Os controles somaram 22.526 tokens e aproximadamente US$ 0,033867 de custo estimado. Jornada e controles totalizaram 26 chamadas com consumo, 189.169 tokens e cerca de US$ 0,114355, segundo os metadados do catálogo.

## Verificações finais

- `npm run check`, `npm test` e `npm run build`: aprovados; 229 testes, zero falhas e zero ignorados.
- Seis testes Python de deploy: aprovados.
- Quatro smokes locais da imagem: aprovados. Smokes usam modelos substituídos; a jornada e os controles acima usam o provedor real.
- CI de `4bc2c0b`: [aprovado](https://github.com/mh131105/akcit-qa-agent/actions/runs/36260383016). Os checks do PR registram o resultado da atualização final deste roteiro e documento.
- O produto continua com as mesmas fontes e skills de `83d438d`; mudanças desta revisão limitam-se aos roteiros de teste e documentação.

## Limites

Este ensaio verifica uma aplicação controlada e uma regra de quantidade; não mede uma taxa geral de eficácia do validador. O detalhamento não executa os sete casos, não verifica os resultados esperados no alvo e não gera o relatório final. Essas etapas continuam pendentes. Capturas serão as evidências do relatório do protótipo; vídeos permanecem evolução futura.

Decisões humanas, JSONs completos, capturas e logs permanecem na pasta local `artifacts/pr30-review/`, fora do Git. Não publicar o diretório `private/`. O roteiro preserva o relatório original e registra os controles complementares separadamente.
