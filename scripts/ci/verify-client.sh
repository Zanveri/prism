#!/usr/bin/env bash
# Workflow verificar, job `interface`: restaura só pelo lock file (pnpm install --frozen-lockfile) e roda lint, typecheck e
# testes. O pnpm vem pelo corepack, na versão do campo `packageManager` de src/client/package.json, conferida pelo hash dele.
# Uso: bash scripts/ci/verify-client.sh        (precisa de Node 22 com corepack; na pipeline, a action composta preparar-node)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../src/client"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
