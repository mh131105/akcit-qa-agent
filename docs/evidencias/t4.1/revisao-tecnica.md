# T4.1 — revisão técnica independente da demonstração real

Revisão automatizada por agente em contexto separado do coordenador e dos
especialistas produtores, em 24/09/2026. **Não é assinatura humana da frente C.**
Foram examinados somente artefato sintético, saídas, pareceres, dependências e
metadados necessários; nenhuma credencial ou conta foi incluída nesta nota.
O usuário confirmou que outra pessoa fará a revisão: a entrega está preparada
para essa revisão externa, sem decisão automática de aprovação ou merge e sem
declarar concluída a definição de pronto.

## Resultado final examinado

- Código: `069a5e716a581295e17b257b5de52a2cb932cbae`.
- Execução: `run-c5ee0c28e6e1d6b56406f924f6b40cb9c38bbaeac6a73931be26a4fbbf77620f`.
- Curadoria: `074ab12d-01aa-4ad0-ba59-abbbf7b86c06`, revisão 1, aprovada.
- Plano: `81c3337b-1196-4471-a487-7220a72378d0`, revisão 2, aprovada.
- Estado examinado: `awaiting_approval/planning`; sem decisão humana persistida
  no momento desta conferência. A aprovação pelo site aguarda o revisor externo
  indicado pelo usuário; não foi registrada aprovação automática.
- Todos os papéis: `openai-codex` / `gpt-6-astra`, OAuth de assinatura.
- Seis chamadas concluídas, 101.453 ms ativos e 16.556 tokens disponíveis no Pi.
  `estimatedCost` ausente, corretamente, por se tratar de assinatura.

## Conferência do conteúdo e integridade

O artefato preservado coincide literalmente com `artefato-demo.md`. US-01 conserva
usuário autenticado e intenção de reservar itens. CA-01 conserva números inteiros,
intervalo 1 a 10 inclusivo, mensagem “Reserva criada” para quantidade válida,
“Quantidade inválida” para fora do intervalo/não inteira e ausência de criação
nessas rejeições. CA-02 mantém comentário opcional e salvamento quando informado.

O plano cobre US-01, CA-01 e CA-02, justifica prioridades, propõe partições e
limites compatíveis com o domínio, inclui comentário ausente/informado e não
inventa restrições de tamanho/conteúdo. Objetivo, exclusão, abordagem e
pré-condições estão presentes. Não há casos detalhados, passos de execução,
telas alegadas como observadas ou resultados fictícios da aplicação.

Fontes L8, L12-L15, L19 e L23-L25 correspondem aos trechos originais. A verificação
estrutural das saídas reais passou; foi também conferida igualdade literal do
artefato e a relação exata `plano r2 → curadoria r1`. Cada revisão vigente possui
um único parecer de qualidade `approved` de `output-validator`; os anteriores
permanecem no histórico. Plano r1 e r2 mantêm ID, e todas as saídas usam o mesmo
ciclo de orçamento. A sequência observada foi curador, validador, planejador,
validador pedindo correção, planejador, validador aprovando.

Q-01 é uma pendência de **observação futura da navegação**, não lacuna nas regras
da reserva. Seu vínculo com US-01 e `blocking: false` são adequados; a exclusão
do plano registra que ela não impede CA-01/CA-02. Sua resolução pertence ao
mapeamento pelo executor, sem transformar um percurso sugerido em observação ou
exigir resposta humana para planejar regras já claras.

## Revisões e limitações observadas

Na primeira execução (`run-fd21c2ddb73161b3862237a94c8447eaa6a7160aff574654baaabfd055479cbe`),
o validador emitiu dois **falsos positivos** `UNSUPPORTED_PRECONDITION`: pediu
remover aprovações antes de mapear por ausência dessa condição nos artefatos do
alvo. Essa condição é regra metodológica RN-04 do produto. Plano r3 foi aprovado;
o histórico foi preservado e não foi alterado para ocultar os achados.

A skill foi ajustada para distinguir regras do alvo, que precisam de origem nos
artefatos, de guardas do fluxo do produto. Na segunda execução, o validador deixou
de solicitar remoção dessas guardas, mas pediu sua enumeração completa em r1
(`METHODOLOGY_SEQUENCE_INCOMPLETE`). R1 já condicionava observação às aprovações
de plano/casos; trata-se de **conservadorismo excessivo**, não de falha em CA ou
cobertura. R2 explicitou toda a ordem e recebeu aprovação sem mudar as regras.

Essa revisão adicional não bloqueia o resultado final: a saída é correta, o
coordenador respeitou o parecer e o limite, não houve aprovação fabricada e as
versões são rastreáveis. Permanece a limitação de revisões desnecessárias pelo
modelo. Uma amostra não demonstra precisão geral nem ausência futura de falsos
positivos; não é necessário iniciar rodadas ilimitadas de ajuste.

## Ensaios negativos reais examinados

Fonte: `/tmp/akcit-t41-negative.json`, sobre cópias da curadoria da primeira
execução e **antes** do ajuste final da skill. Os dois payloads adulterados
passaram no parser estrutural com fontes intactas. O `request` enviado contém
originais e a revisão a avaliar; `humanControlNotSent`, nome do ensaio e resultado
esperado estão fora do pedido do modelo.

| Alteração deliberada | Parecer real | Localização | Duração / tokens |
| --- | --- | --- | --- |
| Limite superior 10 → 11 | `changes_requested / SOURCE_MISMATCH` | `requirements[0].rules[0].statement` | 5.579 ms / 1.893 |
| Comentário opcional → obrigatório | `changes_requested / SOURCE_MISMATCH` | `requirements[0].rules[1].statement` | 4.710 ms / 1.883 |

Ambos os erros foram detectados e localizados corretamente; esses registros da
skill anterior foram preservados como diagnóstico.

### Repetição com a skill final

Fonte: `/tmp/akcit-t41-negative-final.json`, commit
`069a5e716a581295e17b257b5de52a2cb932cbae`; SHA-256 da skill do validador
`eb2634f09aa475f7b1a006208e830082baa701ffb3d4a7194baf80eb043fe860`.
Conferido contra o arquivo final do projeto. Os pedidos são idênticos aos dos
ensaios anteriores: originais e saídas adulteradas, sem gabarito, nome do ensaio
ou resultado esperado. São novas chamadas reais de `openai-codex/gpt-6-astra`.

| Alteração deliberada | Parecer final | Localização | Duração / tokens |
| --- | --- | --- | --- |
| Limite superior 10 → 11 | `changes_requested / SOURCE_MISMATCH` | `requirements[0].rules[0].statement` | 5.971 ms / 2.027 |
| Comentário opcional → obrigatório | `changes_requested / SOURCE_MISMATCH` | `requirements[0].rules[1].statement` | 5.786 ms / 2.014 |

As duas respostas localizaram corretamente o erro e pediram restaurar a regra
original. Total desta repetição: 11.757 ms de chamadas e 4.041 tokens; sem estimativa
de custo por API na assinatura. Isso comprova detecção nesses dois exemplos,
não uma medida geral de precisão do validador. Os falsos positivos e a revisão
desnecessária documentados acima permanecem parte da avaliação.

Aprovação pelo site, aceite humano da frente C, revisão do PR e integração em
`develop` continuam pendentes da revisão externa. Não são inferidos desta nota.
