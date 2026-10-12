#!/usr/bin/env bash
# Workflow seguranca, auditoria de dependências (RN-ABERTO-005): lista toda vulnerabilidade conhecida, de qualquer severidade,
# e falha a partir de ALTA. O limiar é este: severidade alta ou crítica falha; moderada e baixa só aparecem na lista.
# A pipeline só roda no merge em develop e em main, de onde sai um lançamento: a falha trava o empacotamento, e nenhum pacote
# sai com vulnerabilidade alta ou crítica conhecida. O preço é que uma vulnerabilidade publicada depois do merge deixa a pipeline
# vermelha até a dependência ser trocada. Antes do merge, quem revisa roda este script na própria máquina (CONTRIBUTING.md).
#
# Uso: bash scripts/ci/audit-deps.sh client    (pnpm audit, precisa de Node com corepack)
#      bash scripts/ci/audit-deps.sh api       (dotnet list package --vulnerable --include-transitive, precisa do SDK do .NET)
# Saída: 0 nenhuma alta ou crítica; 1 há alta ou crítica; 2 não deu para auditar (rede, registro fora do ar).
# Só a rede do registro de pacotes é usada; nenhuma credencial.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

audit_client() {
  cd src/client
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

  echo "== Todas as severidades (informativo)"
  corepack pnpm audit || true

  echo "== Gate: alta ou crítica"
  if corepack pnpm audit --audit-level high > "$tmp" 2>&1; then
    echo "Nenhuma vulnerabilidade alta ou crítica."
  elif grep -q 'vulnerabilities found' "$tmp"; then
    tail -n 3 "$tmp"
    echo "audit-deps: há vulnerabilidade alta ou crítica na interface (pnpm audit)." >&2
    exit 1
  else
    cat "$tmp"
    echo "audit-deps: não deu para auditar a interface (o registro respondeu com erro?)." >&2
    exit 2
  fi
}

audit_api() {
  export DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1
  dotnet restore src/api/Prism.slnx --locked-mode > "$tmp" 2>&1 || { cat "$tmp"; echo "audit-deps: o restore falhou." >&2; exit 2; }

  echo "== Todas as severidades (informativo)"
  dotnet list src/api/Prism.slnx package --vulnerable --include-transitive --no-restore > "$tmp" 2>&1 || { cat "$tmp"; echo "audit-deps: não deu para listar as vulnerabilidades da API." >&2; exit 2; }
  cat "$tmp"
  # Sem os dados do NuGet o comando sai com 0 e uma advertência; isso não pode passar por "nenhuma vulnerabilidade".
  if grep -q 'NU1900' "$tmp"; then
    echo "audit-deps: o NuGet não conseguiu obter os dados de vulnerabilidade (NU1900)." >&2
    exit 2
  fi

  echo "== Gate: alta ou crítica"
  dotnet list src/api/Prism.slnx package --vulnerable --include-transitive --no-restore --format json > "$tmp" 2>&1 || { cat "$tmp"; exit 2; }
  if grep -Eq '"severity": *"(High|Critical)"' "$tmp"; then
    grep -E '"(id|severity|advisoryurl)"' "$tmp" | sed 's/^ *//'
    echo "audit-deps: há vulnerabilidade alta ou crítica na API (dotnet list package --vulnerable)." >&2
    exit 1
  fi
  echo "Nenhuma vulnerabilidade alta ou crítica."
}

case "${1:-}" in
  client) audit_client ;;
  api) audit_api ;;
  *) echo "Uso: audit-deps.sh client|api" >&2; exit 2 ;;
esac
