# Identidade QAtron

O produto se chama **QAtron**. A marca sugere um percurso contínuo de teste: uma
fita verde forma um Q aberto, com um ponto de chegada verde-lima. A assinatura é
“Testes com evidências”.

- [Símbolo gerado](../../src/web/qatron-mark.png): imagem criada com a ferramenta
  integrada ImageGen, sobre fundo creme, usada no cabeçalho, login e favicon.
- [Prompt de geração](imagegen-prompt.md): especificação da imagem selecionada.
- Cores: verde escuro `#214d43`, texto `#183c36`, verde-lima `#d7edaa`, creme `#f5f4ef` e superfície `#fffefa`. A repaginação preserva a paleta escolhida para o workspace.
- Tipografia: Inter quando instalada, com Avenir Next, Avenir, Segoe UI e sans-serif como alternativas locais.

O cabeçalho combina o PNG local com o nome em texto HTML, sem carregar recursos
externos. Preserve a proporção da imagem e a grafia **QAtron**. Os SVGs anteriores
foram substituídos por esta identidade.
O nome do repositório, pacotes, variáveis e referências históricas permanece igual.

## Interface

O design system fornecido orienta as superfícies, a escala tipográfica, o
espaçamento, as ações em pílula e os estados de interação. Seus componentes e
conteúdos específicos do Studio não são incorporados ao produto. Os tokens
semânticos estão centralizados em `src/web/styles.css`; a aparência é sempre clara,
independentemente da preferência de tema do dispositivo.

A navegação fica na lateral a partir de 960px e no topo em telas menores. As abas
da execução podem ser abertas diretamente por `#visao-geral`, `#plano`, `#casos`,
`#mapa` e `#resultados`. Trocar de aba preserva os formulários montados e não
inicia operações. Setas, Home e End movem o foco; Enter ou Espaço ativam a aba.

O login apresenta o percurso requisitos → plano → evidências. A entrada dos
elementos tem animação finita; botões e linhas respondem ao foco e ao ponteiro.
O indicador de carregamento só gira durante o envio. Todos os movimentos são
desativados com `prefers-reduced-motion: reduce`.

O controle de senha alterna a visibilidade sem alterar o valor. Alternar entre
entrada e cadastro mantém o e-mail apenas em memória e limpa a senha; selecionar
o modo já ativo preserva o formulário. Não há persistência nova de credenciais.
