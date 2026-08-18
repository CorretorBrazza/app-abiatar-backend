#!/usr/bin/env bash
set -Eeuo pipefail
backup="${1:?Uso: $0 arquivo.dump[.enc]}"
[[ -f "$backup" ]] || { echo "Backup não encontrado: $backup" >&2; exit 22; }
[[ -f "$backup.sha256" ]] || { echo "Manifesto não encontrado: $backup.sha256" >&2; exit 23; }
sha256sum --check "$backup.sha256"
if [[ "$backup" != *.enc ]]; then
  pg_restore --list "$backup" >/dev/null
else
  echo 'Cópia criptografada: checksum validado; defina passphrase e use dev-restore.sh para validar o conteúdo.'
fi
printf 'Backup íntegro: %s\n' "$backup"
