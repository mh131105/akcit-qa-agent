# T4.1 — Preparação com somente US e critérios de aceite

Registro histórico anterior à revisão das skills e ao fluxo de esclarecimentos.
A alteração posterior no mesmo PR está em [ajuste de entradas](../ajuste-entradas/README.md).

**Nova inferência real concluída em 24/09/2026; avaliação humana e revisão/merge pendentes.**
Esta avaliação substitui as amostras anteriores, cujo material incluía notas sobre
a demonstração e um percurso sugerido. Os JSON, a revisão e a captura anteriores
foram removidos/substituídos nesta branch; não são evidência deste resultado.
O histórico Git permanece preservado. As verificações automatizadas sem modelo
não dependiam desses trechos e são identificadas separadamente.

## Entrada e isolamento

- Entrada integral: [artefato-demo.md](../../requisitos/exemplos/artefato-demo.md),
  somente **US-01, CA-01 e CA-02**. A fixture de testes foi sincronizada.
- Objetivo vazio; nenhum percurso, comentário sobre simulação, resultado esperado
  da avaliação ou plano anterior fornecido como artefato.
- SHA-256 da entrada: `309893107995392957fee7f37c0eff1040d3f9434f6cc6dd3c9b39e0d5605998`.
- Material fictício: esta identificação pertence ao relatório, fora da entrada.
- Nova conta/execução em armazenamento local isolado; novas sessões Pi por tarefa.
  As skills metodológicas existentes foram mantidas integralmente.
- Código/skills: `b7b01023dcea5af99769eb9d498d7b6b8964dc46`, com a alteração documental
  de entrada acima. Nenhum código de produção ou skill alterado nesta correção.
- Pi **0.87.0**, Node.js **24.19.0**, três papéis com `openai-codex/gpt-6-astra`.
  OAuth existente configurado privadamente; nenhum segredo publicado.

## Percurso exercitado e resultado

Cadastro/login → criação do rascunho pela API HTTP real → `/start` **202** →
curador → validador → planejador → validador → correção do plano → validador.
`createApp` usou o runtime real, sem `modelCall` ou `modelPreflight` substituídos.
O acompanhamento final foi feito no armazenamento persistido. A automação de
coleta corrigiu a leitura do envelope HTTP após o início; o coordenador continuou
a mesma execução, sem repetir `/start`, inferência ou substituir respostas.
Esta repetição foi pela API; não há nova captura nem alegação de jornada pela UI.

| Campo | Resultado |
| --- | --- |
| Execução | `run-d72dfb41ac3881c9a64ab2329001219d26f9b72c5042be15b94ce244eed64b6a` |
| Intervalo UTC | `2026-09-24T16:02:26.198Z` → `2026-09-24T16:03:42.938Z` |
| Duração ativa | **76,740 s** |
| Chamadas / tokens | **6 / 13.632** |
| Curadoria | `0857784e-cdcb-4d23-947f-0f0659f4800a`, r1, aprovada |
| Plano vigente | `9a1e0a99-8138-4a40-bfc8-bb79cd93670e`, r2, aprovado pelo validador |
| Estado | `awaiting_approval/planning` |
| Perguntas / aprovação humana | Nenhuma pergunta / **pendente**, zero decisões |

[Saídas, fontes, revisões e consumo](preparacao-real.json) ·
[Plano legível para revisão humana](plano-para-revisao.md).
A projeção contém somente dados sintéticos e metadados técnicos; não contém
contas, cookies, credenciais, histórico de conversas ou raciocínio interno.
Custo em moeda indisponível: preço por token do catálogo não representa a assinatura.

| Papel | Saída | Duração | Tokens |
| --- | --- | --- | --- |
| artifact-curator | curation r1 | 15638 ms | 1588 |
| output-validator | curation r1 | 4075 ms | 1719 |
| test-designer | planning r1 | 23205 ms | 2133 |
| output-validator | planning r1 | 7721 ms | 2562 |
| test-designer | planning r2 | 21636 ms | 2924 |
| output-validator | planning r2 | 4329 ms | 2706 |

## Qualidade e limites observados

A curadoria preservou o inteiro de **1 a 10 inclusive**, as mensagens
“Reserva criada” e “Quantidade inválida”, rejeição sem criar reserva e comentário
**opcional**, salvo quando informado. Fontes atuais: **L3, L7-L10 e L14**.
O plano cobre CA-01/CA-02, mantém AVL/PCE sustentadas pelas regras e não apresenta
nomes de telas ou percurso descoberto. A antiga Q-01 não foi gerada.

O plano r1 recebeu `changes_requested` por não explicitar cada validação e aprovação
na sequência metodológica. Ele já previa aprovar plano/casos antes de definir o
percurso: permanece uma limitação de conservadorismo do validador. O plano r2
explicita a sequência e foi aprovado. A expressão condicional “qualquer percurso
sugerido” é compatível com a orientação metodológica existente; não identifica um percurso
recebido ou observado nesta entrada. As duas revisões e pareceres estão preservados.
A comparação feita por agente não substitui a revisão humana da frente C.

## Ensaios independentes com erros conhecidos

Repetidos sobre a **nova curadoria e os novos originais**. Alterações deliberadas
foram aceitas pelo parser estrutural e enviadas a sessões independentes do validador.
Nomes dos ensaios e gabarito ficaram fora do prompt. A execução principal não foi alterada.

| Alteração | Parecer real | Duração | Tokens |
| --- | --- | --- | --- |
| Limite superior 10 → 11 | `changes_requested` | 5123 ms | 1758 |
| Comentário opcional → obrigatório | `changes_requested` | 5691 ms | 1753 |

[Requests exatas, pareceres e consumo](validador-erros-conhecidos.json).
Dois resultados corretos nesta amostra não estabelecem precisão geral.

## Verificação e pendências

Nesta correção: **check aprovado, 87/87 testes aprovados e build aprovado** em
Node.js 24.19.0. [Verificações automatizadas](verificacao-automatizada.md).
Não houve alteração de infraestrutura nem repetição dos smokes locais; o registro
anterior identifica explicitamente a versão na qual eles foram executados.

Faltam avaliação humana da frente C, decisão pelo site, revisão de integração e
merge do [PR #22](https://github.com/mh131105/akcit-qa-agent/pull/22).
T4 #7, T5 #8, T6 #9 e T10 #14 continuam abertas. Casos, mapeamento, execução,
vídeos, relatório, upload e `/answer` não fazem parte desta demonstração.
