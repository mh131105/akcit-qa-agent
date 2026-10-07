# Identidade QAtron

O produto passa a se chamar **QAtron**. A marca combina a letra Q com um sinal de
verificação: testes acompanhados de evidências. A assinatura é “Testes com evidências”.

- [Logo horizontal](qatron-logo.svg): símbolo e nome em fundo transparente.
- [Símbolo](qatron-mark.svg): versão compacta, usada a 40 × 40 px no app.
- Cores: verde escuro `#214d43`, texto `#183c36`, verde-lima `#d7edaa`, creme `#f5f4ef` e superfície `#fffefa`. A repaginação preserva a paleta escolhida para o workspace.
- Tipografia: Inter quando instalada, com Avenir Next, Avenir, Segoe UI e sans-serif como alternativas locais.

O cabeçalho usa o mesmo símbolo como SVG inline em `src/web/index.html`, sem
carregar recursos externos. Preserve a proporção dos SVGs e a grafia **QAtron**.
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
