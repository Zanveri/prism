#!/usr/bin/env bash
# Workflow integrar: os testes de integração da API, que sobem contêineres (PostgreSQL, Informix e Db2) pelo Docker da máquina. Na
# pipeline é o runner Linux hospedado pelo GitHub, que tem o Docker e aceita contêiner privilegiado; na sua máquina, o Docker
# instalado.
#
# O driver da IBM desses testes é instalado pelo próprio gerenciador de drivers, uma vez por execução, a partir do pacote do cache
# do NuGet da máquina (src/api/AGENTS.md, "Testes"): o `dotnet restore` abaixo põe lá o pacote da IBM da plataforma (no Linux, o
# -lnx), e nenhum arquivo da IBM vai para o repositório nem para o pacote. No Linux o driver precisa da libxml2: `--install-deps`
# a instala pelo gerenciador do sistema quando ela falta (o passo de preparo do job).
#
# Filtros, por categoria de teste do NUnit:
#  - `Publish` fica SEMPRE de fora: são quatro publicações completas da API, e quem publica a API (e confere que ela sai sem
#    arquivo da IBM) é o workflow empacotar (scripts/ci/publish-api.sh);
#  - `Db2` precisa de contêiner privilegiado e só entra com PRISM_CI_PRIVILEGED (o job da pipeline a define; o runner hospedado do
#    GitHub aceita). Sem ela, a categoria fica de fora e o script diz isso.
# Uso: bash scripts/ci/integration-api.sh                 (os testes)
#      bash scripts/ci/integration-api.sh --install-deps  (só a libxml2, no Linux com apt-get; o resto é o SDK do .NET e o Docker)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [ "${1:-}" = --install-deps ]; then
  if [ "$(uname -s)" != Linux ] || ldconfig -p 2> /dev/null | grep -q 'libxml2\.so\.2'; then
    echo "integration-api: a libxml2 já está na máquina."
  else
    echo "integration-api: instalando a libxml2 (o driver da IBM no Linux precisa dela)."
    sudo apt-get update -q
    sudo apt-get install -y -q --no-install-recommends libxml2
  fi
  df -h / | tail -n 1 | awk '{ print "integration-api: espaço livre em /: " $4 " (as imagens do Db2 e do Informix passam de 6 GB)." }'
  exit 0
fi
[ $# -eq 0 ] || { echo "Uso: integration-api.sh [--install-deps]" >&2; exit 2; }

filter="TestCategory!=Publish"
if [ -n "${PRISM_CI_PRIVILEGED:-}" ]; then
  echo "integration-api: PRISM_CI_PRIVILEGED definida, os testes da categoria Db2 entram."
else
  filter="$filter&TestCategory!=Db2"
  echo "integration-api: sem PRISM_CI_PRIVILEGED, os testes da categoria Db2 ficam de fora."
fi

dotnet restore src/api/tests/Prism.IntegrationTesting/Prism.IntegrationTesting.csproj --locked-mode -p:NuGetAudit=false
dotnet test src/api/tests/Prism.IntegrationTesting/Prism.IntegrationTesting.csproj --no-restore -c Release --filter "$filter"
