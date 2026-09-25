# Evidências T8.2 — Mapeamento visual validado

Branch: `feat/validated-navigation-map` · Base: `develop` (`73063ac`).
Vínculos: [T8 #11](https://github.com/mh131105/akcit-qa-agent/issues/11) e
[T10 #14](https://github.com/mh131105/akcit-qa-agent/issues/14) — **nenhuma das
duas é encerrada por esta entrega**.

## Dois tipos de evidência

| Tipo | Onde roda | Modelo | Objetivo |
| --- | --- | --- | --- |
| **Smoke** | imagem final (CI, container com Xvfb/Chromium/xdotool) | substituído por roteiro, identificado como simulação | provar integração de navegador, cursor, capturas, destinos e interface reais |
| **Ensaio real** | ambiente operado (local/VPS com Pi autenticado) | `deepseek/deepseek-flash` `high` para executor e validador visual | avaliar a qualidade da navegação escolhida pelo modelo |

Nada nesta pasta comprova o ensaio com modelo real; os arquivos abaixo são
sintéticos e sanitizados (sem credenciais, sem conteúdo de usuários).

## Configuração

- Executor visual: `PI_EXECUTOR_PROVIDER=deepseek`, `PI_EXECUTOR_MODEL=deepseek-flash`, `PI_EXECUTOR_THINKING_LEVEL=high`.
- Validador visual: `PI_VALIDATOR_VISUAL_PROVIDER=deepseek`, `PI_VALIDATOR_VISUAL_MODEL=deepseek-flash`, `PI_VALIDATOR_VISUAL_THINKING_LEVEL=high`.
- Validador textual: inalterado (Pro/high).
- Alvo T7: `node scripts/demo-target.mjs` em `http://127.0.0.1:4000`, credenciais `demo`/`demo1234`.

## Comandos executados

```bash
npm run check
npm test          # 176/176, incluindo test/navigation.test.ts (10 novos)
npm run build
node scripts/smoke-mapping.mjs   # na imagem final: navegador/cursor/capturas/destinos reais
node scripts/smoke-web.mjs       # jornada do site até a consulta do mapa e das capturas
```

## Limites aplicados

- Três produções/revisões do mapa e duas tentativas técnicas de validação por revisão.
- Cem ações de exploração por execução; 45 minutos ativos acumulados com a
  preparação (sem reinício a cada correção); 120 s por chamada de modelo.
- Todas as chamadas de modelo e ações são registradas (não apenas a resposta final).
- Uma única aba; destinos fora de `TARGET_ALLOWED_ORIGINS` bloqueados com motivo.
- Captura de tela de login com a credencial digitada visível não é enviada ao
  modelo nem persistida.

## Artefatos

- [mapa-sintetico.json](mapa-sintetico.json): mapa sanitizado usado na avaliação
  (smoke com modelo substituído), com os pareceres do validador.
- [capturas-sinteticas/](capturas-sinteticas/): PNGs sintéticos de 1×1 px que
  simulam as observações referenciadas; **não são capturas reais de tela** (as
  capturas reais do smoke ficam nos artefatos do CI e não são versionadas).

## Resultados

| Verificação | Resultado |
| --- | --- |
| `npm run check` | limpo |
| `npm test` | 176/176 aprovados |
| `npm run build` | completa |
| `smoke-mapping.mjs` (imagem final) | `passed`: observação de login e da área autenticada, cursor/clique reais, preenchimento privado de credencial, destino bloqueado com motivo, 202/repetição 200, `ready/mapping`, captura real servida pela rota de evidência, segredo fora da projeção |
| `smoke-web.mjs` | jornada completa: botão **Mapear aplicação**, painel do mapa, capturas por `blob:`, isolamento entre contas, persistência após recarregar, filtro `ready` |

## Pendências desta entrega (fora do escopo)

- Detalhar os percursos dos casos (`route_detail`).
- Executar entradas válidas/inválidas e gravar vídeos por tentativa.
- Retomada completa por esclarecimentos de navegação (sem botão de resposta ainda).
- Relatório final validado (`completed` continua reservado a ele).
- Ensaio com modelo real: deve ser executado no ambiente operado com o gabarito
  fora do contexto dos agentes (conferir cada transição declarada e um parecer do
  validador com transição deliberadamente sem suporte).
