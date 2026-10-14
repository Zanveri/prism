#!/usr/bin/env bash
# Workflow empacotar, job do Windows, depois de gerar o instalador: confere o instalador de verdade (seção 25 da especificação,
# RN-INSTALA-001 a 004), instalando e desinstalando em silêncio, nos dois modos, no próprio runner. O runner do GitHub roda como
# administrador, sem o pedido de permissão do Windows: o que se confere aqui é o modo escolhido pela linha de comando e pela
# instalação que já existe, e não o pedido em si (aceito ou negado), que só uma pessoa responde.
#
#   1. `/S /currentuser`: o Prism.exe na pasta de programas do perfil (%LOCALAPPDATA%\Programs) e as chaves em HKCU (a da pasta,
#      Software\<guid>, e a de desinstalar); nada em HKLM.
#   2. o mesmo instalador de novo com `--updated /S` (o que o atualizador do app passa, menos o `--force-run`, que abriria o app):
#      continua UMA instalação, a do usuário, na mesma pasta (RN-INSTALA-002).
#   3. `/S /allusers` com a do usuário instalada: recusado (sai com 2), e nada muda. Para trocar de modo, desinstala-se antes.
#   4. a desinstalação silenciosa (`QuietUninstallString` da chave de desinstalar): as chaves e o Prism.exe somem.
#   5. `/S /allusers`: o Prism.exe na pasta de programas do sistema (%ProgramFiles%) e as chaves em HKLM; nada em HKCU.
#   6. `/S /currentuser` com a de todos instalada: recusado (sai com 2), e nada muda.
#   7. `--updated /S` com a de todos instalada: continua a de todos, na mesma pasta.
#   8. a desinstalação silenciosa da de todos.
#
# Uso: bash scripts/ci/check-windows-installer.sh [instalador]   (sem argumento, src/client/release/Prism-<versão>-win-x64.exe,
# com a versão de src/client/package.json). Precisa do Git Bash do runner (reg.exe, cygpath). A máquina tem de estar sem o Prism
# instalado: o script não desinstala o que já estava, e recusa. Os testes (check-windows-installer.test.sh) trocam o reg.exe
# por PRISM_REG e a espera por PRISM_WAIT_SECONDS.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# No Git Bash, um argumento que começa com `/` vira caminho (`/S` seria `S:/`), inclusive os do reg.exe.
export MSYS_NO_PATHCONV=1
reg=${PRISM_REG:-reg.exe}
wait_seconds=${PRISM_WAIT_SECONDS:-180}

fail() {
  echo "check-windows-installer: $*" >&2
  exit 1
}

version=$(sed -n 's/^  "version": "\([^"]*\)".*$/\1/p' "$root/src/client/package.json" | head -n 1)
[ -n "$version" ] || fail "não achei a versão em src/client/package.json."
# O nome das chaves do registro: o `nsis.guid` do electron-builder.yml (o app lê a mesma, electron/update/install-scope.ts).
guid=$(sed -nE 's/^  guid: ([0-9a-f-]{36})$/\1/p' "$root/src/client/electron-builder.yml" | head -n 1)
[ -n "$guid" ] || fail "não achei o nsis.guid em src/client/electron-builder.yml."
installer=${1:-$root/src/client/release/Prism-$version-win-x64.exe}
[ -f "$installer" ] || fail "o instalador $installer não existe (o package-desktop.sh win o gera)."

local_app_data=${LOCALAPPDATA:-}
program_files=${ProgramW6432:-${ProgramFiles:-${PROGRAMFILES:-}}}
[ -n "$local_app_data" ] || fail "falta a variável LOCALAPPDATA (este script roda no Windows)."
[ -n "$program_files" ] || fail "falta a variável ProgramFiles (este script roda no Windows)."

install_key="Software\\$guid"
uninstall_key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$guid"

# reg_value <chave> <valor>: o dado do valor, ou nada. A visão de 64 bits, a que o instalador usa.
reg_value() {
  local out
  out=$("$reg" query "$1" /v "$2" /reg:64 2> /dev/null) || return 0
  printf '%s\n' "$out" | tr -d '\r' | sed -nE "/^[[:space:]]+$2[[:space:]]+REG_/{s/^[[:space:]]+$2[[:space:]]+REG_[A-Z_]+[[:space:]]+(.*[^[:space:]])[[:space:]]*\$/\\1/p;q;}"
}
key_exists() {
  "$reg" query "$1" /reg:64 > /dev/null 2>&1
}
# Até 10 min por instalador ou desinstalador: um que pare esperando alguém não segura o job até o tempo dele acabar. É o `timeout`
# do coreutils do Git Bash, pelo caminho: no PATH do Windows há outro `timeout`, que só espera.
with_timeout() {
  if [ -x /usr/bin/timeout ]; then /usr/bin/timeout 600 "$@"; else "$@"; fi
}
# Um caminho do Windows (C:\…) como o bash o lê.
to_posix() {
  if command -v cygpath > /dev/null 2>&1; then cygpath -u "$1"; else printf '%s\n' "${1//\\//}"; fi
}
# Comparação de caminhos do Windows: sem caixa e com uma barra só.
same_path() {
  local a b
  a=$(printf '%s' "$1" | tr '/' '\\' | tr '[:upper:]' '[:lower:]')
  b=$(printf '%s' "$2" | tr '/' '\\' | tr '[:upper:]' '[:lower:]')
  [ "${a%\\}" = "${b%\\}" ]
}
under() {
  local child parent
  child=$(printf '%s' "$1" | tr '/' '\\' | tr '[:upper:]' '[:lower:]')
  parent=$(printf '%s' "$2" | tr '/' '\\' | tr '[:upper:]' '[:lower:]')
  case "$child" in "${parent%\\}"\\*) return 0 ;; *) return 1 ;; esac
}

