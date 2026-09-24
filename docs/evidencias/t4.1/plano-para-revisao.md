# Plano para avaliação humana — somente US e CA

Execução `run-d72dfb41ac3881c9a64ab2329001219d26f9b72c5042be15b94ce244eed64b6a`; plano `9a1e0a99-8138-4a40-bfc8-bb79cd93670e`, revisão 2.

Gerado por inferência real com `openai-codex/gpt-6-astra`. Documento de avaliação; as observações deste cabeçalho não foram enviadas como requisitos. Aprovação humana pendente.

## Objetivo

Validar a reserva de itens por usuário autenticado, verificando as regras de quantidade, as mensagens de confirmação e rejeição e a preservação do comentário opcional.

## Cobertura e prioridades

- CA-01: Alta: controla a validade da quantidade e impede a criação de reservas inválidas, protegendo o fluxo principal.
- CA-02: Média: garante que o comentário não seja obrigatório e que, quando informado, seja preservado junto à reserva.

## Abordagem

- Aplicar testes caixa preta para CA-01, particionando quantidades em inteiros de 1 a 10 inclusive, valores abaixo e acima do intervalo e valores não inteiros. Analisar os limites 1 e 10 e seus inteiros imediatamente externos, sem detalhar casos nesta etapa.
- Para CA-01, verificar a criação da reserva e a mensagem “Reserva criada” ao confirmar quantidade válida; para quantidade fora do intervalo ou não inteira, verificar a mensagem “Quantidade inválida” e a ausência de criação da reserva.
- Para CA-02, cobrir comentário ausente e informado em reservas com quantidade válida, verificando respectivamente a possibilidade de reservar sem comentário e o salvamento do comentário junto à reserva. Não presumir limites de tamanho ou restrições de conteúdo não especificados.
- Seguir esta sequência: validar o plano e submetê-lo à aprovação humana; depois criar os casos, validá-los e submetê-los à aprovação humana; somente após essas aprovações observar e mapear a navegação e definir os meios observáveis de conferir a reserva e o comentário, antes da execução. Não presumir telas, cliques ou navegação já observados; qualquer percurso sugerido será apenas referência a verificar nessa etapa.

## Pré-condições

- Usuário autenticado, conforme US-01.
- Antes do mapeamento e da execução, disponibilizar acesso ao ambiente e itens para reserva; acesso não é necessário para elaborar este plano.

## Exclusões e perguntas

Nenhuma exclusão ou pergunta na saída desta execução.

## Fontes originais

**L3**

> Como usuário autenticado, quero reservar itens para informar a quantidade desejada.

**L7-L10**

> A quantidade deve ser um número inteiro entre 1 e 10, inclusive. Ao confirmar uma
> quantidade válida, o sistema deve mostrar “Reserva criada”. Para quantidades fora
> desse intervalo ou não inteiras, o sistema deve mostrar “Quantidade inválida” e não
> criar a reserva.

**L14**

> O comentário é opcional. Quando informado, deve ser salvo junto à reserva.

## Pareceres

- `0857784e-cdcb-4d23-947f-0f0659f4800a`, r1: **approved** — A curadoria reproduz integralmente os originais, com fontes e localizações corretas, associação dos critérios à US-01, limites inclusivos, mensagens esperadas, proibição de reserva inválida e opcionalidade do comentário preservados.
- `9a1e0a99-8138-4a40-bfc8-bb79cd93670e`, r1: **changes_requested** — O plano preserva os critérios e suas fontes, mas precisa explicitar a sequência obrigatória de validação, aprovação humana e observação prevista na metodologia.
- `9a1e0a99-8138-4a40-bfc8-bb79cd93670e`, r2: **approved** — O plano cobre CA-01 e CA-02 fielmente, preservando limites inclusivos, mensagens, rejeição sem criação e comentário opcional. As fontes são pertinentes, e a revisão explicita a sequência metodológica obrigatória sem inventar navegação ou detalhar casos.

## Decisão humana

Pendente. Nenhuma aprovação foi registrada automaticamente.
