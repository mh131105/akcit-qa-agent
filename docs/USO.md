# Como usar o QAtron

O QAtron organiza testes funcionais de aplicações web a partir dos comportamentos esperados. Você informa os requisitos, revisa o plano e os casos, acompanha a execução no navegador e consulta um relatório com resultados e capturas de tela.

## 1. Criar uma execução

Entre na sua conta ou selecione **Criar conta**. No histórico, abra **Nova execução** e informe o nome da execução, a aplicação e, se necessário, um objetivo.

No campo **Requisitos**, descreva os comportamentos esperados. São aceitos requisitos funcionais, histórias de usuário, critérios de aceite e cenários Gherkin. Você também pode enviar até cinco arquivos `.txt`, `.md` ou PDF com texto, com até 10 MiB por arquivo. PDFs digitalizados sem texto extraível não têm OCR.

Selecione **Salvar rascunho**. Os documentos permanecem como fontes separadas. Depois, use **Preparar plano** para iniciar a organização dos requisitos.

## 2. Revisar o plano

Acompanhe a curadoria e o planejamento na página da execução. Se houver uma dúvida sobre os requisitos, responda antes de continuar.

Leia o plano e confira o escopo, as regras e as exclusões. Selecione **Aprovar plano** ou **Solicitar alterações**, explicando o ajuste necessário. A aprovação fica registrada; use **Gerar casos de teste** para iniciar a próxima etapa.

## 3. Revisar os casos de teste

Confira as pré-condições, os dados, os passos previstos e o resultado esperado de cada caso. Use **Aprovar casos de teste** ou **Solicitar alterações nos casos**. O comentário é obrigatório ao pedir alterações.

Essas são as duas aprovações humanas do fluxo: primeiro o plano, depois os casos. As etapas também passam por validação dos agentes antes de avançar.

## 4. Configurar o acesso à aplicação

Abra **Configurar acesso** e informe:

- O endereço público HTTP ou HTTPS da aplicação.
- O perfil da conta usada no teste.
- A preparação necessária para os testes; declare quando não houver preparo adicional.
- O usuário e a senha de uma conta de teste da aplicação.

Na versão atual, o primeiro cadastro de acesso exige essa credencial. Ela é diferente da conta usada para entrar no QAtron. Use um ambiente de teste e uma conta apropriada, pois os testes podem cadastrar ou alterar dados na aplicação. Confirme a autorização e selecione **Salvar acesso**.

O ambiente publicado recusa localhost e endereços de redes privadas. Após o início da preparação, o endereço fica vinculado à execução; para testar outro alvo, crie uma nova execução.

## 5. Mapear e executar

Após aprovar os casos e configurar o acesso, selecione **Mapear aplicação**. O executor identifica telas e caminhos de navegação; um validador examina o mapa e as capturas. Essa etapa ainda não corresponde à execução dos casos de teste.

Quando disponível, use **Detalhar percursos** para associar os casos aprovados aos caminhos observados. Com os percursos validados, selecione **Executar testes**. Acompanhe os passos, as tentativas e as capturas na página da execução.

Se houver uma dúvida ou um impedimento, consulte as perguntas, registre a resposta e use **Retomar com as respostas** quando a ação estiver disponível. Durante a preparação, a ação aparece como **Retomar preparação com as respostas**. Alterações solicitadas passam por análise antes de retomar o trabalho afetado.

## 6. Consultar o relatório

Quando disponível, selecione **Gerar relatório**. A publicação depende da validação do relatório. Ele reúne o escopo, os casos, os resultados esperados e observados, as tentativas, as capturas e as pendências.

| Resultado | Como interpretar |
| --- | --- |
| Aprovado | As evidências sustentam o resultado esperado para o caso. |
| Reprovado | As evidências sustentam uma diferença em relação ao resultado esperado. |
| Bloqueado | Um impedimento concreto impossibilitou concluir o teste. |
| Inconclusivo | Houve tentativa, mas faltou suporte suficiente para uma conclusão validada. |
| Não executado | Não há tentativa nem impedimento específico registrado para o caso. |

Um bloqueio ou erro do modelo não comprova um defeito na aplicação. Confira o resultado observado e as evidências de cada caso.

Use **Salvar em PDF** para abrir a impressão do navegador e salvar o relatório. O QAtron carrega as capturas da revisão publicada antes da impressão.

Se não restarem casos independentes executáveis, a interface pode oferecer **Encerrar com pendências**. Depois de uma interrupção ou erro, pode disponibilizar **Gerar relatório parcial**; as limitações e o estado da execução ficam registrados. O histórico permite consultar as execuções e os resultados salvos.

Para instalar ou operar uma instância, consulte [Desenvolvimento](DESENVOLVIMENTO.md) e [Operação](OPERACAO.md).
