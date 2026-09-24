# Evidências sintéticas — T2.1

Jornada executada em 23/09/2026 com navegador Chromium, API HTTP e arquivos
temporários reais. As contas, nomes, textos e planos são fictícios. Nenhuma
sessão, senha ou informação de participante foi incluída nos artefatos.

- [Resultado do smoke](web-result.json): 21 verificações aprovadas no runtime,
  Node.js 24.21.0 e Chromium 153.0.8010.52.
- [Histórico desktop, 1366 px](web-desktop.png).
- [Histórico celular, 390 px](web-mobile.png).
- [Formulário celular, 390 px](web-mobile-form.png).
- [Consulta e revisão do plano, 1366 px](web-plan.png).

O texto com aparência de HTML nas capturas é deliberado: demonstra renderização
literal. Planos e pareceres são preparados exclusivamente no armazenamento
temporário do teste. A execução marcada como concluída é um estado sintético
usado para conferir que a tela não afirma espera indevida. Estas evidências não
comprovam curadoria, geração por IA ou execução de agentes.

O smoke confirma criação e reencontro, logout/login, perda de resposta depois da
gravação, repetição com o mesmo corpo/chave sem duplicar, isolamento entre contas,
decisões persistidas da revisão exata, conflito e revisão desatualizada. Também
confere clique duplo, foco pelo teclado, JSON acima do limite e armazenamento
local indisponível sem POST. A inspeção visual conferiu legibilidade nos dois
tamanhos.

Verificações adicionais aprovadas: `npm run check`, `npm test` (59 testes,
preservando os 55 anteriores) e `npm run build` com Node.js 24.19.0; seis testes
Python de deploy e
smoke de infraestrutura no mesmo runtime (Pi CLI/SDK isolado, leitura PDF,
Chromium com janela, clique real, captura e vídeo). Os containers usaram CPU 1,
memória 2 GiB, sistema de arquivos somente leitura e os tmpfs dos workflows.

## Regressões de BUG-T2.1-01

Correção em [`fe61190`](https://github.com/mh131105/akcit-qa-agent/commit/fe6119096f056076e07eb9d05aa9f941422780b6),
no PR #21. Os cenários foram acrescentados antes da correção e executados contra
a imagem anterior, identificada pelo commit `fa91ad2`, e contra a imagem corrigida.

| Cenário | Resultado anterior | Resultado corrigido |
| --- | --- | --- |
| Duas abas, `/auth/me` de A atrasado, login B, envio original de A | `201`: material salvo para B | `409 / ACCOUNT_CHANGED`; nenhum rascunho novo para B; A recupera conta, chave e corpo originais |
| Criação persistida com resposta perdida, seguida de logout `503` | Tentativa local apagada | Tentativa idêntica após reload; repetição encontra a execução original |
| Decisão falha antes da gravação e reconsulta reconstrói o formulário | Comentário vazio | Texto literal, incluindo espaços e quebras, restaurado; só nova ação explícita envia POST |

Também verificados no mesmo smoke:

- Logout com falha de rede e com resposta perdida após `204`: a recuperação
  permanece; sessão inválida retira o material da tela; novo login da conta
  original permite reencontrar a mesma execução.
- Logout confirmado: limpa tentativa pendente e formulário ainda não enviado,
  sem regravação por `pagehide`. Falha de limpeza local após `204` informa o
  problema e mantém a saída confirmada, sem tela privada, mesmo quando a
  consulta de sessão na página de acesso também falha por rede.
- Resposta de decisão perdida após persistir: a consulta encontra uma única
  decisão, com comentário literal, sem novo POST ou cópia pendente redundante.
- Falha na consulta de recuperação: “Tentar novamente” conserva o comentário.
  Conflito conserva a cópia também após “Atualizar consulta”, falha e nova tentativa.
- Revisão nova: o comentário antigo permanece somente para leitura/cópia,
  identificado pela revisão original; o campo da nova revisão continua vazio.

As quatro regressões HTTP adicionais cobrem ausência, formato inválido,
duplicidade e divergência do cabeçalho em consultas, criação, decisões e logout.
A divergência não acessa o armazenamento, não altera registros e não encerra B.
Os helpers usam IDs capturados em cadastro/login, sem substituí-los por `/auth/me`.

`web-result.json` foi copiado diretamente da saída do smoke na imagem final,
sem edição manual. As capturas existentes continuam documentando a interface
inicial; os cenários novos são descritos no resultado gerado. Este recorte do
comentário cobre somente a página atual, sem recuperação após fechar/recarregar
completamente a aba. T2.1 aguarda nova revisão da frente B e merge; T2 #5 segue aberta.

Para executar um grupo isolado, defina `SMOKE_REGRESSION=account`, `logout` ou
`comment` no comando do smoke; sem essa variável, todos os cenários são executados.

Para reproduzir, siga os comandos de [OPERACAO.md](../../OPERACAO.md#jornada-pelo-navegador--t21).
O workflow de CI também publica novas capturas no artefato `web-smoke`.
