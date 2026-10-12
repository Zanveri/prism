#!/usr/bin/env bash
# O segundo passo das actions compostas preparar-node e preparar-dotnet (.github/actions/): confere que a ferramenta que a
# action do GitHub instalou é a da versão fixada, e fixa o que precisa ser fixado.
#  node <versão>     o `node` do PATH é essa versão, e o pnpm sai pelo corepack na versão do campo `packageManager` de
#                    src/client/package.json, com o hash SHA-512 que está lá (o corepack recusa um pnpm que não bata com ele).
#                    O pnpm não tem versão em outro lugar: trocá-lo é mudar aquele campo e o arquivo de trava.
#  dotnet <versão>   grava um global.json na raiz da CÓPIA de trabalho, com a versão exata e `rollForward: disable`, e confere
#                    que o `dotnet` passa a ser ela. Sem isso o `dotnet` usaria o SDK MAIS NOVO instalado no runner, e não o que a
#                    action instalou (a documentação do setup-dotnet avisa). O arquivo não é versionado: só existe no runner.
# Uso: bash scripts/ci/check-tools.sh node 22.23.2 | dotnet 10.0.401
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

fail() {
  echo "check-tools: $1" >&2
  exit 1
}

[ $# -eq 2 ] || { echo "Uso: check-tools.sh node|dotnet <versão>" >&2; exit 2; }
tool=$1
wanted=$2
[[ "$wanted" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "a versão \"$wanted\" não é X.Y.Z."

case "$tool" in
  node)
    got=$(node --version) || fail "o node não está no PATH."
    [ "$got" = "v$wanted" ] || fail "o node do PATH é o $got, e a versão fixada é a v$wanted."
    manager=$(sed -n 's/^  "packageManager": "\([^"]*\)".*$/\1/p' src/client/package.json | head -n 1)
    [[ "$manager" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+\+sha512\.[0-9a-f]{128}$ ]] || fail "o campo packageManager de src/client/package.json não é pnpm@X.Y.Z+sha512.<hash>: sem o hash, o corepack não confere o pnpm que baixa."
    pnpm=$(cd src/client && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --version) || fail "o corepack não entregou o pnpm do packageManager (o hash não bateu, ou o registro do npm não respondeu)."
    [ "pnpm@$pnpm" = "${manager%%+*}" ] || fail "o corepack entregou o pnpm $pnpm, e o packageManager pede ${manager%%+*}."
    echo "check-tools: node $got, pnpm $pnpm (o do packageManager, com o hash conferido pelo corepack)."
    ;;
  dotnet)
    if git ls-files --error-unmatch global.json > /dev/null 2>&1; then
      fail "o repositório já tem um global.json; este passo não o sobrescreve. Ponha nele a versão $wanted, ou tire este passo."
    fi
    printf '{\n  "sdk": {\n    "version": "%s",\n    "rollForward": "disable"\n  }\n}\n' "$wanted" > global.json
    got=$(dotnet --version) || fail "o dotnet não está no PATH."
    [ "$got" = "$wanted" ] || fail "o dotnet usa o SDK $got, e a versão fixada é a $wanted."
    echo "check-tools: SDK do .NET $got (fixado por um global.json só desta cópia de trabalho)."
    ;;
  *) echo "Uso: check-tools.sh node|dotnet <versão>" >&2; exit 2 ;;
esac
