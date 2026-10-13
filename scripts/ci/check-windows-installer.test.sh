#!/usr/bin/env bash
# Testes do check-windows-installer.sh, no Linux, sem Windows: o reg.exe é um de mentira (PRISM_REG), que guarda as chaves em
# arquivos, e o instalador é um script de mentira que faz o que o instalador do Prism faz no modo silencioso (build/installer.nsh,
# sobre os modelos do electron-builder): escolhe o modo pela instalação que existe e por /allusers ou /currentuser, recusa trocar de
# modo (sai com 2), grava as chaves em HKCU ou HKLM e deixa um desinstalador que, como o do NSIS, volta na hora e termina depois.
# Cada caso estraga uma parte e confere que o script reprova. Rode com `bash scripts/ci/check-windows-installer.test.sh`.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
version=$(sed -n 's/^  "version": "\([^"]*\)".*$/\1/p' "$root/src/client/package.json" | head -n 1)
guid=$(sed -nE 's/^  guid: ([0-9a-f-]{36})$/\1/p' "$root/src/client/electron-builder.yml" | head -n 1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

failures=0

# --- o reg.exe de mentira: uma chave é um arquivo (a barra invertida vira "#"), uma linha "nome<TAB>tipo<TAB>dado" por valor ---
mkdir -p "$work/bin"
cat > "$work/bin/reg.exe" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = query ] || exit 2
file="$FAKE_REGISTRY/${2//\\/#}"
[ -f "$file" ] || { echo "ERROR: The system was unable to find the specified registry key or value." >&2; exit 1; }
if [ "${3:-}" = /v ]; then
  line=$(awk -F '\t' -v name="$4" '$1 == name { print; exit }' "$file")
  [ -n "$line" ] || { echo "ERROR: The system was unable to find the specified registry key or value." >&2; exit 1; }
  IFS=$'\t' read -r name type data <<< "$line"
  printf '\r\n%s\r\n    %s    %s    %s\r\n\r\n' "$2" "$name" "$type" "$data"
else
  printf '\r\n%s\r\n' "$2"
fi
EOF
chmod +x "$work/bin/reg.exe"

# --- o instalador de mentira. FAKE_BUG estraga uma parte: ignore-allusers, second-install, no-refusal, uninstall-hangs ---
cat > "$work/installer.sh" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
key() { printf '%s/%s' "$FAKE_REGISTRY" "${1//\\/#}"; }
posix() { printf '%s' "${1//\\//}"; }
allusers=0 currentuser=0
for arg in "$@"; do
  case "$arg" in /allusers) allusers=1 ;; /currentuser) currentuser=1 ;; esac
done
install_key="Software\\$FAKE_GUID"
uninstall_key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$FAKE_GUID"
if [ -f "$(key "HKLM\\$install_key")" ]; then
  [ "$currentuser" = 1 ] && [ "${FAKE_BUG:-}" != no-refusal ] && exit 2
  hive=HKLM
elif [ -f "$(key "HKCU\\$install_key")" ]; then
  [ "$allusers" = 1 ] && [ "${FAKE_BUG:-}" != no-refusal ] && exit 2
  hive=HKCU
elif [ "$allusers" = 1 ] && [ "${FAKE_BUG:-}" != ignore-allusers ]; then
  hive=HKLM
else
  hive=HKCU
