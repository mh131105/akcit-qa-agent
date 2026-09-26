# Roteiro de validação manual — T9.1

Estado: **pendente de execução pelo responsável humano**. Nenhum item abaixo é
resultado observado ou aceite. O usuário decidiu validar manualmente. Não há
chamadas de LLM pagas executadas como parte da implementação deste card.

## Preparação

Use a imagem candidata em ambiente isolado de demonstração, com os perfis de
modelos de `OPERACAO.md`, incluindo redator Flash/low. Registre SHA, digest da
imagem, ambiente, data, operador e revisor. Configure credenciais apenas no
ambiente privado. Use `docs/requisitos/exemplos/artefato-demo.md` como entrada;
o gabarito não entra nos artefatos nem nos prompts do produto.

Aprovações e esclarecimentos da demonstração são feitos pela interface. Não
edite registros salvos, não injete resultados, não avance estados por comandos.
Preserve tentativas, respostas e capturas de ensaios malsucedidos junto da análise
que motivou a correção.

## R1 — Aplicação correta

1. Inicie o alvo no modo `reference`, com lista vazia.
2. Pela interface, crie a execução, forneça o artefato, prepare e confira o plano.
   Aprove a revisão exata; gere os casos e confira 0, 1, 10, 11, um valor interno,
   um não inteiro e comentário opcional com e sem texto. Aprove os casos.
3. Configure e confirme acesso, mapeie, detalhe e execute. Confira que rejeições
   esperadas são aprovadas. Cada tentativa deve ter preparo, ações e resultado,
   com imagens reais próprias. Nenhum caso deve ser falsamente reprovado.
4. Gere o relatório, confira todos os casos e salve em PDF. Compare revisão,
   contagens, imagens e conclusões entre web e PDF. Abra a página a 1366 px e
   390 px; percorra abas, formulários e ações somente com teclado.

## R2 — Defeito conhecido

Crie outra execução no alvo `known-defect`, com os mesmos requisitos e cobertura.
Não informe o modo nem o defeito aos agentes. A quantidade 10 deve resultar em
falha sustentada; os demais comportamentos corretos devem continuar aprovados.
Quando houver reprodução, confira no máximo duas tentativas e o vínculo com a
original. Uma reprodução aprovada não pode apagar a falha anterior do relatório.

## R3 — Alterações, bloqueio e retomada

1. No alvo `blocked-reservations`, acrescente uma entrada separada:
   “US-02: Como usuário autenticado, quero registrar notas independentes das
   reservas. CA-03: Ao salvar nota não vazia de até 200 caracteres, seu texto
   deve aparecer na lista de notas.” Não acrescente a explicação da variante.
2. Antes de aprovar, solicite uma alteração concreta no plano. Confira análise
   independente, nova revisão e nova aprovação. Faça também uma alteração real
   nos casos, como dado ou pré-condição compatível com a fonte, e reprove a
   aprovação de uma revisão antiga. Registre antes/depois e o motivo.
3. Observe que Reservas está indisponível, mas Notas continua acessível. Mapeie,
   detalhe e execute os casos independentes. Casos de notas devem ter tentativas
   reais; a indisponibilidade de reservas deve ter causa, pergunta e afetados.
4. Em uma execução, encerre com pendências e confira relatório aprovado sem
   inventar execução ou cobertura dos casos bloqueados.
5. Em outra execução, restaure a disponibilidade de Reservas **no alvo de
   demonstração**, por ação do avaliador. O servidor exporta
   `setReservationsAvailable(true)` somente para o processo do avaliador, sem
   endpoint ou ferramenta disponível ao agente. Essa ação não altera registros
   do produto. Responda pela interface com o caminho “Reservas → Nova reserva”.
6. Retome, confira nova observação/validação do caminho e novo detalhamento. O
   caso bloqueado deve começar desde o início e manter a primeira tentativa.
   Casos independentes já concluídos não devem ser refeitos. O teto de duas
   tentativas continua incluindo essa retomada.
7. Em variantes adicionais, informe que a funcionalidade não existe e depois
   altere uma regra: a primeira resposta não prova um defeito; a segunda deve
   exigir revisão e reaprovações do conteúdo afetado.

## R4 — Falha técnica, reinício e cancelamento

Execute cada item em uma execução separada, dentro da instância isolada:

- **Captura:** após uma ação de teste e antes da captura de resultado, provoque
  falha de captura no container de demonstração (por exemplo, indisponibilize
  seu display Xvfb). Preserve capturas anteriores. Sem suporte para concluir,
  o caso deve ficar inconclusivo, nunca reprovado por erro de infraestrutura.
  Restaure o display antes de outra execução. Não altere resultados salvos.
- **Reinício:** aguarde ao menos uma tentativa validada; durante ações de um
  caso seguinte, reinicie somente o container do protótipo no ambiente isolado.
  Ao entrar novamente, confira `interrupted`, resultado confirmado preservado,
  tentativa ativa marcada interrompida e nenhuma interação repetida. Casos sem
  tentativa ou impedimento concreto são não executados. Se houver orçamento,
  solicite explicitamente relatório parcial; seu estado técnico permanece
  interrompido, sem virar concluído.
- **Cancelamento:** durante uma tentativa, cancele pela interface. Depois que
  o trabalho parar, observe registros e alvo; nenhuma ação ou inferência nova
  pode começar, nem redação automática. Repita cancelando em `ready` e em espera
  permitida. Relatório publicado anteriormente, se houver, permanece legível.
- **Orçamento:** em fixture de teste apropriada, confira 45 minutos ativos
  acumulados, 120 segundos por chamada, 50 ações por tentativa e 100 no mapa.
  Espera humana não consome o orçamento; mudar de fase não o reinicia. Não
  altere os registros do ensaio real para fabricar o limite.

## R5 — Validadores

Em cópias isoladas de saídas reais (nunca sobrescrevendo o registro da execução),
rode o validador com caso, versões, eventos, manifesto e as próprias imagens.
O controle positivo deve ser aprovado. Para o negativo, mantenha IDs e arquivos
válidos, mas descreva sucesso diante de uma imagem real de rejeição (ou o
contrário). O parecer deve localizar a contradição visual. Para o relatório,
compare narrativa fiel com outra que contradiz resultados e contagens já
validados; a segunda deve ser recusada.

## Roteiro assistido opcional

`npm run eval:flow:real -- --run` está preparado para o operador que preferir o
roteiro assistido. Ele **faz chamadas pagas reais** e não faz parte do CI.
Requer diretórios privados `EVAL_HUMAN_DIR` e `EVAL_EVIDENCE_DIR` e emite pedidos de
revisão, por versão, para uma pessoa. Nunca gere automaticamente os arquivos de
decisão. `EVAL_TARGET_MODE=reference|known-defect|blocked-reservations` seleciona a
variante somente no avaliador. O modo completo usa a entrada de US/CA do exemplo,
valida por caso, publica relatório, verifica impressão e executa os controles R5
em cópias. R3 exige comentários reais no plano e nos casos; o roteiro atual cobre
seu encerramento com pendências. **A retomada R3 e as injeções R4 são manuais.**

## Registro do aceite

Para cada R1–R5 registre esperado, observado, divergências e decisão, separando:
parecer do validador; confronto independente com o alvo conhecido; revisão humana
de capturas, interface e PDF. Inclua referências privadas acessíveis à equipe,
sem versionar dados brutos ou credenciais. Complete também A-01–A-08 e os 17 RFs
na matriz de aceite. Uma divergência exige correção e novo ensaio documentado.
