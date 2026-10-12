#!/usr/bin/env bash
# O actionlint (github.com/rhysd/actionlint) sobre os workflows de .github/workflows/: a sintaxe, as expressões `${{ }}`, os
# contextos, os `needs`, os inputs e outputs dos workflows reutilizáveis, os rótulos de runner e, com o shellcheck no PATH (o
# runner Linux do GitHub tem), o shell dos `run:`. É a conferência que o check-workflows.sh não faz: aquele confere as REGRAS do
# projeto; este, que o GitHub vai entender o arquivo.
#
# O binário é o da release do actionlint, numa versão exata e conferido pelo SHA-256 ANTES de ser aberto (a soma está aqui, e não
# é lida da mesma release que o binário). Hash errado: apaga o arquivo e falha. Só Linux x64 (é onde a pipeline o roda).
# Para atualizar: a versão nova e a linha `actionlint_<versão>_linux_amd64.tar.gz` do `actionlint_<versão>_checksums.txt` dela.
#
# Uma exceção, e só uma: a chave `queue` do `concurrency`. Ela existe no GitHub Actions desde 2026-05 (documentação de
# concorrência: `queue: max` guarda até 100 execuções na fila em vez de cancelar a que espera), e o actionlint 1.7.12 ainda não a
# conhece. A exceção casa só com essa mensagem.
#
# Uso: bash scripts/ci/actionlint.sh            (precisa de curl, tar e sha256sum; baixa o binário uma vez em PRISM_CI_TOOLS)
set -euo pipefail

version=1.7.12
sha256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"

[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || { echo "actionlint: o binário fixado aqui é o de Linux x64." >&2; exit 2; }
dir=${PRISM_CI_TOOLS:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/prism-ci-tools}/actionlint-$version
archive=actionlint_${version}_linux_amd64.tar.gz
if [ ! -x "$dir/actionlint" ]; then
  mkdir -p "$dir"
  curl -q --fail --silent --show-error --location --retry 3 --proto '=https' --output "$dir/$archive" "https://github.com/rhysd/actionlint/releases/download/v$version/$archive"
  actual=$(sha256sum "$dir/$archive" | cut -d ' ' -f 1)
  if [ "$actual" != "$sha256" ]; then
    rm -f "$dir/$archive"
    echo "actionlint: o SHA-256 do $archive não confere; não vou usá-lo." >&2
    exit 1
  fi
  tar -xzf "$dir/$archive" -C "$dir" actionlint
  rm -f "$dir/$archive"
fi

"$dir/actionlint" -version | head -n 1
"$dir/actionlint" -no-color -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/*.yml
echo "actionlint: os workflows passaram."
