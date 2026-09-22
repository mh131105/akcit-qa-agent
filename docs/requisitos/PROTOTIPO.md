# Protótipo completo em uma sprint

Data de referência: 22/09/2026. Status: proposta técnica para revisão da equipe.

## Premissas confirmadas

- Entrega em 26/09 às 17h; quatro pessoas com disponibilidade alta e equivalente.
- O cliente do protótipo possui processo organizado e artefatos de requisitos
  adequados. A curadoria coleta e normaliza essas informações preservando seu significado.
- O agente recebe acesso válido à aplicação e atua pelo navegador, com visão,
  cursor e teclado. A exploração inicial identifica telas e caminhos naturais;
  ela não procura limites de campos por tentativa e erro.
- Os casos usam as histórias/requisitos, partição em classes de equivalência (PCE)
  e análise de valores-limite (AVL), quando aplicáveis. O relatório inclui vídeos
  curtos das execuções.
- A equipe ainda decidirá entre acompanhamento contínuo e QA por demanda.
- A equipe decidiu incluir o sexto agente `output-validator`, responsável pela
  qualidade das saídas dos demais especialistas. O orquestrador não faz essa avaliação.
- A aplicação de demonstração, a conta e os artefatos ainda serão providenciados;
  a equipe não consegue defini-los em 22/09.
- A equipe quer escolher modelos por tarefa, priorizando qualidade e avaliando
  custo-benefício. Provedor, credenciais utilizáveis e modelos ainda não estão definidos.

## Jornada a entregar

Como responsável por um teste, quero informar o acesso e os requisitos, acompanhar
uma execução e consultar quais comportamentos foram verificados, com resultado
esperado, resultado observado e evidências que eu consiga conferir.

```mermaid
flowchart LR
    A[Usuário informa aplicação e artefatos] --> B[Curadoria preserva e estrutura requisitos]
    B --> V1[Validador revisa curadoria]
    V1 -->|Aprovado| C[Agente identifica telas e percursos]
    C --> V2[Validador revisa mapa]
    V2 -->|Aprovado| D[Planejamento cria casos com PCE e AVL]
    D --> V3[Validador revisa plano]
    V3 -->|Aprovado| E[Agente percorre a interface e executa os casos]
    E --> V4[Validador revisa resultados e evidências]
    V4 -->|Aprovado| F[Agente redige relatório]
    F --> V5[Validador revisa relatório]
    V5 -->|Aprovado| G[Interface publica conclusões e vídeos]
```

Os cinco pontos de revisão usam o mesmo papel de validador, em tarefas separadas.
Uma correção retorna ao produtor; um bloqueio impede a etapa dependente. A interface
pode exibir progresso e rascunhos identificados como não validados durante o trabalho.

## Escopo funcional e aceitação

| ID | Comportamento | Como verificar |
| --- | --- | --- |
| RF-01 | Receber URL inicial autorizada, referência de acesso, objetivo e artefatos | Criar uma execução identificável e preservar a versão das entradas utilizada |
| RF-02 | Normalizar os requisitos | Para cada regra, localizar o trecho original; preservar condições, exceções, valores e obrigatoriedade |
| RF-03 | Mapear a navegação relevante ao objetivo | Registrar telas e transições observadas, com ações que permitam repetir o percurso desde a entrada |
| RF-04 | Planejar os casos | Vincular cada caso aos requisitos e ao percurso; explicitar pré-condições, dados, técnica e resultado esperado com origem |
| RF-05 | Executar pela interface | Autenticar, clicar, digitar e rolar com as tools autorizadas; registrar ações e observações de cada tentativa |
| RF-06 | Produzir evidências | Associar o vídeo curto ao caso e à tentativa; informar quando a captura faltar; distinguir execução original de reprodução |
| RF-07 | Exibir o relatório | Mostrar casos aprovados, reprovados, bloqueados, inconclusivos e não executados, com esperado, observado e evidência |
| RF-08 | Preservar a execução | Após recarregar a página ou reiniciar o serviço, manter entradas, plano e resultados já salvos; indicar interrupção |
| RF-09 | Validar as saídas com agente independente | Curadoria, mapa, plano, resultados e relatório recebem parecer vinculado à revisão exata; somente aprovação libera o consumo pela etapa seguinte |

