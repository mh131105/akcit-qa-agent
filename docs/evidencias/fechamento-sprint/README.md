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
| SHA do código candidato | `171c47f758b68ee73d88f6fd0b342a385160e2e5`; o commit posterior registra somente estas evidências. Conferir também o CI do HEAD final do PR. |
| Imagem local | `akcit-qa:t91-candidate`; ID `sha256:1d4bfaa5787535b0e725701d96d2d9bdf22703a997ab317d4a84c369e085c74a`. Sem digest de publicação: a imagem não foi enviada a um registry. |
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

Verificação local concluída em 26/09/2026, com Node 24:

- `npm run check` e `npm run build`: aprovados.
- `npm test`: **268 testes aprovados**, nenhuma falha ou teste ignorado.
- Testes Python de deploy: **6 aprovados**.
- Cinco smokes passaram na imagem acima, sem montar código do host: runtime
  (**7 verificações**), web (**38**), alvo controlado (**15**), mapeamento e execução
  (**9 verificações** na execução). Navegador, ferramentas e persistência reais;
  chamadas de modelo substituídas explicitamente.
- Integração cobre preparação → aprovações → execução → relatório, revisão de
  plano/casos, bloqueio com retomada, cancelamento em `ready`, interrupção durante
  tentativa, resposta tardia, relatório parcial idempotente e preservação dos
  resultados independentes após alteração localizada.

Os modelos são substituídos explicitamente nos testes; esses resultados não
representam aceite da qualidade dos modelos. O CI do HEAD final permanece como
referência remota da suíte e dos smokes.

Comandos de smoke: `node scripts/smoke-{runtime,web,target,mapping,execution}.mjs`
dentro da imagem, com os mesmos limites/capabilities/tmpfs definidos no CI.
O smoke web usou Node **24.21.0**, Chromium **153.0.8010.52** e terminou em
**41,452 s**; gerou capturas a 1366/390 px e PDF do snapshot publicado. As saídas
locais estão em `artifacts/t91/candidate-*` (ignoradas pelo Git); o CI publica
os artefatos sintéticos correspondentes por 14 dias. A leitura humana do PDF
continua pendente. Limitação operacional observada: o Xvfb emite um aviso de
permissão para `/tmp/.X11-unix` ao iniciar sem root; os cinco smokes passaram.

## Instância local para revisão

A candidata está disponível em `http://127.0.0.1:3103`, container
`akcit-qa-t91-manual`, com volume independente `akcit-qa-t91-manual-data`.
A instância anterior na porta 3100 foi preservada. O health check e a resposta
HTTP do alvo controlado foram conferidos; nenhuma execução com LLM foi iniciada.

Cadastre uma conta com um e-mail já autorizado no ambiente local. Crie a execução
com `docs/requisitos/exemplos/artefato-demo.md`; no acesso à aplicação testada,
informe `http://127.0.0.1:4000`, usuário sintético `demo` e senha `demo1234`.
Esse endereço do alvo é interno ao container. O alvo está no modo `reference`;
seus registros sintéticos em memória reiniciam com o container, enquanto as
execuções do produto permanecem no volume. Os perfis usam as credenciais privadas
já configuradas localmente e o redator `deepseek-flash/low`.

Iniciar a preparação pela interface faz chamadas reais. O [roteiro manual](roteiro-manual.md)
detalha R1–R5; registre os resultados antes de solicitar merge e promoção.

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
