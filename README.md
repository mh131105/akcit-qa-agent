# QAtron

[**Acessar a aplicação**](https://qatron.mhvps.site/) · [Como usar](docs/USO.md) · [Documentação](docs/README.md) · [Agentes e coordenação](agents/README.md)

**Dos requisitos ao relatório de testes de uma aplicação web.** O QAtron organiza os comportamentos esperados, prepara plano e casos de teste, navega pela interface da aplicação e registra os resultados com evidências. O usuário revisa o plano e os casos antes da execução e pode responder a perguntas durante o processo.

O projeto reúne uma interface web, coordenação de agentes, automação visual de navegador e um histórico de execuções. O relatório relaciona requisito, caso, tentativa, resultado esperado, observação e captura de tela.

## O que a aplicação faz

- Recebe requisitos em texto, histórias de usuário, critérios de aceite e Gherkin textual, além de arquivos `.txt`, `.md` e PDF com texto.
- Organiza as fontes, identifica dúvidas e gera plano e casos para revisão humana.
- Mapeia telas, associa percursos aos casos aprovados e realiza testes pela interface visual.
- Valida as saídas dos agentes em sessões independentes e registra perguntas, revisões e tentativas.
- Apresenta resultados aprovados, reprovados, bloqueados, inconclusivos e não executados, com relatório web e impressão em PDF.
- Mantém contas, histórico e arquivos por execução, com opções de duplicação e exclusão.

## Como funciona

1. **Informar os requisitos:** crie uma execução e envie os comportamentos que deseja verificar.
2. **Revisar o plano:** confira a interpretação dos requisitos e aprove ou solicite ajustes.
3. **Revisar os casos:** examine pré-condições, dados e resultados esperados antes de aprovar o conjunto.
4. **Preparar o acesso:** informe a URL pública e a conta de teste da aplicação.
5. **Mapear e testar:** acompanhe a navegação, o detalhamento dos percursos e as tentativas. Responda às perguntas quando houver impedimentos.
6. **Consultar o relatório:** confira conclusões, capturas e pendências; use **Salvar em PDF** para imprimir a revisão publicada.

As aprovações humanas e as ações de continuidade são separadas. O [guia de uso](docs/USO.md) explica os controles e a interpretação dos resultados.

## Agentes e decisões de implementação

O backend controla a sequência por estados e regras explícitas. **O orquestrador é determinístico:** ele encaminha tarefas e aplica pareceres sem usar um modelo para escolher a próxima etapa.

| Papel | Responsabilidade |
| --- | --- |
| Curador | Organizar requisitos, regras, fontes e perguntas. |
| Projetista | Preparar plano e casos, associar percursos e analisar alterações. |
| Executor | Observar a aplicação e realizar os casos com navegador, cursor e teclado. |
| Validador | Revisar saídas textuais e visuais em contexto independente. |
| Redator | Explicar os resultados consolidados no relatório. |

O executor interage com a aplicação-alvo pela tela, sem ler seu código, consultar suas APIs ou usar seletores DOM. O backend mantém IDs, versões, contagens e vínculos das evidências. As conclusões dos agentes passam por validação antes de alimentar uma etapa dependente ou um relatório publicado.

**Tecnologias:** TypeScript, Node.js 24, SDK Pi, Playwright/Chromium, SQLite, HTML/CSS/JavaScript e Docker. Os perfis atuais de modelos e suas configurações estão em [Operação](docs/OPERACAO.md); os [contratos](docs/requisitos/CONTRATOS.md) descrevem estados, formatos e aprovações.

## Executar localmente

Use Git e Docker com Compose 2.24 ou posterior:

```sh
git clone https://github.com/mh131105/akcit-qa-agent.git
cd akcit-qa-agent
git switch develop
cp .env.example .env
docker compose up --build -d --wait
```

Abra [localhost:3100](http://127.0.0.1:3100). As ações dos agentes exigem os modelos e as credenciais configurados para o ambiente. Consulte [Desenvolvimento](docs/DESENVOLVIMENTO.md) para preparar o ambiente e [Operação](docs/OPERACAO.md) para configurar os provedores.

## Verificações e evidências

O repositório inclui testes de autenticação, entradas, estados, aprovações, coordenação e relatórios, além de verificações de navegador e execução visual. Para conferir tipos e testes no container:

```sh
docker compose exec app npm run check
docker compose exec app npm test
```

Os testes automatizados substituem os modelos; as verificações de infraestrutura também não fazem chamadas pagas de LLM. Ensaios com modelos reais são uma etapa separada. Os [registros de validação](docs/evidencias/README.md) indicam método, ambiente, evidências e limitações de cada verificação.

## Escopo e limitações

- O ambiente publicado trabalha com URLs públicas HTTP/HTTPS. Localhost e endereços de redes privadas são recusados em produção.
- A configuração inicial de acesso exige uma conta de teste do alvo. As interações podem criar ou alterar dados; escolha um ambiente apropriado.
- O escopo é teste funcional de caixa-preta. Testes de carga, segurança e usabilidade não fazem parte deste fluxo.
- Capturas do mapeamento não comprovam a execução dos casos. Falta de evidência ou impedimento deve aparecer na conclusão correspondente.
- A qualidade dos casos e das conclusões depende dos requisitos, do acesso e das respostas dos modelos. O relatório conserva falhas, bloqueios e pendências para revisão.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [Como usar](docs/USO.md) | Fluxo da interface, perguntas, resultados e PDF. |
| [Desenvolvimento](docs/DESENVOLVIMENTO.md) | Instalação, comandos, testes e contribuição. |
| [Produto](docs/requisitos/PROTOTIPO.md) | Requisitos, regras de negócio e escopo. |
| [Contratos](docs/requisitos/CONTRATOS.md) | Dados, estados, operações e aprovações. |
| [Agentes](agents/README.md) | Papéis, ferramentas, sessões e validação. |
| [Operação](docs/OPERACAO.md) | Modelos, publicação, dados, backup e recuperação. |
| [Evidências](docs/evidencias/README.md) | Registros técnicos de verificações e experimentos. |
| [Identidade visual](docs/brand/README.md) | Marca e convenções da interface. |

**Autoria:** David Caetano, Erick Gomes, Gabriel Rafael e Matheus Henrique.