Uma mesma história pode ter casos de várias classes e limites. A quantidade de casos
depende das regras escolhidas; não prometer cobertura total da aplicação.

## Regras de qualidade

**RQ-01 — Mesma semântica.** “Entre 1 e 10, inclusive” mantém ambos os limites.
“Opcional” não vira “obrigatório”. Condições e exceções não desaparecem durante a
normalização. Guardar o texto original junto da interpretação torna a revisão possível.

**RQ-02 — Origem da expectativa.** O requisito estabelece o que deveria acontecer.
A interface revela como chegar e o que aconteceu. Uma mensagem observada não se
torna uma nova regra de negócio. Uma suposição deve aparecer como tal e não sustenta
um veredito definitivo de conformidade.

**RQ-03 — Dúvida localizada.** Mesmo com artefatos bons, uma ambiguidade pode surgir.
Registrá-la e interromper somente os casos dependentes, quando os demais puderem
continuar. Registrar um documento contraditório não exige construir nesta sprint
um produto completo para recuperação de documentação ruim.

**RQ-04 — Navegação observável.** A exploração coleta o percurso relevante ao teste.
Durante a execução, o agente repete esse percurso. Configurar o navegador, abrir a
entrada autorizada e capturar a tela são operações de infraestrutura; alterar o
estado da aplicação por JavaScript, banco ou API contorna o comportamento sob teste.

**RQ-05 — Veredito sustentado.** Reprovar exige uma diferença observável contra uma
expectativa com origem. Erro do agente, sessão expirada, falha de gravação e ausência
de pré-condição precisam aparecer com a classificação adequada. Um número de
“confiança” emitido pelo modelo não substitui evidência.

**RQ-06 — Tentativas separadas.** Se houver reprodução, preservar a primeira tentativa.
Cada tentativa tem seus próprios eventos e mídias. Preparar ou restaurar dados de
teste deve seguir um procedimento explícito, fora das ações avaliadas do agente.

**RQ-07 — Validação independente.** O validador compara cada saída com as entradas,
critérios e evidências em contexto próprio. Ele justifica aprovação, pedido de correção
ou bloqueio. O backend confere formato e referências; o orquestrador aplica o parecer
sem substituí-lo. Falha de validação, resposta inválida e limite de correções esgotado
não permitem avançar. Uma nova revisão exige novo parecer; dependentes de uma saída
alterada precisam de nova revisão. Não há autovalidação recursiva do validador.

**RQ-08 — Dois resultados distintos.** O veredito do caso avalia a aplicação.
O parecer do validador avalia o trabalho do agente. É possível aprovar a saída que
documenta um teste reprovado ou inconclusivo, desde que ela esteja bem sustentada.
Acrescentar um revisor de IA não garante acerto; a equipe confere também seus pareceres
contra exemplos de referência.

## Decisão técnica confirmada

**DT-01 — Validador dedicado.** Decisão do grupo registrada em 22/09/2026. A arquitetura
passa a ter orquestrador, curador, planejador, executor, redator e validador. O novo
papel concentra a avaliação de qualidade, separada da coordenação do fluxo. As quatro
frentes de desenvolvimento permanecem; C define a metodologia de validação e B conecta
o validador ao fluxo. O custo e o tempo das revisões entram na medição da execução.

## Decisões provisórias que destravam a implementação

Estas escolhas são propostas de escopo, não decisões de negócio aprovadas.