# run_installer <código esperado> <argumento>...: roda o instalador e espera ele terminar (o bash espera o processo).
run_installer() {
  local expected=$1 status=0
  shift
  echo "== instalador $*"
  with_timeout "$installer" "$@" || status=$?
  [ "$status" = "$expected" ] || fail "o instalador com \"$*\" saiu com $status, e o esperado era $expected."
}

# installed <HKCU|HKLM> <pasta de programas>: a instalação daquele lado está inteira, e o outro lado não tem nenhuma. Escreve a pasta.
installed() {
  local hive=$1 programs=$2 other dir quiet
  [ "$hive" = HKCU ] && other=HKLM || other=HKCU
  dir=$(reg_value "$hive\\$install_key" InstallLocation)
  [ -n "$dir" ] || fail "não há $hive\\$install_key (InstallLocation): o instalador não gravou a instalação."
  under "$dir" "$programs" || fail "a instalação está em $dir, fora de $programs."
  [ -f "$(to_posix "$dir")/Prism.exe" ] || fail "não há Prism.exe em $dir."
  key_exists "$hive\\$uninstall_key" || fail "não há a chave de desinstalar em $hive."
  quiet=$(reg_value "$hive\\$uninstall_key" QuietUninstallString)
  [ -n "$quiet" ] || fail "a chave de desinstalar de $hive não tem QuietUninstallString."
  [ "$(reg_value "$hive\\$uninstall_key" DisplayVersion)" = "$version" ] || fail "a versão registrada em $hive não é $version."
  ! key_exists "$other\\$install_key" || fail "há também uma instalação em $other: são duas."
  ! key_exists "$other\\$uninstall_key" || fail "há também uma chave de desinstalar em $other: são duas."
  printf '%s\n' "$dir"
}

nothing_installed() {
  local hive
  for hive in HKCU HKLM; do
    ! key_exists "$hive\\$install_key" || fail "$1: ainda há $hive\\$install_key."
    ! key_exists "$hive\\$uninstall_key" || fail "$1: ainda há a chave de desinstalar em $hive."
  done
}

# uninstall <HKCU|HKLM> <pasta>: a desinstalação silenciosa registrada. O desinstalador do NSIS se copia para a pasta temporária e
# volta na hora, então o fim é esperado pelas chaves e pelo Prism.exe sumirem.
uninstall() {
  local hive=$1 dir=$2 quiet exe args waited=0
  quiet=$(reg_value "$hive\\$uninstall_key" QuietUninstallString)
  exe=$(printf '%s' "$quiet" | sed -nE 's/^"([^"]+)".*$/\1/p')
  [ -n "$exe" ] || fail "QuietUninstallString de $hive fora do formato \"<desinstalador>\" <argumentos>: $quiet"
  read -r -a args <<< "${quiet#"\"$exe\""}"
  echo "== desinstalador ${args[*]}"
  with_timeout "$(to_posix "$exe")" "${args[@]}" || fail "o desinstalador de $hive saiu com erro."
  while key_exists "$hive\\$uninstall_key" || key_exists "$hive\\$install_key" || [ -e "$(to_posix "$dir")/Prism.exe" ]; do
    [ "$waited" -lt "$wait_seconds" ] || fail "a desinstalação de $hive não terminou em $wait_seconds s."
    sleep 1
    waited=$((waited + 1))
  done
  nothing_installed "depois de desinstalar"
}

nothing_installed "antes de começar (o Prism já estava instalado nesta máquina)"

# --- só do usuário ---
run_installer 0 /S /currentuser
user_dir=$(installed HKCU "$local_app_data\\Programs")
echo "ok   - /S /currentuser: só do usuário, em $user_dir"

run_installer 0 --updated /S
dir=$(installed HKCU "$local_app_data\\Programs")
same_path "$dir" "$user_dir" || fail "a atualização mudou a pasta da instalação do usuário ($user_dir -> $dir)."
echo "ok   - --updated /S: a mesma instalação do usuário, atualizada"

run_installer 2 /S /allusers
dir=$(installed HKCU "$local_app_data\\Programs")
same_path "$dir" "$user_dir" || fail "o /allusers recusado mudou a instalação do usuário ($user_dir -> $dir)."
echo "ok   - /S /allusers com a do usuário instalada: recusado, e nada muda"

uninstall HKCU "$user_dir"
echo "ok   - desinstalação silenciosa da do usuário"

# --- para todos os usuários ---
run_installer 0 /S /allusers
machine_dir=$(installed HKLM "$program_files")
echo "ok   - /S /allusers: para todos, em $machine_dir"

run_installer 2 /S /currentuser
dir=$(installed HKLM "$program_files")
same_path "$dir" "$machine_dir" || fail "o /currentuser recusado mudou a instalação para todos ($machine_dir -> $dir)."
echo "ok   - /S /currentuser com a de todos instalada: recusado, e nada muda"

run_installer 0 --updated /S
dir=$(installed HKLM "$program_files")
same_path "$dir" "$machine_dir" || fail "a atualização mudou a pasta da instalação para todos ($machine_dir -> $dir)."
echo "ok   - --updated /S: a mesma instalação para todos, atualizada"

uninstall HKLM "$machine_dir"
echo "ok   - desinstalação silenciosa da de todos"
