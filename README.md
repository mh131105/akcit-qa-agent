# AKCIT QA Agent

Base de desenvolvimento para um sistema de testes caixa preta com Pi, um
orquestrador e quatro especialistas: curadoria, planejamento, execução e relatório.
O produto e sua metodologia ainda serão implementados a partir dos RF, RN, RG e US.

**Equipe: comecem pelo [guia de desenvolvimento da sprint](docs/requisitos/README.md).**
Ele reúne o escopo proposto para 26/09, os contratos, a divisão de trabalho e os
critérios para considerar o protótipo pronto.

## Começar na própria máquina

Requisitos: Git e Docker Desktop/Engine com Compose 2.24 ou posterior. O container
instala Node.js 24, Pi 0.87.0 e as dependências; não é preciso instalá-los no host.
Há suporte às arquiteturas ARM64 (Mac Apple Silicon) e AMD64 (Linux/Windows).

```sh
git clone git@github.com:mh131105/akcit-qa-agent.git
cd akcit-qa-agent
git switch develop
cp .env.example .env
docker compose up --build -d --wait
```

Abra http://127.0.0.1:3100. Edite `src/` na sua IDE; o processo reinicia ao salvar.
Mudanças no package.json/package-lock.json ou Dockerfile exigem novo build.

```sh
docker compose exec app npm run check
docker compose exec app npm test
docker compose exec app npm run build
docker compose exec app npm run smoke:runtime
docker compose exec app pi --version
docker compose logs -f app
docker compose down
```

O último comando preserva o volume. `docker compose down -v` **apaga os dados locais**.
Para trabalhar fora do container: Node.js 24, `npm ci`, `npm run dev`. As ferramentas
de tela e vídeo devem ser executadas no container Linux.

## Fluxo da equipe

1. Aceite o convite ao repositório privado.
2. Crie uma branch a partir de `develop`: `git switch -c feat/nome-da-mudanca`.
3. Faça commits e abra PR para `develop`. CI verifica tipos, testes e o runtime Docker.
4. Após revisão, integre o PR. O workflow **Publicar desenvolvimento** constrói uma
   imagem, testa Pi/navegador/cursor/vídeo e publica o ambiente remoto.
5. Valide a mudança no ambiente de desenvolvimento.
6. Abra PR de `develop` para `main`. Use **Create a merge commit** nesta promoção
   para preservar a relação entre os branches; evite squash nesse PR de release.
7. O responsável (`mh131105`) executa **Promover produção → Run workflow → main**.
   O servidor só aceita a mesma árvore Git da versão que passou em desenvolvimento
   e utiliza o mesmo digest da imagem, sem reconstruí-la.

O plano GitHub Free em repositório privado não permite exigir revisões/proteção de
branches como em planos pagos. A revisão de PR é uma convenção da equipe nesta fase.
O publicador confere branch, commit, workflow e identidade do responsável pela
promoção, mas administradores e pessoas com acesso ao servidor continuam sendo
operadores de confiança. Nunca use a chave pessoal da VPS como secret do GitHub.

## Acessar desenvolvimento remoto sem domínio

Para integrantes com chave pública autorizada, use Node.js 24 na máquina local:

```sh
npm run dev:remote
```

Abra http://127.0.0.1:3111. O comando cria um canal criptografado por SSH até a
aplicação; a chave não permite executar comandos nem acessar produção ou outros
serviços. Use `AKCIT_SSH_KEY=/caminho/da/chave npm run dev:remote` para escolher uma
chave, ou carregue sua chave no agente SSH. Chaves com senha precisam do `ssh-agent`.
No Windows, execute pelo WSL ou com Node e OpenSSH disponíveis.

O responsável já tem acesso administrativo e pode usar o túnel convencional:

```sh
ssh -N -L 3111:127.0.0.1:3101 -L 3112:127.0.0.1:3102 matheus@76.13.175.64
```

Desenvolvimento: http://127.0.0.1:3111. Produção: http://127.0.0.1:3112.
O domínio e HTTPS público serão conectados ao Traefik quando a equipe os fornecer.

## Estrutura

- `src/`: servidor inicial, configuração e fábrica de sessões do Pi.
- `agents/`: diretórios de tools e skills de cada especialista.
- `scripts/`: inicialização, verificação de runtime e integração com publicação.
- `deploy/`: Compose da VPS e publicador com comandos restritos.
- `.github/workflows/`: CI, desenvolvimento e promoção de produção.
- `docs/requisitos/`: espaço para os RF, RN, RG e US.
- `docs/OPERACAO.md`: limites, dados, segredos, backup e recuperação.
- `docs/EQUIPE.md`: convites e acesso temporário da equipe ao desenvolvimento.

O runtime não inicia chamadas de LLM. A equipe definirá o provedor e o modelo e
configurará credenciais no ambiente correspondente ao implementar os agentes.
Os testes de infraestrutura não consomem tokens de provedores.
