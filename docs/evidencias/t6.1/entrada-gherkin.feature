Funcionalidade: Reserva de itens
  Cenário: Solicitação de cinco itens
    Dado um item disponível para reserva
    Quando solicito a reserva de 5 unidades desse item
    Então uma reserva de 5 unidades é registrada
    E recebo a mensagem "Reserva confirmada"
