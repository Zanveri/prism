#!/usr/bin/env bash
# Roda os testes dos scripts desta pasta (todo arquivo *.test.sh). É o que a pipeline chama na etapa `verificar`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

status=0
for test in ./*.test.sh; do
  echo "== $test"
  bash "$test" || status=1
done
exit "$status"