fi
[ "${FAKE_BUG:-}" = second-install ] && [ -f "$(key "HKCU\\$install_key")" ] && hive=HKLM
if [ "$hive" = HKLM ]; then dir="$ProgramW6432\\Prism" flag=/allusers; else dir="$LOCALAPPDATA\\Programs\\Prism" flag=/currentuser; fi
mkdir -p "$(posix "$dir")"
: > "$(posix "$dir")/Prism.exe"
cat > "$(posix "$dir")/Uninstall Prism.exe" << UNINSTALL
#!/usr/bin/env bash
[ "\${FAKE_BUG:-}" = uninstall-hangs ] && exit 0
( sleep 1; rm -f "$(key "$hive\\$install_key")" "$(key "$hive\\$uninstall_key")"; rm -rf "$(posix "$dir")" ) > /dev/null 2>&1 &
exit 0
UNINSTALL
chmod +x "$(posix "$dir")/Uninstall Prism.exe"
printf 'InstallLocation\tREG_SZ\t%s\n' "$dir" > "$(key "$hive\\$install_key")"
printf 'QuietUninstallString\tREG_SZ\t"%s\\Uninstall Prism.exe" %s /S\nDisplayVersion\tREG_SZ\t%s\n' "$dir" "$flag" "$FAKE_VERSION" > "$(key "$hive\\$uninstall_key")"
EOF
chmod +x "$work/installer.sh"

# run <caso> [VAR=valor]...: roda o script num mundo limpo; a saída e o código ficam em $work/saida e $status.
run() {
  rm -rf "$work/registry" "$work/Local" "$work/ProgramFiles"
  mkdir -p "$work/registry" "$work/Local" "$work/ProgramFiles"
  status=0
  env FAKE_REGISTRY="$work/registry" FAKE_GUID="$guid" FAKE_VERSION="$version" PRISM_REG="$work/bin/reg.exe" PRISM_WAIT_SECONDS=5 \
    LOCALAPPDATA="$work/Local" ProgramW6432="$work/ProgramFiles" "$@" \
    bash "$here/check-windows-installer.sh" "$work/installer.sh" > "$work/saida" 2>&1 || status=$?
}
expect() {
  local description=$1 code=$2 pattern=$3
  if [ "$status" = "$code" ] && grep -qE -- "$pattern" "$work/saida"; then
    echo "ok   - $description"
  else
    failures=$((failures + 1))
    echo "FALHA - $description (saiu com $status)"
    sed 's/^/       /' "$work/saida"
  fi
}

run
expect "o instalador certo passa: os dois modos, a atualização, as recusas e as desinstalações" 0 "ok   - desinstalação silenciosa da de todos"
grep -c '^ok   - ' "$work/saida" | grep -qx 8 && echo "ok   - são oito conferências" || { failures=$((failures + 1)); echo "FALHA - eram oito conferências"; cat "$work/saida"; }

run FAKE_BUG=ignore-allusers
expect "/allusers que instala só para o usuário: reprova" 1 "não há HKLM.*InstallLocation"

run FAKE_BUG=second-install
expect "a atualização que faz uma segunda instalação: reprova" 1 "são duas"

run FAKE_BUG=no-refusal
expect "o modo trocado pela linha de comando sem recusa: reprova" 1 "saiu com 0, e o esperado era 2"

run FAKE_BUG=uninstall-hangs
expect "a desinstalação que não termina: reprova, no prazo" 1 "não terminou em 5 s"

rm -rf "$work/registry" && mkdir -p "$work/registry"
status=0
printf 'InstallLocation\tREG_SZ\tC:\\Prism\n' > "$work/registry/HKCU#Software#$guid"
env FAKE_REGISTRY="$work/registry" PRISM_REG="$work/bin/reg.exe" LOCALAPPDATA="$work/Local" ProgramW6432="$work/ProgramFiles" \
  bash "$here/check-windows-installer.sh" "$work/installer.sh" > "$work/saida" 2>&1 || status=$?
expect "com o Prism já instalado na máquina, nem começa" 1 "antes de começar"

status=0
env PRISM_REG="$work/bin/reg.exe" LOCALAPPDATA="$work/Local" ProgramW6432="$work/ProgramFiles" bash "$here/check-windows-installer.sh" "$work/nao-existe.exe" > "$work/saida" 2>&1 || status=$?
expect "sem o instalador, reprova dizendo qual" 1 "nao-existe.exe não existe"

[ "$failures" -eq 0 ] || { echo "$failures caso(s) falharam."; exit 1; }
