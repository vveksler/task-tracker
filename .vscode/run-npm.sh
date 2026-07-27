#!/usr/bin/env zsh
# Cursor/VS Code GUI apps don't load ~/.zshrc, so nvm isn't on PATH.
# This wrapper loads nvm (and the nearest .nvmrc) before forwarding to npm.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "nvm not found at $NVM_DIR/nvm.sh" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"

# Walk up from cwd to find the project's .nvmrc (repo root).
nvmrc=""
dir="$PWD"
while [[ "$dir" != "/" ]]; do
  if [[ -f "$dir/.nvmrc" ]]; then
    nvmrc="$dir/.nvmrc"
    break
  fi
  dir="${dir:h}"
done

if [[ -n "$nvmrc" ]]; then
  nvm use "$(<"$nvmrc")" --silent
else
  nvm use default --silent
fi

exec npm "$@"
