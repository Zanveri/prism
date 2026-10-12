#!/usr/bin/env bash
# A versão com que os pacotes desta execução são gerados (RN-VERSAO-003 e 008). Na develop e na main o campo `version` de
# src/client/package.json é a versão estável que o dono quer (X.Y.Z), e a que o merge lança é a DA VEZ (version.sh, `decide_release`):
# a do campo, ou, se ela já saiu como estável, a maior estável com o patch + 1; o beta é X.Y.Z-beta.N dela. O app empacotado tem de
# DIZER que é essa versão (é com esse número que o atualizador dele compara as versões, e é ele que a tela de entrada mostra), e o
# nome de cada pacote leva o número. Por isso, antes de publicar a API e de empacotar, o job troca o campo `version` da CÓPIA de
# trabalho pela versão que o job `versao` planejou (check-version.sh, output `versao`). Nada é comitado: a versão continua
# morando só no package.json do repositório.
#
# Só aceita uma versão no formato da RN-VERSAO-001 cuja parte X.Y.Z seja a do package.json ou MAIOR que ela (a da vez nunca é menor
# que o campo; os jobs de empacotar não têm as tags, então não dá para refazer a conta aqui): um plano adulterado não gera pacote de
# uma versão menor, e quem confere o resto é o publish-release.sh, que decide de novo e recusa um plano que não bate com as tags.
# Com a versão igual à do package.json, não muda nada.
#
# Uso: bash scripts/ci/set-build-version.sh <versão>      (da pasta do repositório; na pipeline, nos jobs de empacotar)
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$here/../.."
# shellcheck source=version.sh
source "$here/version.sh"

fail() {
  echo "set-build-version: $1" >&2
  exit 1
}

[ $# -eq 1 ] && [ -n "$1" ] || { echo "Uso: set-build-version.sh <versão>" >&2; exit 2; }
wanted=$1
current=$(package_version)
version_fields "$wanted" > /dev/null || fail "a versão \"$wanted\" não segue o formato X.Y.Z, X.Y.Z-beta.N ou X.Y.Z-rc.N (RN-VERSAO-001)."
version_fields "$current" > /dev/null || fail "a versão \"$current\" de src/client/package.json não segue o formato X.Y.Z, X.Y.Z-beta.N ou X.Y.Z-rc.N (RN-VERSAO-001)."
base=${wanted%%-*}
if [ "$base" != "$current" ] && ! version_greater "$base" "$current"; then
  fail "a versão \"$wanted\" é menor que a do package.json ($current): a versão da vez é a do package.json ou uma maior (version.sh)."
fi
if [ "$wanted" = "$current" ]; then
  echo "set-build-version: os pacotes saem com a versão do package.json, $current."
  exit 0
fi
# Só a linha do campo do primeiro nível (dois espaços de recuo), a mesma que `package_version` lê.
sed -i.bak "s/^  \"version\": \"$current\"/  \"version\": \"$wanted\"/" src/client/package.json
rm -f src/client/package.json.bak
[ "$(package_version)" = "$wanted" ] || fail "não consegui gravar a versão $wanted em src/client/package.json."
echo "set-build-version: os pacotes saem com a versão $wanted (o package.json do repositório continua em $current)."
