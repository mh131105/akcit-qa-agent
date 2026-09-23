# Comecem por aqui

A [especificação do protótipo](PROTOTIPO.md) é a referência para implementar:
**17 requisitos funcionais, 15 regras de negócio, 12 requisitos não funcionais,
sete vistas de interface e oito cenários de aceitação**.

Ela incorpora o fluxo aprovado em 23/09: plano e casos antes do mapeamento, duas
aprovações humanas e validador independente. Os limites operacionais e o recorte das
telas são a base técnica proposta pelo CTO; devem ser verificados na implementação.
Entrega: **26/09/2026 às 17h, horário de Manaus**, com quatro integrantes.

## Onde trabalhar

| Precisa saber | Leia ou use |
| --- | --- |
| O que entregar, telas, regras e critérios de pronto | [PROTOTIPO.md](PROTOTIPO.md) |
| Dados, estados, versões, aprovações e operações | [CONTRATOS.md](CONTRATOS.md) |
| Exemplo compartilhado para integrar as partes | [execucao-demo.json](exemplos/execucao-demo.json) e [artefato de origem](exemplos/artefato-demo.md) |
| Responsabilidades, dependências e tarefas | [SPRINT.md](../SPRINT.md) e GitHub Issues |
| Ambiente, código e publicação | [README](../../README.md) e [OPERACAO.md](../OPERACAO.md) |

A especificação descreve o comportamento esperado. O contrato descreve como as
partes trocam dados. A issue registra trabalho e bloqueios. O PR registra mudança
e verificação. Se uma mudança afetar outro componente, atualizar contrato e exemplo
no mesmo PR, junto de quem fornece e de quem consome os dados.

O exemplo é sintético: não houve teste real nem validação de IA. Ele ilustra plano,
casos, aprovações humanas, mapa, detalhamento e uma correção antes do relatório parcial.

## Estado conferido da base

Há servidor inicial, fábrica de sessões do Pi, cadastro dos seis papéis, diretórios
de tools/skills, ambiente de navegador/cursor/vídeo e publicação em dev/prod.
**Os requisitos deste documento ainda precisam ser implementados e aceitos.** A
fábrica atual não habilita rede do modelo, skills ou tools. O smoke de infraestrutura
não comprova a qualidade nem o funcionamento do fluxo de testes do produto.

Documentos de clientes, credenciais, sessões e vídeos ficam no armazenamento da
aplicação, fora do Git. No repositório, manter apenas exemplos sintéticos e metodologia.
