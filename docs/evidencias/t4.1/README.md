# T4.1 — Preparação e validação do plano

**Situação: implementação em revisão; evidência real e avaliação humana pendentes.**
Este registro distingue testes com respostas programadas de inferência real. Nenhuma
chamada paga foi realizada nesta implementação. A entrega não está completa por
passar em testes automatizados.

## Identificação

| Campo | Registro |
| --- | --- |
| Branch | `feat/prepare-validated-plan` |
| Base | `04f8b0176d8aa458f4eee75d95fc1a49e9270a21`, merge do PR #21 em `develop` |
| Commit de código avaliado | `be5aad2ec4e4d938102e69ee802bd8f073838084`; documentação registrada em commit posterior |
| PR para `develop` | Rascunho a abrir; referencia T4 #7, T5 #8, T6 #9 e T10 #14 sem encerramento automático |
| Pi | `@earendil-works/pi-coding-agent` 0.87.0, preservado no lockfile |
| Entrada da demonstração real | [artefato-demo.md](../../requisitos/exemplos/artefato-demo.md), sintético, versão `demo-v1` |
| Responsável pela integração | Frente B; revisão por outro desenvolvedor pendente |
| Revisão humana da metodologia | Frente C, nome/data e decisão pendentes |

## Verificação automatizada

| Verificação | Resultado final |
| --- | --- |
| `npm run check` / Node.js 24.21.0 | Aprovado |
| `npm test`, preservando os 59 testes da base | **84/84 aprovados**; +6 runtime, +3 domínio, +15 fluxo, +1 proteção HTTP |
| `npm run build` | Aprovado |
| Smoke de runtime/container | Aprovado; **4.111 ms**; sessão Pi sem inferência, PDF, Chromium com tela, mouse, captura e vídeo |
| Smoke web/container | **24 verificações aprovadas**, **19.789 ms**; Node.js 24.21.0, Chromium 153.0.8010.52 |
| Smoke web local/Chrome | Aprovado; **14,45 s**, sem inferência paga |
| `python3 -m unittest discover -s deploy -p 'test_*.py'` | **6/6 aprovados** |

Imagem local de verificação: digest de configuração
`sha256:e8ca17df26fae88662e5d6dd86d65eb2382ad63e76379f7adf3f416ba173206e`.
Os dois smokes do container usaram `--cpus=1`, `--memory=2g`, filesystem somente
leitura, `--cap-drop=ALL`, `no-new-privileges` e tmpfs para `/tmp`, `/home/node` e
`/data`. Este digest identifica a imagem local testada; não é comprovação de
publicação em dev/prod. Resultados sintéticos locais da sessão ficaram em
`/tmp/akcit-t41-container/runtime/runtime-result.json` e
`/tmp/akcit-t41-container/web/web-result.json`; o procedimento para reproduzir e
guardar capturas está em [OPERACAO.md](../../OPERACAO.md#reproduzir-a-jornada-com-dados-fictícios).

As suítes de preparação exercitam sequência, dependências/revisões exatas,
proibição de avanço e decisão prematuros, correção com histórico, perguntas
localizadas, limites, cancelamento/resposta tardia, repetição, concorrência,
recuperação e isolamento entre contas. O runtime confere sessões independentes,
skills explícitas e permissões desabilitadas, substituindo explicitamente a
inferência nos testes. O smoke web monta servidor e armazenamento temporários,
substitui a chamada de modelo internamente e usa a UI real. Não existe seletor
de modelo simulado na API ou formulário.

O teste de domínio aceita duas adulterações com estrutura/fontes ainda válidas
(limite superior alterado e comentário tornado obrigatório). Isso demonstra que
a checagem estrutural não equivale a julgamento semântico. Os testes programados
de correção não demonstram que um modelo detecta esses erros.

## Demonstração real — dependência T0

A credencial real não estava disponível no ambiente desta implementação. Registrar
em **T0 #3** a provisão de credencial privada, os pares provedor/modelo escolhidos
e o orçamento autorizado. Não copiar credenciais de outros projetos. A frente B
executa o [roteiro pelo site](../../OPERACAO.md#demonstração-com-modelo-real-pelo-site)
após a configuração; a frente C avalia os resultados efetivos.

| Evidência requerida | Registro real |
| --- | --- |
| Ambiente, commit/imagem e ID da execução sintética | Pendente |
| Curador: provedor/modelo, revisões e IDs | Pendente |
| Parecer(es) da curadoria: revisão exata, status, motivo e achados | Pendente |
| Planejador: provedor/modelo e dependência da curadoria aprovada | Pendente |
| Plano: ID e revisões | Pendente |
| Validador: provedor/modelo e parecer(es) do plano exato | Pendente |
| Aprovação pelo site: revisão, pessoa responsável e horário | Pendente |
| Duração total e duração/tentativas por chamada | Pendente, sem valores estimados inventados |
| Tokens/consumo disponível | Pendente; métricas ausentes devem permanecer ausentes |
| Custo do Pi | Pendente; se disponível, identificar como **estimativa** |

## Avaliação humana da frente C

Preencher somente depois de comparar o material original com as revisões e
pareceres reais. O revisor técnico automatizado não substitui esta avaliação.

| Ponto do artefato sintético | Avaliação humana |
| --- | --- |
| Quantidade inteira, limites 1 e 10 inclusivos, sem alteração de unidade/condição | Pendente |
| “Reserva criada” para válida; “Quantidade inválida” e nenhuma reserva para inválida | Pendente |
| Comentário continua opcional e é salvo quando informado | Pendente |
| Requisito/critérios mantêm identificação e citações literais localizadas | Pendente |
| Plano cobre CA-01/CA-02, prioridades, exclusões, abordagem e pré-condições | Pendente |
| Não há casos detalhados nem navegação alegada como observada | Pendente |
| Duas validações independentes antecedem a aprovação humana da revisão vigente | Pendente |
| Nome, data, observações e conclusão da pessoa da frente C | Pendente |

## Ensaio real do validador com erro conhecido

**Pendente por credencial.** Seguir o [procedimento operacional](../../OPERACAO.md#avaliação-real-do-validador-com-erro-conhecido)
para enviar, em sessão nova, originais e uma cópia de curadoria com limite superior
alterado ou comentário obrigatório, preservando fontes e IDs. Não modificar a
execução aprovada. Não incluir este gabarito, hipótese, resultado esperado ou notas
da pessoa avaliadora no contexto do agente.

Registrar commit, modelo, ID/revisão da saída avaliada, única mudança deliberada,
parecer bruto estruturado, achados localizados, duração/consumo e avaliação humana
posterior. O resultado esperado é detectar e localizar a adulteração; se o agente
aprovar, registrar a falsa aprovação e revisar a metodologia. Não substituir o
resultado real por resposta programada nem declarar sucesso antes do ensaio.

## Limitações da entrega

O fluxo termina na revisão humana do plano. Aprovação mantém a espera e não cria
casos. Resposta/retomada de perguntas, `/continue`, mapeamento, navegador, execução,
vídeos, relatório e upload estão fora deste recorte. Operação pressupõe um único
processo escritor por ambiente; não há fila distribuída. Demonstração real,
avaliação humana, revisão do PR e integração em `develop` continuam necessárias.
Somente dados sintéticos podem ser anexados publicamente; sessões, chaves e
evidências privadas permanecem fora do versionamento.
