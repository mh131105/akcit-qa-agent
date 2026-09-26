# T9.1 — Candidato à conclusão do protótipo

## Estado e responsabilidade

Implementação candidata em integração sobre `develop` após PR #30, base `8c93bc6`.
Por orientação expressa de Matheus — “eu valido manualmente” — os ensaios com
LLM real, a conferência das capturas/PDF e o aceite humano ficam com ele. Nenhuma
chamada paga ou aprovação humana foi fabricada nesta implementação. Os testes
substituídos abaixo comprovam controles do código, não a qualidade dos modelos.

O card conserva seu escopo completo. A [matriz](matriz-aceite.md) cobre os 17 RFs,
A-01 a A-08 e R1–R5, distinguindo automação de validação manual. Não declarar os
ensaios manuais concluídos antes de registrar seus resultados e divergências.

| Identificação | Registro |
| --- | --- |
| Base | `8c93bc6`, merge do PR #30 |
| SHA candidato | Usar o SHA final do PR e seu check de CI; o código estava em integração na criação deste registro. |
| Imagem/digest | A registrar após o build/smoke da imagem candidata. Não confundir imagem local com imagem publicada. |
| Ambiente automatizado | Worktree isolado; Node.js 24, lockfile do repositório; fixtures sintéticas. |
| Publicação dev / promoção | A conferir no release efetivo; este documento não afirma publicação ou promoção ainda não realizadas. |
| Revisão manual | Matheus; pendente de execução/registro por ele. |

## Mudanças verificáveis

Upload multipart e PDF textual preservam fontes e originais; perfil, duplicação e
exclusão completam a administração. Comentários e respostas são interpretados pelo
projetista, validados independentemente e aplicados com revisões e invalidação
localizada. O executor persiste cada tentativa antes da interação e usa ferramentas
visuais. Resultados são revisionados por caso; cada validação recebe suas imagens.

O relatório usa contagens, cobertura, referências e resultados consolidados pelo
backend; o redator só explica. A publicação muda somente após parecer aprovado.
As capturas pertencem ao caso/tentativa, a falha sustentada não desaparece após
reprodução, e PDF usa o snapshot publicado. Limite: uma tentativa original e até
uma reprodução, incluindo retomadas; corrigir texto não repete ações físicas.

## Automação

Com Node 24 e dependências do lockfile:

```sh
npm ci
npm run check
npm test
npm run build
python3 -m unittest discover -s deploy -p 'test_*.py'
```

Executar também os smokes da imagem, incluindo `smoke:execution`. O CI final é a
referência para a suíte completa. Verificações já realizadas durante a frente C:

- TypeScript (`npm run check`): aprovado antes da integração final.
- Feedback/relatório e regressão do exemplo/aprovações: 64 testes aprovados, zero
  falhas, incluindo histórico de revisão rejeitada e invalidação localizada.
- O teste de integração da frente B cobre preparação → aprovações → execução →
  relatório, revisão de plano/casos, bloqueio com retomada e cancelamento em `ready`.

Esses resultados não antecipam o resultado final do CI nem os smokes de container.
Registrar no PR os comandos/contagens finais e quaisquer limitações encontradas.

## Ensaios manuais com modelos reais

Matheus executará `npm run eval:flow:real -- --run`, com aprovações humanas efetivas
e armazenamento privado. Perfis esperados:

| Papel | Modelo | Raciocínio |
| --- | --- | --- |
| Curador | `deepseek-flash` | `low` |
| Projetista e análise de alterações | `deepseek-v4-pro` | `high` |
| Executor visual | `deepseek-flash` | `high` |
| Validador visual | `deepseek-flash` | `high` |
| Redator | `deepseek-flash` | `low` |
| Validador textual | `deepseek-v4-pro` | `high` |

| Ensaio | O que conferir | Situação |
| --- | --- | --- |
| R1 — Aplicação correta | Modo `reference`, 0/1/10/11, inteiro interno/não inteiro, comentário opcional; rejeições corretas são `passed`, sem falso defeito; relatório/PDF consistentes. | Manual por Matheus; não executado nesta implementação. |
| R2 — Defeito conhecido | Execução nova em `known-defect`, gabarito oculto dos agentes; quantidade 10 indevidamente rejeitada é `failed`; reprodução preserva primeira tentativa. | Manual por Matheus; não executado nesta implementação. |
| R3 — Alterações e bloqueios | Alterar plano/casos; novas versões e aprovações; funcionalidade indisponível e outra independente; resposta, retomada e encerramento com pendências. | Manual por Matheus; não executado nesta implementação. |
| R4 — Falha técnica e recuperação | Falha de captura, reinício após resultado confirmado, cancelamento; preservar resultados, nenhuma repetição automática ou chamada após cancelamento. | Manual por Matheus; não executado nesta implementação. |
| R5 — Validadores | Controles positivo/negativo em cópias isoladas de saídas reais; imagem real contradiz conclusão e relatório contradiz resultado validado; manter IDs/arquivos válidos. | Manual por Matheus; não executado nesta implementação. |

O gabarito do alvo é exclusivo do avaliador; não entra no contexto dos agentes.
Para cada ensaio, registrar separadamente parecer do validador, conferência contra
o comportamento conhecido e revisão humana de capturas/relatório. Guardar esperado,
observado, divergências, correções e decisão, sem apagar tentativas malsucedidas.

## Registro a preencher após o aceite manual

Para cada execução: ID, SHA/imagem/digest, ambiente, horário, perfis efetivos,
entradas, esperado/observado, versão publicada, referências privadas às capturas/PDF,
divergências e decisão de Matheus. Registrar tokens/custo estimado quando o
provedor os informar; ausência de medição não equivale a consumo zero. Nesta
implementação não foi medido consumo de LLM real.

Dados brutos, artefatos privados, credenciais, sessões e imagens ficam fora do Git.
Publicar somente este relato sanitizado e referências acessíveis à equipe. O
ensaio anterior [PR #30](../t6.3/revisao-ensaio-real.md) comprova apenas o fluxo
até `ready / route_detail`; não comprova execução, relatório ou PDF do T9.1.
