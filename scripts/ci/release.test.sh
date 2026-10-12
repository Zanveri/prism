#!/usr/bin/env bash
# O ensaio do lançamento inteiro (RN-VERSAO-008), sem GitHub: o projeto de mentira de fake-project.sh (um repositório `bare` local
# no papel do remoto) e um `gh` de mentira (fake-gh.py) no papel da API de releases. Exercita o publish-release.sh: o beta da
# develop e a estável da main; o rascunho que recebe os pacotes e só depois é publicado (é a publicação que cria a tag); a
# repetição depois de uma falha em cada ponto; o rascunho velho de outro commit; o plano que não bate com o estado das tags; a
# release de um commit que muda .github/workflows/; e por onde o token passa.
# Rode com `bash scripts/ci/release.test.sh`; sai com 1 se algum caso falhar.
#
# O que ele NÃO prova: nada do GitHub de verdade (a API, as regras de tag e de ramo, as releases imutáveis, o envio dos anexos).
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=fake-project.sh
source "$here/fake-project.sh"
fake_project
trap 'rm -rf "$sandbox"' EXIT

total=0
failures=0
out=
code=0

# Tudo fictício: os servidores são .invalid, e o token só existe neste processo.
token="ensaio-$RANDOM$RANDOM$RANDOM-nao-e-segredo"
repo=Exemplo/prism
server=https://github.example.invalid
api=https://api.github.example.invalid
upload=https://uploads.github.example.invalid

export FAKE=$sandbox/fake REAL_GIT FAKE_REMOTE=$remote FAKE_REPO=$repo FAKE_UPLOAD=$upload FAKE_TOKEN=$token
REAL_GIT=$(command -v git)
mkdir -p "$FAKE" "$sandbox/bin"
: > "$FAKE/calls"
: > "$FAKE/gh.argv"
: > "$FAKE/git.argv"

# O git de sempre, anotando os argumentos de cada chamada; e o gh de mentira.
cat > "$sandbox/bin/git" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE/git.argv"
exec "$REAL_GIT" "$@"
SH
printf '#!/usr/bin/env bash\nexec python3 -I %q "$@"\n' "$here/fake-gh.py" > "$sandbox/bin/gh"
chmod +x "$sandbox/bin/git" "$sandbox/bin/gh"

# O git-cliff de mentira: as notas de um beta, sem Docker.
cat > "$work/scripts/ci/git-cliff.sh" <<'SH'
#!/usr/bin/env bash
printf '\n### Adicionado\n\n- Coisa do beta, com "aspas".\n- ::error::uma mensagem que imita um comando de workflow\n'
SH

