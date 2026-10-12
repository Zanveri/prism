#!/usr/bin/env bash
# Workflow verificar, job `api`: restore só pelos lock files (--locked-mode), build com zero avisos e testes de unidade.
# A auditoria de pacotes (NuGetAudit) fica desligada aqui de propósito: uma vulnerabilidade publicada ontem viraria aviso, e o
# -warnaserror a transformaria em erro de build, misturando duas perguntas. Quem olha as vulnerabilidades é o job
# `auditoria-api` do workflow seguranca, com o limiar dele.
# Uso: bash scripts/ci/verify-api.sh           (precisa do SDK do .NET 10; na pipeline, a action composta preparar-dotnet)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

dotnet restore src/api/Prism.slnx --locked-mode -p:NuGetAudit=false
dotnet build src/api/Prism.slnx --no-restore -c Release -warnaserror -p:NuGetAudit=false
dotnet test src/api/tests/Prism.UnitTesting/Prism.UnitTesting.csproj --no-build -c Release
