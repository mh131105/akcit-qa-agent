# Plano real para avaliação humana — T4.1

Gerado com Pi 0.87.0 e openai-codex/gpt-6-astra; código 069a5e7.
Execução: run-c5ee0c28e6e1d6b56406f924f6b40cb9c38bbaeac6a73931be26a4fbbf77620f
Plano: 81c3337b-1196-4471-a487-7220a72378d0, revisão 2.

## Objetivo

Verificar que usuários autenticados possam reservar itens com quantidades inteiras de 1 a 10, que quantidades inválidas sejam rejeitadas sem criar reserva e que o comentário seja opcional e salvo quando informado.

## Cobertura e prioridades

- CA-01: Alta: controla a validade da quantidade, a criação da reserva e as mensagens de confirmação ou rejeição.
- CA-02: Média: garante a opcionalidade do comentário e a preservação da informação fornecida junto à reserva.

## Abordagem

- Aplicar testes caixa preta com base nas US/CA originais, conferidas diretamente com a curadoria aprovada, sem divergências identificadas.
- Para CA-01, particionar quantidades em inteiros no intervalo permitido, inteiros abaixo do mínimo, inteiros acima do máximo e números não inteiros. Analisar os limites inclusivos 1 e 10 e seus vizinhos inteiros externos, sem definir dados ou passos detalhados de casos.
- Para CA-01, verificar a criação da reserva e a mensagem “Reserva criada” para quantidades válidas; para quantidades fora do intervalo ou não inteiras, verificar “Quantidade inválida” e a ausência de criação da reserva.
- Para CA-02, cobrir comentário ausente e informado com quantidade válida, verificando que sua ausência não impeça a reserva e que, quando informado, seja salvo junto a ela. Não presumir limites de tamanho ou restrições de conteúdo não especificados.

## Pré-condições

- Usuário autenticado, conforme US-01.
- Disponibilizar acesso à aplicação controlada antes do mapeamento e da execução; URL e credenciais não são necessárias para planejar.
- Seguir obrigatoriamente esta ordem: validar e aprovar humanamente o plano; depois criar, validar e aprovar humanamente os casos; somente então observar e registrar a navegação real para resolver Q-01, usando o percurso sugerido apenas como referência; executar os testes somente após esse registro.
- Antes da execução, identificar meios observáveis de verificar a criação ou não criação da reserva e a persistência do comentário, sem presumir telas ou resultados.

## Exclusões e pendências

- Q-01: confirmação do percurso real permanece pendente. — O percurso é apenas sugerido, não observado. Essa pendência não bloqueia o planejamento de CA-01 e CA-02. Sua confirmação ocorrerá após a validação e aprovação humana do plano e, posteriormente, dos casos, antes da execução.

## Fontes originais

**L8**

> Como usuário autenticado, quero reservar itens para informar a quantidade desejada.

**L12-L15**

> A quantidade deve ser um número inteiro entre 1 e 10, inclusive. Ao confirmar uma
> quantidade válida, o sistema deve mostrar “Reserva criada”. Para quantidades fora
> desse intervalo ou não inteiras, o sistema deve mostrar “Quantidade inválida” e não
> criar a reserva.

**L19**

> O comentário é opcional. Quando informado, deve ser salvo junto à reserva.

**L23-L25**

> Após o login, a página inicial oferece “Reservas”. A tela de reservas oferece
> “Nova reserva”. O formulário apresenta quantidade, comentário e “Confirmar”.
> O agente ainda precisa observar e registrar esse percurso no navegador real.

## Pareceres independentes

- 074ab12d-01aa-4ad0-ba59-abbbf7b86c06, r1: **approved**. A curadoria preserva integralmente os critérios, limites inclusivos, mensagens e opcionalidade, com fontes literais e localizações corretas. A confirmação do percurso está registrada como pendência não bloqueante para o planejamento.
- 81c3337b-1196-4471-a487-7220a72378d0, r1: **changes_requested**. O plano preserva as regras, limites, mensagens e opcionalidade dos originais e trata Q-01 sem bloquear trabalho independente, mas precisa explicitar integralmente a sequência metodológica RN-04.
- 81c3337b-1196-4471-a487-7220a72378d0, r2: **approved**. O plano cobre CA-01 e CA-02 fielmente aos originais e à curadoria aprovada, preservando limites inclusivos, mensagens e opcionalidade. Explicita a pendência Q-01 sem bloquear o planejamento independente e respeita a sequência metodológica obrigatória, sem inventar navegação ou detalhar casos.

## Decisão humana

Pendente. Em 24/09/2026, o responsável informou que outra pessoa fará a revisão. A avaliação técnica dos agentes não é assinatura da frente C.
