# Comecem por aqui

Entrega informada pela equipe: **26/09/2026 às 17h**. Este plano usa o horário de
Manaus. São quatro integrantes com disponibilidade alta e equivalente, em uma
única sprint. Os marcos intermediários são verificações de integração dessa sprint.

Este material é uma **proposta para revisão da equipe**. O prazo e as premissas
identificadas como confirmadas vieram da conversa. As escolhas provisórias permitem
começar sem presumir que a equipe já decidiu o modelo de negócio.

## O que fazer agora

1. Leiam o [escopo e as decisões](PROTOTIPO.md) juntos e escolham um responsável
   por cada frente da [sprint](../SPRINT.md).
2. Usem os [contratos](CONTRATOS.md) e o [exemplo compartilhado](exemplos/execucao-demo.json)
   para desenvolver as partes em paralelo. O exemplo contém dados inventados;
   nenhum teste nele foi executado.
3. Criem branches a partir de `develop` e abram PRs pequenos. Registrem nas issues
   as dependências e as evidências de conclusão. Não esperem terminar uma frente
   inteira para integrar uma parte utilizável.
4. Atualizem o contrato junto de quem fornece e de quem consome o dado quando uma
   mudança de implementação afetar outra frente.

## Onde cada coisa fica

| Informação | Lugar |
| --- | --- |
| O que entregar e como aceitar | [PROTOTIPO.md](PROTOTIPO.md) |
| Dados trocados entre componentes | [CONTRATOS.md](CONTRATOS.md) e [exemplo](exemplos/execucao-demo.json) |
| Quem faz, dependências e agenda | [SPRINT.md](../SPRINT.md) e GitHub Issues |
| Código e revisão de mudanças | Branch de trabalho e PR para `develop` |
| Metodologia e tools por especialista | `agents/<papel>/skills/` e `agents/<papel>/tools/` |
| Configuração, publicação e operação | [README](../../README.md) e [OPERACAO.md](../OPERACAO.md) |
| Documentos do cliente, credenciais, sessões e vídeos | Armazenamento da aplicação; fora do Git |

Nas issues, mantenham o responsável, o resultado esperado e o bloqueio atual.
Nos documentos, mantenham as decisões que continuam válidas. No PR, expliquem a
mudança, como a verificaram e qual critério de aceitação ela atende. Isso evita
manter três descrições diferentes da mesma regra.

## O que já existe

O repositório tem servidor inicial, fábrica de sessões do Pi, diretórios dos
especialistas, ambiente de navegador/cursor/vídeo e publicação em dev/prod.
**A interface do produto, os agentes e o fluxo de testes ainda não estão implementados.**
As sessões atuais não habilitam chamadas de rede ao modelo, skills ou tools.
O smoke de infraestrutura não comprova a qualidade dos testes de software.
