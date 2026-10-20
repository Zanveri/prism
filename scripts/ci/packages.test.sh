#!/usr/bin/env bash
# Testes do packages.sh e da lista de pacotes (e das conferências da origem das atualizações). Rode com `bash scripts/ci/packages.test.sh`; sai com 1 se algum caso falhar.
#
# O caso "CONTRATO" fixa as linhas de packages.txt, que são contrato com o atualizador do app: src/client/electron/update/packages.ts
# repete a lista e monta com ela o nome do arquivo que baixa (um teste do cliente compara as duas). Se ele falhar, um nome mudou:
# NÃO acerte o esperado sem mudar packages.ts no mesmo pull request, ou o app passa a procurar um arquivo que a release não tem.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=packages.sh
source "$here/packages.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

failures=0

# Um caso por vez: (descrição, comando que tem de dar certo)
assert() {
  if "${@:2}" > /dev/null 2>&1; then
    echo "ok   - $1"
  else
    failures=$((failures + 1))
    echo "FALHA - $1"
  fi
}

# --- a lista ---

contract='win Prism-@VERSION@-win-x64.exe
win Prism-@VERSION@-win-x64.zip
linux Prism-@VERSION@-linux-x86_64.AppImage
linux Prism-@VERSION@-linux-amd64.deb
linux Prism-@VERSION@-linux-x86_64.rpm
linux Prism-@VERSION@-linux-x64.tar.gz
mac-arm64 Prism-@VERSION@-mac-arm64.dmg
mac-arm64 Prism-@VERSION@-mac-arm64.zip
mac-x64 Prism-@VERSION@-mac-x64.dmg
mac-x64 Prism-@VERSION@-mac-x64.zip'
if [ "$(awk '/^#/ || NF == 0 { next } { print $1, $2 }' "$here/packages.txt")" = "$contract" ]; then
  echo "ok   - CONTRATO: packages.txt tem os dez arquivos que o atualizador do app conhece, na mesma ordem"
else
  failures=$((failures + 1))
  echo "FALHA - CONTRATO: packages.txt mudou. O atualizador do app (src/client/electron/update/packages.ts) repete esta lista; mude os dois juntos."
  diff <(awk '/^#/ || NF == 0 { next } { print $1, $2 }' "$here/packages.txt") <(printf '%s\n' "$contract") | sed 's/^/       | /'
fi

first_of_win_from_elsewhere() { (cd / && source "$here/packages.sh" && [ "$(package_files 1.2.3 win | head -n 1)" = "Prism-1.2.3-win-x64.exe" ]); }
all_groups_have_ten() { [ "$(package_files 1.2.3 win linux mac-arm64 mac-x64 | wc -l | tr -d ' ')" = 10 ]; }
names_are_safe() { ! package_files 1.2.3-beta.1 win linux mac-arm64 mac-x64 | grep -qvE '^[A-Za-z0-9][A-Za-z0-9._-]*$'; }
unknown_group_fails() { (source "$here/packages.sh" && ! package_files 1.2.3 inexistente); }
unknown_group_next_to_valid_fails() { (source "$here/packages.sh" && ! package_files 1.2.3 win inexistente); }
unknown_group_is_silent() { (source "$here/packages.sh" && [ -z "$(package_files 1.2.3 inexistente 2> /dev/null)" ]); }
assert "a lista vale de qualquer pasta (o caminho do packages.txt não é relativo)" first_of_win_from_elsewhere
assert "os quatro grupos dão dez arquivos" all_groups_have_ten
assert "todo nome de arquivo cabe no formato que o atualizador aceita numa linha de soma (sem barra, sem espaço)" names_are_safe
assert "um grupo que não existe falha, em vez de devolver uma lista vazia que faria a conferência passar" unknown_group_fails
assert "e não escreve nada na saída padrão" unknown_group_is_silent
assert "um grupo inexistente ao lado de um válido também falha (a lista parcial não passa com 0)" unknown_group_next_to_valid_fails

# --- as plataformas que vieram inteiras (a falha de uma não segura as outras) ---

