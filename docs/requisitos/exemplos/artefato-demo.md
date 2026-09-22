# Artefato sintético: reservar itens

Documento inventado para integrar o protótipo. Não pertence a um cliente.
Versão: demo-v1. Os resultados do JSON associado também são simulados.

## US-01

Como usuário autenticado, quero reservar itens para informar a quantidade desejada.

## CA-01

A quantidade deve ser um número inteiro entre 1 e 10, inclusive. Ao confirmar uma
quantidade válida, o sistema deve mostrar “Reserva criada”. Para quantidades fora
desse intervalo ou não inteiras, o sistema deve mostrar “Quantidade inválida” e não
criar a reserva.

## CA-02

O comentário é opcional. Quando informado, deve ser salvo junto à reserva.

## Percurso sugerido para a aplicação controlada

Após o login, a página inicial oferece “Reservas”. A tela de reservas oferece
“Nova reserva”. O formulário apresenta quantidade, comentário e “Confirmar”.
O agente ainda precisa observar e registrar esse percurso no navegador real.
