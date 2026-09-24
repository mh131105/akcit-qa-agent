# Validação final de 069a5e7

Commit: 069a5e716a581295e17b257b5de52a2cb932cbae. Node 24.21.0; Chromium 153.0.8010.52. Verificação por agente, sem aprovação humana externa. Nenhuma alteração de código, acesso a .env/.data ou inferência de modelo nesta verificação.

| Verificação | Resultado | Duração de processo |
| --- | --- | --- |
| check | aprovado | 1.068 s |
| test | aprovado — 87/87 | 4.656 s |
| build | aprovado | 0.871 s |
| operational | aprovado — 6/6 | 0.123 s |
| Docker build | aprovado | 1.632 s |
| Docker smoke runtime | aprovado | 5.235 s (4.245 s interno) |
| Docker smoke web | aprovado — 24 verificações | 19.984 s (19.008 s interno) |

Imagem: akcit-qa:t41-oauth. ID/digest: sha256:4bfed495bb5cf4668b78b9d68b776c17a540bdda3c335c756ba4bb40b55d96a2. SHA-256 combinado dos arquivos rastreados usados pelo build: 1d4f356bea04144286a9a2f453650bbb423c08c7c750aa413b12797d50d60b89; reconferido ao final, sem alterações. Containers com CPU=1, memória=2GiB, shm=512MiB, rootfs somente leitura, cap-drop=ALL, no-new-privileges e tmpfs separados para /data e /home/node; nenhuma credencial montada.

Ambos os smokes desta versão passaram na primeira execução. Os resultados anteriores, inclusive a falha intermitente do cenário legado de sessão/login antes desta revisão, continuam preservados no diretório pai. A mudança metodológica de oito linhas está coerente com RN-04 do PROTOTIPO.md. A avaliação com modelo real permanece sob responsabilidade da tarefa principal.
