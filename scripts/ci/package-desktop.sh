#!/usr/bin/env bash
# Workflow empacotar: o pacote de uma plataforma (RN-ABERTO-006), com a API publicada para a mesma plataforma e arquitetura.
# Uso: bash scripts/ci/package-desktop.sh win             Windows x64: instalador e zip (num runner Windows)
#      bash scripts/ci/package-desktop.sh linux           Linux x64: AppImage, deb, rpm e tar.gz (precisa de PRISM_HOMEPAGE)
#      bash scripts/ci/package-desktop.sh mac arm64|x64   macOS: dmg e zip (só roda num macOS)
# Antes: a API da plataforma, do publish-api.sh: api-bundles/prism-api-<identificador>.tar (o artefato do job `api`, que este
# script abre) ou a pasta api-bundles/<identificador>/ com src/client/resources/licenses/dotnet já no lugar; e o repositório
# inteiro (o `dist` leva o LICENSE e o NOTICE da raiz). O Node e o pnpm já instalados (na pipeline, a action composta
# preparar-node). Saída: src/client/release/Prism-*.
#
# O empacotamento em si é o `pnpm dist -- <plataforma>` de src/client (a fonte dos alvos é o electron-builder.yml). O `dist` confere
# pelo cabeçalho do executável que a API é do sistema e da arquitetura pedidos, e confere LICENSE, NOTICE e a licença das fontes.
# O deb e o rpm exigem a URL do projeto, que não está escrita no repositório: o `dist` a lê de PRISM_HOMEPAGE (https://, sem
# usuário nem senha; na pipeline, a página do repositório do workflow). Sem ela o `dist` gera só o AppImage e o tar.gz e termina
# com 0; por isso este script confere, no fim, que todos os arquivos do pacote existem (a lista está em scripts/ci/packages.txt).
#
# A origem das atualizações (RN-ATUALIZA-001 e RN-GITHUB-005): PRISM_UPDATE_API, PRISM_UPDATE_SITE e PRISM_UPDATE_REPOSITORY, que
# o `dist` grava dentro do pacote. NA PIPELINE (GITHUB_ACTIONS) elas têm de ser as do PRÓPRIO repositório do workflow
# (packages.sh, `launch_origin_problem`): o script recusa antes de empacotar e confere, depois, que o pacote gerado as traz
# gravadas. Fora da pipeline o pacote sai com a origem que a pessoa der, ou sem nenhuma, e aí o app não procura atualização.
# A versão do pacote é a do campo `version` de src/client/package.json; num beta, a pipeline a trocou antes pela do beta
# (set-build-version.sh), e é com ela que a lista de arquivos é conferida.
# Atenção: apaga src/client/release e src/client/resources/api. Na própria máquina, rode numa cópia descartável.
# (Sem `mapfile` nem nada do bash 4: este script roda também no bash 3.2 do macOS.)
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
# shellcheck source=packages.sh
source "$root/scripts/ci/packages.sh"

platform=${1:-}
arch=${2:-}
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

case "$platform" in
  win) rid=win-x64; group=win; dist_args=(win) ;;
  linux) rid=linux-x64; group=linux; dist_args=(linux) ;;
  mac)
    case "$arch" in arm64 | x64) ;; *) echo "Uso: package-desktop.sh mac arm64|x64" >&2; exit 2 ;; esac
    rid=osx-$arch; group=mac-$arch; dist_args=(mac "$arch") ;;
  *) echo "Uso: package-desktop.sh win|linux|mac [arm64|x64]" >&2; exit 2 ;;
esac

if [ ! -d "api-bundles/$rid" ] && [ -f "api-bundles/prism-api-$rid.tar" ]; then
  tar -xf "api-bundles/prism-api-$rid.tar"
fi
[ -d "api-bundles/$rid" ] || { echo "package-desktop: falta api-bundles/$rid (rode scripts/ci/publish-api.sh antes)." >&2; exit 1; }
for notice in LICENSE.txt ThirdPartyNotices.txt; do
  [ -f "src/client/resources/licenses/dotnet/$notice" ] || { echo "package-desktop: falta src/client/resources/licenses/dotnet/$notice (vem junto da API, do publish-api.sh)." >&2; exit 1; }
done
if [ "$platform" = linux ] && [ -z "${PRISM_HOMEPAGE:-}" ]; then
  echo "package-desktop: o deb e o rpm exigem PRISM_HOMEPAGE (a URL pública do projeto; na pipeline, a página do repositório)." >&2
  exit 1
fi
problem=$(launch_origin_problem "$platform")
[ -z "$problem" ] || { echo "package-desktop: $problem" >&2; exit 1; }
command -v node > /dev/null || { echo "package-desktop: falta o Node (na pipeline, a action composta preparar-node)." >&2; exit 1; }

# Uma só API em resources/api: a do identificador deste pacote.
rm -rf src/client/resources/api src/client/release
mkdir -p src/client/resources
cp -a "api-bundles/$rid" src/client/resources/api

cd src/client
corepack pnpm install --frozen-lockfile
corepack pnpm dist -- "${dist_args[@]}"

# O `dist` grava a origem das atualizações e não confere o resultado: na pipeline, quem confere é este script, no pacote que
# acabou de sair, antes do job de lançamento.
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  problem=$(update_origin_problem release)
  [ -z "$problem" ] || { echo "package-desktop: $problem" >&2; exit 1; }
  echo "package-desktop: o pacote traz gravada a origem das atualizações."
fi

# Os arquivos que a release recebe. O electron-builder não falha por um alvo a menos, e o `dist` sem PRISM_HOMEPAGE sai com 0.
version=$(sed -n 's/^  "version": "\([^"]*\)".*$/\1/p' package.json | head -n 1)
files=$(package_files "$version" "$group") || exit 1
missing=0
for file in $files; do
  if [ -f "release/$file" ]; then ls -l "release/$file"; else echo "package-desktop: faltou release/$file" >&2; missing=1; fi
done
exit "$missing"
