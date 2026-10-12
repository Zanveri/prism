#!/usr/bin/env bash
# Workflow empacotar, job `api`: publica a API autocontida para cada plataforma (RN-ABERTO-006), num runner Linux com o SDK do .NET
# e o Node (as actions compostas preparar-dotnet e preparar-node), e deixa, para o job de pacote de cada plataforma, um arquivo
# api-bundles/prism-api-<identificador>.tar com:
#   api-bundles/<identificador>/       a API publicada para aquele sistema e aquela arquitetura;
#   src/client/resources/licenses/     os avisos de licença do .NET, que o `build:api` deixa ali e o `dist` leva a todo pacote.
# O `tar` existe porque o artefato do GitHub Actions perde o bit de execução dos arquivos (a documentação do upload-artifact
# manda empacotar em tar para mantê-lo).
#
# OS PARÂMETROS DO `dotnet publish` NÃO ESTÃO AQUI. A fonte única deles é src/client/scripts/publish-api.mjs (que também põe a
# versão do package.json na API, RN-VERSAO-003; a da vez, que o set-build-version.sh gravou antes: num beta, a do beta); este script só
# chama esse arquivo, uma vez por identificador.
#
# RN-ABERTO-001: o driver da IBM é proprietário e não vai em pacote nenhum. Depois de cada publicação o script confere que a pasta
# não tem nenhum arquivo dele (os mesmos nomes que o PublishTests da API procura) e que o deps.json não o cita; se tiver, falha, e
# nenhum pacote sai.
#
# Uso: bash scripts/ci/publish-api.sh
#      PRISM_API_RIDS="linux-x64 win-x64" bash scripts/ci/publish-api.sh     (só alguns identificadores, na sua máquina)
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"

rids=${PRISM_API_RIDS:-"win-x64 linux-x64 osx-arm64 osx-x64"}
export DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1

command -v node > /dev/null || { echo "publish-api: falta o Node (na pipeline, a action composta preparar-node)." >&2; exit 1; }
command -v dotnet > /dev/null || { echo "publish-api: falta o SDK do .NET (na pipeline, a action composta preparar-dotnet)." >&2; exit 1; }
echo "publish-api: node $(node --version), dotnet $(dotnet --version)"

# Restore só pelos lock files: os packages.lock.json trazem os quatro identificadores (Directory.Build.props), então a
# publicação por plataforma também restaura em modo travado, e uma mudança de pacote ou de hash derruba o job (NU1004).
export RestoreLockedMode=true
dotnet restore src/api/Prism.slnx --locked-mode -p:NuGetAudit=false

rm -rf api-bundles
mkdir -p api-bundles
for rid in $rids; do
  node src/client/scripts/publish-api.mjs "$rid"
  mv src/client/resources/api "api-bundles/$rid"
  ibm=$(find "api-bundles/$rid" \( -iname clidriver -o -iname 'IBM.Data.Db2*' -o -iname '*db2*' -o -iname 'TestConn*' -o -iname 'Lic_en*' -o -iname 'REDIST*' \) | head -n 5)
  [ -z "$ibm" ] || { echo "publish-api: a API de $rid leva arquivo do driver da IBM (RN-ABERTO-001): $ibm" >&2; exit 1; }
  ! grep -q -e 'IBM.Data.Db2' -e 'Net.IBM' -e 'clidriver' "api-bundles/$rid/Prism.Api.deps.json" || { echo "publish-api: o Prism.Api.deps.json de $rid cita o pacote da IBM (RN-ABERTO-001)." >&2; exit 1; }
done

# Os avisos do .NET são obrigatórios no pacote (RN-ABERTO-001). O `build:api` só avisa quando não os acha; aqui a falta é erro,
# para o pacote não sair sem eles.
for notice in LICENSE.txt ThirdPartyNotices.txt; do
  [ -f "src/client/resources/licenses/dotnet/$notice" ] || { echo "publish-api: faltou src/client/resources/licenses/dotnet/$notice (o aviso de licença do .NET)." >&2; exit 1; }
done

for rid in $rids; do
  tar -cf "api-bundles/prism-api-$rid.tar" "api-bundles/$rid" src/client/resources/licenses
done
ls -l api-bundles/*.tar
echo "publish-api: a API de cada plataforma, sem arquivo da IBM, e os avisos de licença do .NET estão em api-bundles/prism-api-<identificador>.tar."
