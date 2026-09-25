# Evidências T8.2 — Mapeamento visual validado

Branch: `feat/validated-navigation-map` · Base: `develop` (`73063ac`).
Vínculos: [T8 #11](https://github.com/mh131105/akcit-qa-agent/issues/11) e
[T10 #14](https://github.com/mh131105/akcit-qa-agent/issues/14) — **nenhuma das
duas é encerrada por esta entrega**.

Revisão T8.2-R1 (correções do PR #29): [revisao-pr29.md](revisao-pr29.md).
Ensaio com inferência real: [ensaio-real.md](ensaio-real.md).

## Três tipos de evidência

| Tipo | Onde roda | Modelo | Objetivo |
| --- | --- | --- | --- |
| **Testes** | `npm test` (local e CI) | substituído por fakes determinísticos, identificados | contratos, limites, cancelamento, orçamento, chamadas e validação |
| **Smoke** | imagem final (CI, container com Xvfb/Chromium/xdotool) | substituído por roteiro, identificado como simulação | provar integração de navegador, cursor, capturas, destinos e interface reais |
| **Ensaio real** | ambiente operado (container da imagem final com Pi autenticado) | DeepSeek Flash/Pro conforme perfis documentados | avaliar a qualidade da navegação escolhida pelo modelo |

Nada nesta pasta, exceto [ensaio-real.md](ensaio-real.md), comprova inferência
real; os arquivos sintéticos são sanitizados (sem credenciais, sem conteúdo de
usuários) e identificados como exemplos.

## Configuração

- Executor visual: `PI_EXECUTOR_PROVIDER=deepseek`, `PI_EXECUTOR_MODEL=deepseek-flash`, `PI_EXECUTOR_THINKING_LEVEL=high`.
- Validador visual: `PI_VALIDATOR_VISUAL_PROVIDER=deepseek`, `PI_VALIDATOR_VISUAL_MODEL=deepseek-flash`, `PI_VALIDATOR_VISUAL_THINKING_LEVEL=high`.
- Validador textual: inalterado (Pro/high).
- Alvo T7: `node scripts/demo-target.mjs` em `http://127.0.0.1:4000`, credenciais `demo`/`demo1234`.

## Comandos executados

```bash
npm run check
npm test            # 195/195
npm run build
# na imagem final (construída do SHA registrado em ensaio-real.md), como o CI:
docker build --target runtime -t akcit-qa:ci .
docker run --rm --cpus=1 --memory=2g --shm-size=512m --cap-drop=ALL \
  --security-opt=no-new-privileges --read-only \
  --tmpfs /tmp:rw,size=512m,mode=1777 --tmpfs /home/node:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  --tmpfs /data:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  akcit-qa:ci node scripts/smoke-runtime.mjs    # passed
docker run … akcit-qa:ci node scripts/smoke-target.mjs      # passed
docker run … akcit-qa:ci node scripts/smoke-web.mjs         # passed
docker run … akcit-qa:ci node scripts/smoke-mapping.mjs     # passed
```

Os smokes executam na imagem final com o usuário `node` e as restrições do CI;
os resultados dos smokes na revisão T8.2-R1 estão vinculados ao SHA do candidato
em [ensaio-real.md](ensaio-real.md) e aos artefatos do CI (`mapping-smoke`,
`web-smoke`, `target-smoke`). A afirmação de execução da revisão anterior
(`14ca870`) era incorreta para `smoke-web` e `smoke-mapping`: ambos falhavam na
imagem (ver [revisao-pr29.md](revisao-pr29.md), itens 2 e 3).

## Limites aplicados

- Três produções/revisões do mapa e duas tentativas técnicas de validação por revisão.
- Cem ações de exploração por execução; capturas não consomem ações; 45 minutos
  ativos acumulados com a preparação (sem reinício a cada correção e sem contar
  espera humana); 120 s por chamada de modelo.
- Todas as chamadas de modelo e ações são registradas, com início e término;
  falhas, cancelamentos e saídas inválidas preservam o histórico.
- Uma única aba; destinos fora de `TARGET_ALLOWED_ORIGINS` bloqueados com motivo.
- Captura com a credencial visível, ou com verificação de privacidade
  indisponível, nunca é salva nem enviada ao modelo.
- Manifesto ordenado das imagens entregue ao validador; referências inventadas,
  ações com erro e aprovação contraditória de autenticação não liberam `ready`.

## Artefatos

- [mapa-sintetico.json](mapa-sintetico.json): **exemplo sintético** do mapa
  usado nos smokes com modelo substituído; não é captura real nem inferência real.
- [capturas-sinteticas/](capturas-sinteticas/): PNGs sintéticos de 1×1 px que
  simulam observações; **não são capturas reais de tela** (as capturas reais do
  smoke ficam nos artefatos do CI e não são versionadas).
- [ensaio-real.md](ensaio-real.md): registros do ensaio com inferência real
  (execuções, pareceres, chamadas, consumo e links para as evidências exportadas).

## Resultados

| Verificação | Resultado |
| --- | --- |
| `npm run check` | limpo |
| `npm test` | 195/195 aprovados |
| `npm run build` | completa (com `agents/` no contexto) |
| `smoke-mapping.mjs` (imagem final) | `passed` com 18 verificações: conta pela API, recusas sem sessão, 202/repetição 200, foco errado recusado, preenchimento privado, captura insegura bloqueada, percurso login → início → reservas → nova reserva sem criar reserva, destino bloqueado, `ready/mapping`, chamadas persistidas, evidência real servida, segredo fora da projeção, aba única com popup bloqueado, cliques em alvos pequenos, capturas sem consumo de ação e privacidade indisponível bloqueando captura |
| `smoke-web.mjs` | jornada completa: botão **Mapear aplicação**, painel do mapa, capturas por `blob:`, isolamento entre contas (404 com sessão própria), persistência após recarregar, filtro `ready` |
| `smoke-runtime.mjs` / `smoke-target.mjs` | `passed` |

## Pendências desta entrega

- Detalhar os percursos dos casos (`route_detail`).
- Executar entradas válidas/inválidas e gravar vídeos por tentativa.
- Retomada completa por esclarecimentos de navegação (sem botão de resposta ainda).
- Relatório final validado (`completed` continua reservado a ele).
