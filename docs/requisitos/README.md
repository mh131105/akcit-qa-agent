# Requisitos e contratos

[Documentação](../README.md) · [Como usar](../USO.md) · [Desenvolvimento](../DESENVOLVIMENTO.md)

A [especificação do produto](PROTOTIPO.md) reúne requisitos funcionais, regras de negócio, requisitos não funcionais, vistas da interface e cenários de aceitação. Os [contratos](CONTRATOS.md) descrevem os dados, estados, revisões, aprovações e operações.

| Documento | Finalidade |
| --- | --- |
| [Produto](PROTOTIPO.md) | Escopo, requisitos, regras e critérios de aceitação. |
| [Contratos](CONTRATOS.md) | Formatos e integração entre interface, backend e agentes. |
| [Execução sintética](exemplos/execucao-demo.json) | Exemplo de dados e transições para desenvolvimento. |
| [Artefato de origem](exemplos/artefato-demo.md) | Requisitos usados no exemplo sintético. |
| [Registros de validação](../evidencias/README.md) | Métodos, verificações realizadas e limitações observadas. |

## Fluxo do produto

Requisitos são organizados em curadoria, plano e casos. O plano e o conjunto de casos exigem aprovação humana de suas versões validadas. Depois da configuração de acesso, o fluxo segue por mapeamento visual, associação dos percursos, execução e relatório.

Perguntas e solicitações de alteração preservam as fontes e as decisões anteriores. O relatório relaciona resultados a casos, tentativas e capturas. Mapeamento, execução e publicação do relatório são etapas distintas.

## Usar os documentos

Ao alterar um comportamento compartilhado, atualize contrato e exemplo no mesmo PR. Os exemplos são sintéticos e servem para conferir a integração; não comprovam um teste real de uma aplicação.

Algumas seções dos contratos e dos registros técnicos mantêm identificadores de entregas anteriores para rastreabilidade. A interpretação deve considerar o escopo indicado em cada seção e as verificações correspondentes. Documentos enviados por usuários, credenciais, sessões e evidências privadas pertencem ao armazenamento da aplicação, fora do Git.