# listing <versão> <grupo>...: um arquivo de nomes com os arquivos desses grupos; sai com o caminho dele.
listing() {
  local version=$1
  shift
  mkdir -p "$work/listas"
  local file="$work/listas/$RANDOM$RANDOM"
  package_files "$version" "$@" > "$file"
  echo "$file"
}
groups_of() { present_groups "$@" | paste -sd ' ' -; }
groups_in_order() { [ "$(package_groups | paste -sd ' ' -)" = "win linux mac-arm64 mac-x64" ]; }
all_four_are_whole() { [ "$(groups_of 1.2.3 "$(listing 1.2.3 win linux mac-arm64 mac-x64)")" = "win linux mac-arm64 mac-x64" ]; }
only_win_is_whole() { [ "$(groups_of 1.2.3 "$(listing 1.2.3 win mac-x64)")" = "win mac-x64" ]; }
one_file_is_not_whole() { local file; file=$(listing 1.2.3 win linux); grep -vx 'Prism-1.2.3-linux-amd64.deb' "$file" > "$file.novo"; [ "$(groups_of 1.2.3 "$file.novo")" = "win" ]; }
other_version_is_not_whole() { [ -z "$(groups_of 1.2.3 "$(listing 1.2.4 win linux)")" ]; }
beta_version_is_exact() { [ "$(groups_of 1.2.3-beta.1 "$(listing 1.2.3-beta.1 linux)")" = "linux" ] && [ -z "$(groups_of 1.2.3 "$(listing 1.2.3-beta.1 linux)")" ]; }
a_piece_of_a_name_is_not_a_name() { local file="$work/listas/pedaco"; mkdir -p "$work/listas"; sed 's/^/x-/' <<< "$(package_files 1.2.3 win)" > "$file"; [ -z "$(groups_of 1.2.3 "$file")" ]; }
empty_list_has_no_group() { : > "$work/vazia"; [ -z "$(groups_of 1.2.3 "$work/vazia")" ]; }
beta_expects_windows_and_linux() { [ "$(expected_groups beta)" = "win linux" ]; }
stable_expects_all_four() { [ "$(expected_groups stable)" = "win linux mac-arm64 mac-x64" ]; }
unknown_kind_fails() { ! expected_groups rc 2> /dev/null; }
labels_are_for_people() { [ "$(group_label win) $(group_label linux) $(group_label mac-arm64) $(group_label mac-x64)" = "Windows Linux macOS (Apple Silicon) macOS (Intel)" ]; }
assert "os grupos de packages.txt, na ordem do arquivo" groups_in_order
assert "com os dez arquivos, os quatro grupos estão inteiros" all_four_are_whole
assert "um grupo ausente não conta, e os outros sim (a falha de uma plataforma não esconde as outras)" only_win_is_whole
assert "um grupo com um arquivo a menos não está inteiro" one_file_is_not_whole
assert "arquivos de outra versão não contam" other_version_is_not_whole
assert "o beta é procurado pelo nome inteiro da versão dele" beta_version_is_exact
assert "um pedaço de nome não é o nome" a_piece_of_a_name_is_not_a_name
assert "uma lista vazia não tem grupo" empty_list_has_no_group
assert "um beta espera o Windows e o Linux (o macOS só é empacotado na estável)" beta_expects_windows_and_linux
assert "uma estável espera as quatro plataformas" stable_expects_all_four
assert "um tipo de lançamento desconhecido falha" unknown_kind_fails
assert "cada grupo tem o nome que se diz a quem usa" labels_are_for_people

# --- a origem das atualizações gravada no pacote (RN-ATUALIZA-001 e RN-GITHUB-005) ---

# Um app.asar de mentira: bytes quaisquer em volta do package.json, que o electron-builder escreve com dois espaços de recuo.
fake_asar() {
  mkdir -p "$work/$1/resources"
  { printf '\001\002\003{"files":{}}'; printf '{\n  "name": "prism-client",\n  "version": "1.2.3"%s\n}' "$2"; printf '\004\005outro arquivo\n'; } > "$work/$1/resources/app.asar"
}
api=https://api.github.example.invalid
site=https://github.example.invalid
repo=Exemplo/prism
# A conferência não depende do nome das chaves que o `dist` usa: procura os três valores como textos JSON completos.
recorded() { printf ',\n  "homepage": "%s/%s",\n  "prismUpdateApi": "%s",\n  "prismUpdateSite": "%s",\n  "prismUpdateRepository": "%s"' "${4:-$site}" "${5:-$repo}" "${1:-$api}" "${2:-$site}" "${3:-$repo}"; }
origin() { PRISM_UPDATE_API=${2-$api} PRISM_UPDATE_SITE=${3-$site} PRISM_UPDATE_REPOSITORY=${4-$repo} update_origin_problem "$work/$1"; }
ok_with() { [ -z "$(origin "$@")" ]; }
refused_with() { [[ "$(origin "${@:2}")" == *"$1"* ]]; }

