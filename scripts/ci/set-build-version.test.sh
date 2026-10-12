#!/usr/bin/env bash
# Testes do set-build-version.sh, numa cópia do script com um package.json de mentira.
# Rode com `bash scripts/ci/set-build-version.test.sh`; sai com 1 se algum caso falhar.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/scripts/ci" "$work/src/client"
cp "$here/set-build-version.sh" "$here/version.sh" "$work/scripts/ci/"

total=0
failures=0

reset() {
  printf '{\n  "name": "prism-client",\n  "version": "0.2.0",\n  "private": true,\n  "devDependencies": {\n    "version": "0.2.0"\n  }\n}\n' > "$work/src/client/package.json"
}

# case <descrição> <código esperado> <versão do package.json depois> <argumentos...>
case_() {
  local description=$1 want=$2 after=$3 code=0 got
  shift 3
  reset
  out=$(cd "$work" && bash scripts/ci/set-build-version.sh "$@" 2>&1) || code=$?
  got=$(sed -n 's/^  "version": "\([^"]*\)".*$/\1/p' "$work/src/client/package.json" | head -n 1)
  total=$((total + 1))
  if [ "$code" -eq "$want" ] && [ "$got" = "$after" ] && grep -q '^    "version": "0.2.0"' "$work/src/client/package.json"; then
    echo "ok   $total - $description"
  else
    failures=$((failures + 1))
    echo "FALHA $total - $description: saiu com $code (esperava $want), version ficou \"$got\" (esperava \"$after\")"
    printf '%s\n' "$out" | sed 's/^/       | /'
  fi
}

case_ "o beta da versão do package.json é gravado, e só no campo do primeiro nível" 0 0.2.0-beta.3 0.2.0-beta.3
case_ "a própria versão do package.json não muda nada" 0 0.2.0 0.2.0
case_ "o beta de OUTRA versão é recusado, e o package.json não muda" 1 0.2.0 0.3.0-beta.1
case_ "outra versão estável é recusada" 1 0.2.0 0.2.1
for hostile in "0.2.0-beta.01" "0.2.0-beta" "0.2.0;id" '0.2.0-beta.1$(id)' "0.2.0-beta.1/x" "v0.2.0-beta.1" "0.2.0-beta.1 "; do
  case_ "a versão \"$hostile\" é recusada pelo formato, e o package.json não muda" 1 0.2.0 "$hostile"
done
case_ "sem argumento é erro de uso" 2 0.2.0
case_ "argumento vazio é erro de uso" 2 0.2.0 ""

echo
echo "$((total - failures)) de $total casos passaram."
[ "$failures" -eq 0 ]
