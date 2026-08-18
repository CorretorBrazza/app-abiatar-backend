#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Defina DATABASE_URL apontando exclusivamente para o banco de desenvolvimento}"
backup="${1:?Uso: DEV_RESTORE_CONFIRM=YES $0 arquivo.dump[.enc]}"

if [[ "${NODE_ENV:-development}" == "production" || "${DEV_RESTORE_CONFIRM:-}" != "YES" ]]; then
  echo 'ERRO: restauração exige ambiente não produtivo e DEV_RESTORE_CONFIRM=YES.' >&2
  exit 21
fi
if [[ ! -f "$backup" ]]; then echo "ERRO: backup não encontrado: $backup" >&2; exit 22; fi
if [[ -f "$backup.sha256" ]]; then sha256sum --check "$backup.sha256"; fi
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
input="$backup"
if [[ "$backup" == *.enc ]]; then
  : "${DEV_BACKUP_PASSPHRASE:?Defina DEV_BACKUP_PASSPHRASE para restaurar cópia criptografada}"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass env:DEV_BACKUP_PASSPHRASE -in "$backup" -out "$workdir/restore.dump"
  input="$workdir/restore.dump"
fi
pg_restore "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$input"
printf 'Restauração de desenvolvimento concluída e checksum validado: %s\n' "$backup"
