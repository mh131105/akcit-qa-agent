# Desenvolvimento

[Visão geral](../README.md) · [Documentação](README.md) · [Operação](OPERACAO.md)

## Ambiente local com Docker

Requisitos: Git e Docker Desktop/Engine com Compose 2.24 ou posterior. A imagem fixa Node.js 24.21.0, npm 12.2.0 e Pi 0.87.0. O ambiente local aceita ARM64 e AMD64.

```sh
git clone https://github.com/mh131105/akcit-qa-agent.git
cd akcit-qa-agent
git switch develop
cp .env.example .env
docker compose up --build -d --wait
```

Abra [localhost:3100](http://127.0.0.1:3100). Configure o `.env` local conforme os perfis de modelos descritos em [Operação](OPERACAO.md). Credenciais e dados privados ficam fora do Git. Salvar um rascunho não chama modelos; iniciar ou retomar etapas dos agentes faz inferências reais com a configuração do ambiente.

Edite `src/` na sua IDE; o processo de desenvolvimento reinicia ao salvar. Alterações em `package.json`, `package-lock.json` ou `Dockerfile` exigem novo build.

```sh
docker compose logs -f app
docker compose down
```

O encerramento preserva o volume. O comando `docker compose down -v` remove os dados locais.

## Verificações

```sh
docker compose exec app npm run check
docker compose exec app npm test
docker compose exec app npm run build
docker compose exec app npm run smoke:runtime
```

Os testes substituem os modelos. Os smokes de infraestrutura usam recursos reais de navegador, mas não fazem chamadas pagas de LLM. Avaliações com modelos reais são comandos separados e exigem configuração e credenciais; consulte [Operação](OPERACAO.md) antes de executá-las.

Para verificar os utilitários de publicação no host:

```sh
python3 -m unittest discover -s deploy -p 'test_*.py'
```

## Trabalhar fora do container

Use Node.js **24.21.0**, conforme `.nvmrc`, e npm **12.2.0**. Com o Node correto selecionado:

```sh
npm install --global npm@12.2.0
npm ci
npm run check
npm test
npm run dev
```

As ferramentas de tela e vídeo devem ser executadas no container Linux. O npm fixado preserva as versões do lockfile também nas dependências empacotadas pelo Pi.

## Acesso ao desenvolvimento remoto

Quando sua chave pública estiver autorizada no ambiente de desenvolvimento:

```sh
npm run dev:remote
```

Abra [localhost:3111](http://127.0.0.1:3111). O comando cria um túnel SSH restrito ao serviço de desenvolvimento. Para escolher uma chave, use `AKCIT_SSH_KEY=/caminho/da/chave npm run dev:remote`; chaves com senha precisam estar disponíveis no agente SSH. No Windows, use WSL ou Node e OpenSSH instalados.

Esse acesso não concede terminal na VPS nem acesso a produção. A autorização e a revogação de chaves são tarefas do operador, descritas em [Operação](OPERACAO.md#acesso-restrito-ao-desenvolvimento).

## Contribuição e publicação

1. Crie uma branch de trabalho a partir de `develop`.
2. Faça a alteração e atualize os documentos e exemplos afetados.
3. Execute as verificações pertinentes e abra PR para `develop`.
4. Após a integração, o workflow **Publicar desenvolvimento** constrói e verifica a imagem antes de publicar o ambiente de desenvolvimento.
5. Valide a mudança nesse ambiente e abra PR de `develop` para `main`, usando merge commit para preservar a relação entre os branches.
6. A promoção de produção é uma ação explícita do responsável. Ela reutiliza o mesmo digest da imagem e exige a mesma árvore Git validada em desenvolvimento.

A configuração de acesso remoto, os comandos operacionais e a recuperação estão em [Operação](OPERACAO.md). Preserve os identificadores existentes de pacotes, serviços, volumes e diretórios ao editar documentação; eles ainda são usados pela infraestrutura.

## Estrutura do código

| Caminho | Responsabilidade |
| --- | --- |
| `src/` | Interface, API, autenticação, persistência e coordenação. |
| `agents/` | Tools e skills de cada especialista. |
| `scripts/` | Inicialização, verificações e integração com publicação. |
| `deploy/` | Compose da VPS, publicador e utilitários operacionais. |
| `.github/workflows/` | CI, desenvolvimento e promoção de produção. |
| `test/` | Testes automatizados. |
| `docs/` | Uso, requisitos, contratos, operação e evidências. |
