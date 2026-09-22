#!/usr/bin/env bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd)
environment=${1:?Use development ou production}
case "$environment" in
  development) project=akcit-qa-dev ;;
  production) project=akcit-qa-prod ;;
  *) exit 2 ;;
esac
mkdir -p "$root/backups"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$root/backups/$environment-$stamp"
mkdir "$destination"
compose=(docker compose -p "$project" --env-file "$root/$environment/current.env" -f "$root/ops/compose.yml")
container=$("${compose[@]}" ps -q app)
test -n "$container"
image=$(docker inspect --format '{{.Image}}' "$container")
trap '"${compose[@]}" start >/dev/null' EXIT
"${compose[@]}" stop -t 30 app
docker run --rm --network none --read-only --cap-drop ALL \
  -v "${project}_app_data:/source:ro" --entrypoint tar "$image" -C /source -czf - . > "$destination/data.tar.gz"
cp "$root/$environment/current.env" "$root/$environment/release.json" "$destination/"
tar -tzf "$destination/data.tar.gz" > /dev/null
echo "Backup criado: $destination"
