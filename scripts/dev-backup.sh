#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Defina DATABASE_URL apontando exclusivamente para o banco de desenvolvimento}"
: "${DEV_BACKUP_DIR:=./var/dev-backups}"
: "${DEV_BACKUP_RETENTION_DAYS:=30}"

if [[ "${NODE_ENV:-development}" == "production" || "${ALLOW_DEV_BACKUP_ON_PRODUCTION:-false}" != "true" && "${DATABASE_URL}" == *"railway"* && "${DATABASE_URL}" == *"production"* ]]; then
  echo 'ERRO: backup de desenvolvimento recusado para ambiente potencialmente produtivo.' >&2
  exit 20
fi
mkdir -p "$DEV_BACKUP_DIR"
chmod 700 "$DEV_BACKUP_DIR"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
raw="$workdir/abiatar-dev-$timestamp.dump"
final="$DEV_BACKUP_DIR/abiatar-dev-$timestamp.dump"
manifest="$final.sha256"
metadata="$final.json"

pg_dump "$DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --file="$raw"
if [[ -n "${DEV_BACKUP_PASSPHRASE:-}" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:DEV_BACKUP_PASSPHRASE -in "$raw" -out "$final.enc"
  rm -f "$raw"
  final="$final.enc"
else
  echo 'AVISO: DEV_BACKUP_PASSPHRASE não definida; o backup será apenas protegido por permissões locais.' >&2
  mv "$raw" "$final"
fi
chmod 600 "$final"
sha256sum "$final" > "$manifest"
chmod 600 "$manifest"
cat > "$metadata" <<JSON
{
  "environment": "development",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": "$(basename "$final")",
  "encrypted": $([[ "$final" == *.enc ]] && echo true || echo false),
  "database_host": "$(python3 -c 'from urllib.parse import urlparse; import os; print(urlparse(os.environ["DATABASE_URL"]).hostname or "unknown")')",
  "retention_days": $DEV_BACKUP_RETENTION_DAYS
}
JSON
chmod 600 "$metadata"
find "$DEV_BACKUP_DIR" -type f -name 'abiatar-dev-*' -mtime "+$DEV_BACKUP_RETENTION_DAYS" -delete
printf 'Backup criado: %s\nManifesto: %s\n' "$final" "$manifest"