# pipeline <ramo> [VARIÁVEL=valor]... [-- argumento...]: o publish-release.sh como o job de lançamento o roda, no commit atual.
pipeline() {
  local target=$1 vars=() args=()
  shift
  while [ $# -gt 0 ] && [ "$1" != -- ]; do vars+=("$1"); shift; done
  [ $# -eq 0 ] || { shift; args=("$@"); }
  out=$(cd "$work" && env -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY -u GH_DEBUG -u DEBUG PATH="$sandbox/bin:$PATH" PRISM_CI_RETRY_DELAY=0 \
    GH_TOKEN="$token" GITHUB_REPOSITORY="$repo" GITHUB_SERVER_URL="$server" GITHUB_API_URL="$api" GITHUB_REF_NAME="$target" \
    GITHUB_SHA="$(git -C "$work" rev-parse HEAD)" "${vars[@]+"${vars[@]}"}" bash scripts/ci/publish-release.sh --remote "$remote" "${args[@]+"${args[@]}"}" 2>&1)
  code=$?
}

expect() {
  local description=$1 want=$2 has=${3:-} lacks=${4:-} problem=
  total=$((total + 1))
  [ "$code" -eq "$want" ] || problem="saiu com $code, esperava $want"
  [ -z "$has" ] || [[ "$out" == *"$has"* ]] || problem="${problem:+$problem; }a saída não tem \"$has\""
  [ -z "$lacks" ] || [[ "$out" != *"$lacks"* ]] || problem="${problem:+$problem; }a saída tem \"$lacks\""
  if [ -z "$problem" ]; then
    echo "ok   $total - $description"
  else
    failures=$((failures + 1))
    echo "FALHA $total - $description: $problem"
    printf '%s\n' "$out" | sed 's/^/       | /'
  fi
}

check() {
  total=$((total + 1))
  if "${@:2}" > /dev/null 2>&1; then
    echo "ok   $total - $1"
  else
    failures=$((failures + 1))
    echo "FALHA $total - $1"
  fi
}

count() { grep -c -- "$1" "$FAKE/calls" || true; }
writes() { echo "$(count '^POST') $(count '^PATCH') $(count '^DELETE')"; }
is() { [ "$1" = "$2" ]; }
absent() { [ ! -e "$1" ]; }
release_json() { jq --arg tag "$1" '[.[] | select(.tag_name == $tag)] | .[0]' "$FAKE/releases.json"; }
release_field() { release_json "$1" | jq -r "$2"; }
reset_calls() { : > "$FAKE/calls"; : > "$FAKE/uploads"; }

# packages_at <versão dos pacotes> [conteúdo]: os dez pacotes de mentira em src/client/release (o que os jobs de pacote deixam).
packages_at() {
  local version=$1 file
  rm -rf "$work/src/client/release"
  mkdir -p "$work/src/client/release"
  for file in win-x64.exe win-x64.zip linux-x86_64.AppImage linux-amd64.deb linux-x86_64.rpm linux-x64.tar.gz mac-arm64.dmg mac-arm64.zip mac-x64.dmg mac-x64.zip; do
    printf '%s de mentira, %s\n' "$file" "${2:-$version}" > "$work/src/client/release/Prism-$version-$file"
  done
}

# release_commit <versão do package.json> [mensagem]: o projeto nessa versão, com a seção dela no changelog, num commit enviado ao
# ramo $branch do remoto. Escreve o commit.
release_commit() {
  set_version "$1"
  printf '# Changelog\n\n## Não lançado\n\n## [%s] - 2026-01-01\n\n### Adicionado\n\n- Coisa da %s, com "aspas", uma \\ barra e\tuma tabulação.\n' "$1" "$1" > "$work/CHANGELOG.md"
  commit_all "${2:-release: v$1}"
}

uploads_of() { grep -c -x -- "$1" "$FAKE/uploads" || true; }

# ============ 1. develop: o primeiro beta ============

head=$(release_commit 0.1.0 "feat: a primeira coisa")
first=$head
packages_at 0.1.0-beta.1
reset_calls
pipeline develop -- --expect v0.1.0-beta.1
expect "1. develop: lança o beta 1, do commit do merge" 0 "Prism 0.1.0-beta.1 publicado. A tag v0.1.0-beta.1 aponta para $head"
check "1. a tag v0.1.0-beta.1 aponta para o commit da execução" is "$(remote_commit_of v0.1.0-beta.1)" "$head"
check "1. a release está publicada e marcada como pré-lançamento" is "$(release_field v0.1.0-beta.1 '"\(.draft) \(.prerelease) \(.make_latest)"')" "false true false"
check "1. o título é Prism 0.1.0-beta.1" is "$(release_field v0.1.0-beta.1 .name)" "Prism 0.1.0-beta.1"
check "1. a release nasceu RASCUNHO (o POST leva draft) e só foi publicada no fim (um PATCH)" is "$(count '^POST 201 repos/') $(count '^PATCH 200 ')" "1 1"
check "1. a ordem: a lista de releases, o rascunho, os anexos e, por último, a publicação" is "$(sed -E 's/ .*//' "$FAKE/calls" | uniq | tr '\n' ' ')" "GET POST GET PATCH GET "
check "1. onze anexos (os dez pacotes e o SHA256SUMS), um envio cada" is "$(wc -l < "$FAKE/uploads" | tr -d ' ') $(sort "$FAKE/uploads" | uniq -d | wc -l | tr -d ' ')" "11 0"
check "1. a soma de cada anexo é a do arquivo" eval "[ \"\$(release_json v0.1.0-beta.1 | jq -r '.assets[] | select(.name == \"Prism-0.1.0-beta.1-win-x64.exe\") | .digest')\" = \"sha256:\$(sha256sum < '$work/src/client/release/Prism-0.1.0-beta.1-win-x64.exe' | cut -d ' ' -f 1)\" ]"
check "1. as notas do beta são as do git-cliff e terminam com o bloco das somas" eval "release_field v0.1.0-beta.1 .body | sed '/^$/d' | tail -n 1 | grep -qx '\`\`\`' && release_field v0.1.0-beta.1 .body | grep -q 'Coisa do beta'"
check "1. o SHA256SUMS anexado confere com os pacotes" eval "(cd '$work/src/client/release' && sha256sum --status -c SHA256SUMS)"
expect "1. a release saiu sem as releases imutáveis ligadas: o aviso fica à vista" 0 "AVISO (Release mutável)"

# ============ 2. repetir o job: nada muda ============

reset_calls
pipeline develop -- --expect v0.1.0-beta.1
expect "2. repetir: a tag do beta aponta para este commit e a release está completa, nada a publicar" 0 "já foi lançado deste commit" "Prism 0.1.0-beta.1 publicado"
check "2. a repetição só leu (nenhum POST, PATCH ou DELETE, nenhum anexo)" is "$(writes) $(wc -l < "$FAKE/uploads" | tr -d ' ')" "0 0 0 0"

# ============ 3. o plano e o estado: o job não confia no plano ============

second=$(release_commit 0.1.0 "fix: a segunda")
packages_at 0.1.0-beta.2
reset_calls
pipeline develop -- --expect v0.1.0-beta.1
expect "3. o plano diz beta 1, e o estado das tags diz beta 2: FALHA sem publicar (os pacotes levam o número do plano)" 1 "planejou v0.1.0-beta.1"
check "3. e não escreveu nada" is "$(writes)" "0 0 0"
pipeline develop
expect "3. sem plano nenhum (--expect ausente), um lançamento é recusado" 2 "Uso:"

packages_at 0.1.0-beta.1
pipeline develop -- --expect v0.1.0-beta.2
expect "3. os pacotes com a versão errada (beta 1, para publicar o beta 2): FALHA antes de escrever" 1 "faltou Prism-0.1.0-beta.2-win-x64.exe"
check "3. nada escrito" is "$(writes)" "0 0 0"

# ============ 4. o envio que falha no meio, e a repetição ============

packages_at 0.1.0-beta.2
echo "Prism-0.1.0-beta.2-linux-x86_64.AppImage" > "$FAKE/upload-falha"
reset_calls
pipeline develop -- --expect v0.1.0-beta.2
expect "4. o terceiro anexo falha: o job falha e diz que nada foi publicado" 1 "o envio de Prism-0.1.0-beta.2-linux-x86_64.AppImage falhou"
check "4. o rascunho existe com os dois primeiros anexos, e a tag não existe" is "$(release_field v0.1.0-beta.2 '"\(.draft) \(.assets | length)"') $(remote_commit_of v0.1.0-beta.2)" "true 2 "
check "4. o envio que falhou não foi repetido pelo script" is "$(uploads_of Prism-0.1.0-beta.2-linux-x86_64.AppImage)" 1
rm "$FAKE/upload-falha"
reset_calls
pipeline develop -- --expect v0.1.0-beta.2
expect "4. repetir: o rascunho deste commit é retomado, e os anexos que já estão lá com a mesma soma são pulados" 0 "Prism-0.1.0-beta.2-win-x64.zip já está no rascunho com a mesma soma"
expect "4. e o beta 2 sai" 0 "Prism 0.1.0-beta.2 publicado"
check "4. a repetição não criou outro rascunho e não reenviou os dois primeiros" is "$(count '^POST 201 repos/') $(uploads_of Prism-0.1.0-beta.2-win-x64.exe) $(uploads_of Prism-0.1.0-beta.2-win-x64.zip)" "0 0 0"
check "4. uma release só com essa tag" is "$(jq '[.[] | select(.tag_name == "v0.1.0-beta.2")] | length' "$FAKE/releases.json")" 1

# ============ 5. o envio que grava pela metade (502, anexo "starter") ============

third=$(release_commit 0.1.0 "feat: a terceira")
packages_at 0.1.0-beta.3
echo "Prism-0.1.0-beta.3-win-x64.zip" > "$FAKE/upload-grava-e-502"
reset_calls
pipeline develop -- --expect v0.1.0-beta.3
expect "5. o GitHub grava um anexo vazio e responde 502: o job falha" 1 "o envio de Prism-0.1.0-beta.3-win-x64.zip falhou"
rm "$FAKE/upload-grava-e-502"
reset_calls
pipeline develop -- --expect v0.1.0-beta.3
expect "5. repetir: o anexo pela metade é apagado e enviado de novo, e o beta sai" 0 "Prism 0.1.0-beta.3 publicado"
check "5. um DELETE de anexo, e o anexo completo no lugar" is "$(count '^DELETE 204 repos/Exemplo/prism/releases/assets/') $(release_json v0.1.0-beta.3 | jq -r '.assets[] | select(.name == "Prism-0.1.0-beta.3-win-x64.zip") | .state')" "1 uploaded"

# ============ 6. o rascunho velho de outro commit ============

fourth=$(release_commit 0.1.0 "feat: a quarta")
packages_at 0.1.0-beta.4
echo "Prism-0.1.0-beta.4-win-x64.exe" > "$FAKE/upload-falha"
pipeline develop -- --expect v0.1.0-beta.4
expect "6. uma execução para no meio e deixa o rascunho do beta 4" 1 "falhou"
rm "$FAKE/upload-falha"
old_draft=$(release_field v0.1.0-beta.4 .id)
fifth=$(release_commit 0.1.0 "feat: a quinta")
packages_at 0.1.0-beta.4
reset_calls
pipeline develop -- --expect v0.1.0-beta.4
expect "6. a execução do commit seguinte apaga o rascunho de outro commit e lança dele" 0 "apagando o rascunho $old_draft"
check "6. a tag do beta 4 aponta para o commit novo" is "$(remote_commit_of v0.1.0-beta.4)" "$fifth"
check "6. o rascunho velho não existe mais" is "$(jq --argjson id "$old_draft" '[.[] | select(.id == $id)] | length' "$FAKE/releases.json")" 0

# ============ 7. a criação do rascunho que responde com erro ============

sixth=$(release_commit 0.1.0 "feat: a sexta")
packages_at 0.1.0-beta.5
touch "$FAKE/cria-falha-500"
reset_calls
pipeline develop -- --expect v0.1.0-beta.5
expect "7. o POST do rascunho responde 500: o job falha" 1 "a criação do rascunho de v0.1.0-beta.5 falhou"
check "7. o POST não foi repetido (só a leitura se repete)" is "$(count '^POST 500 repos/')" 1
rm "$FAKE/cria-falha-500"
touch "$FAKE/cria-e-responde-502"
pipeline develop -- --expect v0.1.0-beta.5
expect "7. o POST cria o rascunho e responde 502: o job falha" 1 "a criação do rascunho de v0.1.0-beta.5 falhou"
rm "$FAKE/cria-e-responde-502"
reset_calls
pipeline develop -- --expect v0.1.0-beta.5
expect "7. repetir: o rascunho que ficou é retomado, sem criar outro" 0 "Prism 0.1.0-beta.5 publicado"
check "7. nenhum POST de rascunho na repetição" is "$(count '^POST 201 repos/')" 0

# ============ 8. a publicação recusada, e a que publica e responde com erro ============

seventh=$(release_commit 0.1.0 "feat: a sétima")
packages_at 0.1.0-beta.6
touch "$FAKE/publica-recusa-403"
reset_calls
pipeline develop -- --expect v0.1.0-beta.6
expect "8. a publicação é recusada (403): o job falha, o rascunho fica completo e a tag não existe" 1 "a publicação de v0.1.0-beta.6 foi recusada"
check "8. sem tag e com o rascunho completo" is "$(remote_commit_of v0.1.0-beta.6) $(release_field v0.1.0-beta.6 '"\(.draft) \(.assets | length)"')" " true 11"
rm "$FAKE/publica-recusa-403"
reset_calls
pipeline develop -- --expect v0.1.0-beta.6
expect "8. repetir: nada é enviado de novo, e a publicação sai" 0 "Prism 0.1.0-beta.6 publicado"
check "8. nenhum anexo reenviado" is "$(wc -l < "$FAKE/uploads" | tr -d ' ')" 0

eighth=$(release_commit 0.1.0 "feat: a oitava")
packages_at 0.1.0-beta.7
touch "$FAKE/publica-e-responde-502"
pipeline develop -- --expect v0.1.0-beta.7
expect "8. a publicação sai e responde 502: o job falha, sem afirmar que nada saiu" 1 "pode ter saído"
rm "$FAKE/publica-e-responde-502"
reset_calls
pipeline develop -- --expect v0.1.0-beta.7
expect "8. repetir: a tag e a release existem, nada a publicar" 0 "já foi lançado deste commit"
check "8. a repetição não escreveu nada" is "$(writes)" "0 0 0"

# ============ 9. a main: a estável, com as notas do changelog ============

branch=main
stable=$(release_commit 0.1.0 "Merge pull request #9 from Exemplo/develop")
packages_at 0.1.0
touch "$FAKE/imutavel"
reset_calls
pipeline main -- --expect v0.1.0
expect "9. main: lança a estável" 0 "Prism 0.1.0 publicado. A tag v0.1.0 aponta para $stable" "AVISO (Release mutável)"
check "9. não é pré-lançamento, e é a mais recente" is "$(release_field v0.1.0 '"\(.prerelease) \(.make_latest) \(.immutable)"')" "false true true"
check "9. as notas são a seção do changelog, com as somas" eval "release_field v0.1.0 .body | grep -q 'Coisa da 0.1.0' && release_field v0.1.0 .body | grep -q '^### Somas SHA-256$'"
check "9. e não têm o texto do git-cliff" eval "! release_field v0.1.0 .body | grep -q 'Coisa do beta'"

# ============ 10. a develop depois da estável, e o que não lança ============

branch=develop
git -C "$work" checkout -q "$eighth"
ninth=$(release_commit 0.1.0 "feat: depois da estável")
packages_at 0.1.0-beta.8
reset_calls
pipeline develop -- --expect v0.1.0-beta.8
expect "10. develop com a versão já lançada como estável: não lança (job verde), com o aviso" 0 "já tem a tag estável v0.1.0" "Prism 0.1.0-beta.8 publicado"
check "10. nada escrito" is "$(writes)" "0 0 0"

# ============ 11. a release de um commit que muda .github/workflows/ em relação ao ramo padrão ============

git -C "$work" checkout -q "$stable"
branch=main
mkdir -p "$work/.github/workflows"
echo "on: push" > "$work/.github/workflows/novo.yml"
set_version 0.2.0
printf '# Changelog\n\n## Não lançado\n\n## [0.2.0] - 2026-02-01\n\n- Coisa da 0.2.0.\n' > "$work/CHANGELOG.md"
workflows=$(commit_all "ci: um workflow que a develop não tem")
packages_at 0.2.0
reset_calls
pipeline main -- --expect v0.2.0
expect "11. o commit muda .github/workflows/ em relação à develop (o ramo padrão): FALHA antes de criar o rascunho, e diz por quê" 1 "acrescenta ou muda arquivos de .github/workflows/"
check "11. nada escrito" is "$(writes)" "0 0 0"
git -C "$work" rm -q -r .github
commit_all "ci: tira o workflow" > /dev/null

# ============ 12. as conferências antes de escrever ============

packages_at 0.2.0
rm "$work/src/client/release/Prism-0.2.0-mac-x64.dmg"
reset_calls
pipeline main -- --expect v0.2.0
expect "12. falta um pacote (o de macOS inclusive): FALHA antes de escrever" 1 "faltou Prism-0.2.0-mac-x64.dmg"
check "12. nada escrito" is "$(writes)" "0 0 0"
packages_at 0.2.0
pipeline main GITHUB_SHA="$first" -- --expect v0.2.0
expect "12. GITHUB_SHA que não é o commit do job: FALHA" 1 "não é o commit em que este job está"
pipeline main GITHUB_REPOSITORY="Exemplo/../prism" -- --expect v0.2.0
expect "12. GITHUB_REPOSITORY fora do formato dono/repositório: FALHA" 1 "dono/repositório"
pipeline main GH_TOKEN= -- --expect v0.2.0
expect "12. sem o token: FALHA" 1 "GH_TOKEN"
pipeline main GH_DEBUG=api -- --expect v0.2.0
expect "12. GH_DEBUG no ambiente (o gh escreveria o tráfego HTTP no log) não chega ao gh: o lançamento segue" 0 "Prism 0.2.0 publicado"

# ============ 13. a leitura que falha uma vez é repetida; o resto não ============

branch=develop
git -C "$work" checkout -q "$ninth"
set_version 0.3.0
printf '# Changelog\n\n## Não lançado\n' > "$work/CHANGELOG.md"
tenth=$(commit_all "feat: rumo à 0.3.0")
packages_at 0.3.0-beta.1
touch "$FAKE/lista-falha-uma-vez"
reset_calls
pipeline develop -- --expect v0.3.0-beta.1
expect "13. a lista de releases falha uma vez (502): a leitura é repetida, e o beta sai" 0 "Prism 0.3.0-beta.1 publicado"
check "13. a lista foi pedida de novo depois do 502" is "$(count '^GET 502 ') $(count '^GET 200 repos/Exemplo/prism/releases?per_page')" "1 1"
rm "$FAKE/lista-falha-uma-vez" "$FAKE/lista-ja-falhou"

# ============ 14. a soma que o GitHub não deu ============

eleventh=$(release_commit 0.3.0 "feat: sem soma")
packages_at 0.3.0-beta.2
touch "$FAKE/sem-digest"
reset_calls
pipeline develop -- --expect v0.3.0-beta.2
expect "14. sem a soma nos anexos, o tamanho é conferido, com o aviso" 0 "AVISO (Anexo sem soma)"
rm "$FAKE/sem-digest"

# ============ 15. por onde o token passa ============

check "15. o token não está em argumento de nenhuma chamada do gh" eval "! grep -qF '$token' '$FAKE/gh.argv'"
check "15. nem em argumento de nenhuma chamada do git" eval "! grep -qF '$token' '$FAKE/git.argv'"
check "15. nenhum endereço usado pelo git ou pelo gh leva usuário e senha" eval "! grep -qE '://[^/ ]*@' '$FAKE/git.argv' '$FAKE/gh.argv'"
check "15. o token não ficou em arquivo nenhum da pasta do ensaio" eval "! grep -rqF '$token' '$sandbox'"
check "15. o anexo vai ao endereço de envio da própria release (uploads.<servidor>)" grep -q -- " $upload/repos/$repo/releases/[0-9]*/assets?name=Prism-" "$FAKE/gh.argv"

# O auxiliar de credencial do git: só responde ao servidor do repositório, com o usuário x-access-token e o token do ambiente.
fill() { (cd "$work" && printf 'protocol=https\nhost=%s\n\n' "$1" | env PATH="$sandbox/bin:$PATH" GH_TOKEN="$token" GITHUB_SERVER_URL="$server" GIT_TRACE=1 GIT_TRACE_CURL=1 bash -c 'source scripts/ci/version.sh; remote_git credential fill' 2> "$FAKE/trace"); }
helper=$(fill github.example.invalid)
check "15. ao servidor do repositório, o auxiliar entrega x-access-token e o token do ambiente" eval "grep -qx 'username=x-access-token' <<< '$helper' && grep -qx 'password=$token' <<< '$helper'"
other=$(fill outro.example.invalid; fill github.example.invalid.outro.example.invalid)
check "15. a OUTRO servidor o auxiliar não responde: o token não sai" eval "! grep -qF '$token' <<< '$other'"
helper=$(fill github.example.invalid)
check "15. com GIT_TRACE=1, o rastreio não tem o token" eval "! grep -qF '$token' '$FAKE/trace'"

# No GitHub Actions as notas (texto de commit) vão ao log com os comandos de workflow desligados.
twelfth=$(release_commit 0.3.0 "feat: no Actions")
packages_at 0.3.0-beta.3
summary=$sandbox/resumo.md
: > "$summary"
pipeline develop GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY="$summary" -- --expect v0.3.0-beta.3
expect "15. no GitHub Actions o lançamento sai" 0 "Prism 0.3.0-beta.3 publicado"
token_line=$(printf '%s\n' "$out" | sed -n 's/^::stop-commands::\(prism-[0-9a-f]*\)$/\1/p' | head -n 1)
check "15. e a mensagem que imita ::error:: está entre ::stop-commands:: e o fim" eval "[ -n '$token_line' ] && printf '%s\n' \"\$out\" | sed -n '/^::stop-commands::$token_line\$/,/^::$token_line::\$/p' | grep -q '::error::uma mensagem'"
check "15. o resumo do job diz o que saiu" grep -q 'v0.3.0-beta.3' "$summary"

echo
echo "$((total - failures)) de $total casos passaram."
[ "$failures" -eq 0 ]
