#!/usr/bin/env bash
set -euo pipefail
# Apenas chaves específicas de publicação; jamais usa a chave pessoal do operador.
environment=${1:?ambiente obrigatório}
case "$environment" in
  development|production) ;;
  *) exit 2 ;;
esac
ssh_directory=$(mktemp -d)
trap 'rm -rf "$ssh_directory"' EXIT
chmod 700 "$ssh_directory"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_directory/id_ed25519"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_directory/known_hosts"
chmod 600 "$ssh_directory/id_ed25519" "$ssh_directory/known_hosts"
tree=$(git rev-parse HEAD^{tree})
if [ "$environment" = development ]; then
  command="deploy $GITHUB_SHA $tree $IMAGE_DIGEST $GITHUB_RUN_ID"
else
  command="promote $GITHUB_SHA $tree $GITHUB_RUN_ID"
fi
printf '%s\n' "$GH_TOKEN" | ssh -T -i "$ssh_directory/id_ed25519" \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$ssh_directory/known_hosts" -o ConnectTimeout=15 \
  "$DEPLOY_USER@$DEPLOY_HOST" "$command"
