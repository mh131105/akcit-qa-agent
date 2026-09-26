# T7 — Gabarito humano da aplicação controlada

> **ATENÇÃO:** Este arquivo NÃO deve ser disponibilizado ao agente.
> Não deve compor o contexto de nenhum agente, prompt ou skill.
> Serve exclusivamente para avaliação humana.

## Requisitos testados

Fonte: [artefato-demo.md](/docs/requisitos/exemplos/artefato-demo.md)

- **US-01 / CA-01:** Quantidade inteira entre 1 e 10, inclusive.
  Válida → "Reserva criada". Fora do intervalo ou não inteira → "Quantidade inválida", sem criar reserva.
- **US-01 / CA-02:** Comentário opcional. Quando informado, deve ser salvo.

## Matriz de resultados esperados

| Entrada (qty) | Modo `reference` | Modo `known-defect` |
|---|---|---|
| `1` | ✅ Reserva criada | ✅ Reserva criada |
| `2` | ✅ Reserva criada | ✅ Reserva criada |
| `9` | ✅ Reserva criada | ✅ Reserva criada |
| `10` | ✅ Reserva criada | ❌ Quantidade inválida (defeito) |
| `0` | ❌ Quantidade inválida | ❌ Quantidade inválida |
| `11` | ❌ Quantidade inválida | ❌ Quantidade inválida |
| `1.5` | ❌ Quantidade inválida | ❌ Quantidade inválida |
| (vazio) | ❌ Quantidade inválida | ❌ Quantidade inválida |
| Qty válida, comentário vazio | ✅ Reserva criada, comentário vazio | ✅ Reserva criada, comentário vazio |
| Qty válida, comentário preenchido | ✅ Preserva comentário | ✅ Preserva comentário |

## Defeito conhecido

**Localização:** `scripts/demo-target.mjs`, função `validateQty`.

**Comportamento:** No modo `known-defect`, a quantidade `10` é rejeitada com
"Quantidade inválida", embora o requisito CA-01 defina que o intervalo válido é
de 1 a 10 inclusive.

**Causa:** Condição adicional `if (MODE === 'known-defect' && n === 10)` retorna
erro de validação antes de aceitar o valor.

**Observação:** Esse é o único defeito. Todos os demais comportamentos são
idênticos entre os dois modos.