| ID | Base proposta | Motivo e ponto de revisão |
| --- | --- | --- |
| D-01 | Salvar histórico por execução; iniciar cada nova execução sem conclusões herdadas | Evita decidir agora a memória entre sprints. Rever após a demonstração e entrevistas |
| D-02 | Um navegador e uma execução ativa por ambiente | Cabe na infraestrutura atual; concorrência aguarda medição |
| D-03 | Entrada inicial por texto/Markdown e PDF com texto selecionável | Reduz formatos sem remover a curadoria. OCR e conectores de backlog ficam para depois |
| D-04 | Uma conta de teste e um fluxo de negócio pequeno na demonstração | Permite concluir todas as etapas com evidências; tamanho final depende da aplicação |
| D-05 | Sem edição de requisitos no meio da execução | Correções geram nova versão das entradas e uma nova execução, preservando o que já ocorreu |
| D-06 | Modelo configurável por papel; primeiro fluxo usa modelos disponíveis | Comparar alternativas com as mesmas entradas depois que houver execução real |
| D-07 | Aplicação controlada como apoio à integração | Permite avançar enquanto a equipe providencia o alvo externo; limitações devem constar da apresentação |

Histórico é o registro do que ocorreu. Memória é a seleção de informações antigas
que influenciarão uma nova decisão do agente. Para D-01, cada execução guarda seu
próprio contexto. Um identificador de projeto pode agrupá-las sem alimentar o modelo
com conclusões antigas. Um produto com memória futura ainda precisará definir
versões, validade, conflitos e quais informações recuperar.

## Pendências e decisões de negócio

| Tema | Impede começar hoje? | Tratamento nesta sprint |
| --- | --- | --- |
| ICP, preço e relação contínua ou pontual | Não | Registrar como hipótese; evitar comprometer a interface com uma promessa comercial |
| Aplicação, acesso e artefatos externos | Não para contratos; sim para validar nesse alvo | Equipe providencia; usar exemplo e aplicação controlada para desenvolver |
| Provedor e credencial | Não para mocks; sim para executar agentes reais | Responsável de orquestração verifica acesso assim que disponível, em configuração privada |
| Melhor modelo de cada papel | Não | Comparar candidatos disponíveis por tarefa, mantendo uma configuração funcional |
| Formatos, fluxo obrigatório e limites de execução | Afetam esforço | Adotar a base proposta e registrar ajustes antes de ampliar o trabalho |

Não há compromisso informado sobre quando os insumos externos chegarão. Se faltarem
na entrega, demonstrar a aplicação controlada e declarar que a validação externa
continua pendente. Uma execução em alvo controlado não comprova generalização.

## Critério de pronto do protótipo

- O usuário percorre RF-01 a RF-09 pela interface, sem transferência manual oculta
  de dados entre etapas. O fluxo utiliza modelos e navegador reais.
- Cada saída consumida por outra etapa tem aprovação do validador para aquela revisão.
  Um erro inserido na saída gera correção ou bloqueio, sem aprovação pelo orquestrador.
  Verificar também erro/timeout do validador, limite de correções e parecer de revisão antiga.
- O relatório final só publica conclusões validadas; progresso e saídas pendentes
  aparecem identificados. Um defeito bem documentado mantém `failed` mesmo quando
  sua documentação recebe `approved` do validador.
- O time confere a normalização contra os artefatos originais, incluindo uma regra
  com limites e uma condição ou exceção.
- O agente produz casos de classes válidas/inválidas e limites justificados, executa
  um comportamento correto e detecta um defeito conhecido do alvo controlado.
- Um cenário de acesso impedido aparece como bloqueado; evidência insuficiente
  aparece como inconclusiva. O relatório inclui o que não chegou a ser executado.
- Cada caso executado na demonstração tem vídeo acessível da tentativa correspondente.
  Testar também a falha de captura, sem escondê-la no relatório.
- Um reinício mantém os resultados salvos e não transforma trabalho interrompido em sucesso.
- A versão escolhida passa nas verificações do repositório e na validação em dev;
  produção recebe a imagem validada conforme o fluxo existente.
- A equipe registra os modelos usados, tempo, consumo quando disponível e limitações.

Inspeção de usabilidade, memória entre sprints, exploração exaustiva, colaboração
entre usuários e suporte amplo a formatos ficam fora desta proposta de entrega regional.