fake_asar certo "$(recorded)"
fake_asar sem ""
fake_asar outra-api "$(recorded https://api.outro.example.invalid)"
fake_asar outro-site "$(recorded "$api" https://outro.example.invalid)"
fake_asar outro-repo "$(recorded "$api" "$site" Exemplo/prism2)"
fake_asar so-a-pagina "$(printf ',\n  "homepage": "%s/%s"' "$site" "$repo")"
mkdir -p "$work/vazio"

assert "pacote com a origem gravada (a API, o site e o dono/repositório do workflow) passa" ok_with certo
assert "a barra no fim da API e do site não atrapalha" ok_with certo "$api/" "$site/"
assert "pacote SEM a origem gravada é recusado" refused_with "não traz gravada a origem" sem
assert "pacote com a API de OUTRO servidor é recusado" refused_with "não traz gravada a origem" outra-api
assert "pacote com outro site é recusado" refused_with "não traz gravada a origem" outro-site
assert "pacote com outro repositório (prism2 não é prism) é recusado" refused_with "não traz gravada a origem" outro-repo
assert "a página do projeto sozinha (o homepage do deb) não passa por origem gravada" refused_with "não traz gravada a origem" so-a-pagina
assert "variável vazia é recusada antes de olhar o pacote" refused_with "têm de estar definidas" certo ""
assert "faltando uma das três é recusado" refused_with "têm de estar definidas" certo "$api" "$site" ""
assert "repositório fora do formato dono/repositório é recusado" refused_with "dono/repositório" certo "$api" "$site" "Exemplo/../prism"
assert "pasta sem nenhum app.asar é recusada (nada foi conferido)" refused_with "não achei nenhum app.asar" vazio

# --- na pipeline, a origem que o pacote leva é a do PRÓPRIO repositório do workflow (as variáveis GITHUB_*) ---

# launch <plataforma> <no GitHub Actions> <api> <site> <repositório> <página>: com o repositório do workflow fixo.
launch() {
  GITHUB_ACTIONS=$2 GITHUB_API_URL=$api GITHUB_SERVER_URL=$site GITHUB_REPOSITORY=$repo \
    PRISM_UPDATE_API=$3 PRISM_UPDATE_SITE=$4 PRISM_UPDATE_REPOSITORY=$5 PRISM_HOMEPAGE=$6 launch_origin_problem "$1"
}
home=$site/$repo
launch_ok() { [ -z "$(launch "$@")" ]; }
launch_refused() { [[ "$(launch "${@:2}")" == *"$1"* ]]; }
assert "na pipeline, com a origem e a página do próprio repositório: passa" launch_ok linux true "$api" "$site" "$repo" "$home"
assert "na pipeline, com PRISM_UPDATE_API de OUTRO servidor: recusa" launch_refused "tem de ser a do próprio repositório" linux true https://outro.example.invalid "$site" "$repo" "$home"
assert "na pipeline, com outro site: recusa" launch_refused "tem de ser a do próprio repositório" win true "$api" https://outro.example.invalid "$repo" "$home"
assert "na pipeline, com outro repositório: recusa" launch_refused "tem de ser a do próprio repositório" mac true "$api" "$site" Outro/prism "$home"
assert "na pipeline, com a origem vazia: recusa" launch_refused "tem de ser a do próprio repositório" win true "" "" "" "$home"
assert "na pipeline, no Linux, com PRISM_HOMEPAGE de outro endereço: recusa" launch_refused "PRISM_HOMEPAGE" linux true "$api" "$site" "$repo" https://outro.example.invalid/x
assert "a página só entra no pacote de Linux: no de Windows ela não é conferida" launch_ok win true "$api" "$site" "$repo" https://outro.example.invalid/x
assert "fora do GitHub Actions nada disto é conferido (o pacote sai sem origem, ou com a que a pessoa der)" launch_ok linux "" https://outro.example.invalid "" Outro/x ""

echo
[ "$failures" -eq 0 ] && echo "a lista de pacotes e a conferência da origem estão certas." || echo "$failures caso(s) falharam."
[ "$failures" -eq 0 ]
