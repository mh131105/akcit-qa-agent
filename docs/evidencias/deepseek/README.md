# Integração DeepSeek — 24/09/2026

Material sintético, inferências reais. A entrada descreve uma reserva com quantidade
inteira entre 1 e 3, mensagens de aceitação/rejeição e ausência de reserva para
valores inválidos. Não foram fornecidos percurso, gabarito ou resultados ao agente.

O coordenador real executou curadoria (Flash com raciocínio baixo), validação,
plano, validação, casos e validação (Pro com raciocínio alto). A aprovação do plano
foi simulada pelo roteiro técnico, em armazenamento isolado; não representa uma
decisão humana nem altera execuções de usuários. Não houve teste no navegador alvo.

Resultado: `awaiting_approval/case_design`, seis chamadas em 132,154 segundos,
30.011 tokens informados e seis casos: 1, 2 e 3 válidos; 0 e 4 fora do intervalo;
1,5 não inteiro. As três saídas receberam parecer `approved` na primeira revisão.
Fontes, técnicas e expectativas estão preservadas no [registro](resultado.json).
Todos os percursos permanecem `null`, como exige esta etapa.

Estimativa agregada do catálogo Pi: US$ 0,061963484. Não é cobrança confirmada.
Uma execução pequena demonstra integração e não permite concluir superioridade
de modelo nem eficácia geral do validador. A revisão humana metodológica continua
separada desta verificação técnica.

Verificações locais: `npm run check` e 128 testes automatizados aprovados, incluindo
seleção de raciocínio por modelo, isolamento de sessões e preservação dos demais
provedores. O CI verifica também a imagem e o smoke web sem inferência paga.

Para reproduzir: configurar os pares e a chave conforme `docs/OPERACAO.md`, criar
uma execução com o texto de `input[0].text`, preparar o plano, revisar/aprovar sua
versão e acionar a geração dos casos. Usar armazenamento próprio para cada ensaio.
Registrar versões, modelos, tempo, consumo e pareceres; não comitar credenciais.

## Configuração explícita de raciocínio (thinkingLevel) e padronização da distribuição — 24/09/2026

Registro da refatoração técnica que tornou o nível de raciocínio (`thinkingLevel`) explicitamente configurável no protótipo, integrando `off`, `low` e `high` ao runtime do Pi, à validação do ambiente (`src/config.ts`) e à persistência das chamadas (`src/storage/runs.ts` e `src/application/prepare-plan.ts`).

### Comandos executados e verificação

Executados localmente com Node.js 24:

```sh
npm run check
npm test
```

Resultados:
- `npm run check`: TypeScript verificado com zero erros.
- `npm test`: **130 testes aprovados** (0 falhas), cobrindo configuração explícita, recusa imediata de níveis inválidos, suporte a Flash com níveis diferentes (`low`, `high`, `off`), nível aplicado à sessão Pi, encaminhamento na preparação, persistência em `PreparationCall`, leitura retrocompatível de registros legados sem campos presumidos e entrega de Pro/high para projetista e validador na geração de casos.
- Todos os testes automatizados operam sem inferência paga, com mocks controlados e isolamento em diretórios temporários.

O registro histórico de inferência real em [resultado.json](resultado.json) permanece integralmente preservado.

> **Ressalva factual:** A execução existente comprova a integração técnica da preparação textual; ainda não comprova a qualidade do navegador, do relatório ou da validação visual, nem superioridade entre modelos.
