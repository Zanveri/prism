#!/usr/bin/env bash
# Testes do check-version.sh (e da decisão de version.sh que ele usa): um projeto de mentira (fake-project.sh) com o package.json,
# o CHANGELOG.md e as tags do remoto que cada caso precisa, nos dois ramos que lançam (develop e main). A versão da vez (E) é a do
# package.json, ou, se ela já saiu como estável (ou é menor que a maior estável), a maior estável com o patch + 1.
# Rode com `bash scripts/ci/check-version.test.sh`; sai com 1 se algum caso falhar.
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

# O changelog de mentira: "Não lançado" com texto; 0.3.0 vazia; as demais com texto.
write_changelog() {
  cat > "$work/CHANGELOG.md" <<'MD'
# Changelog

## Não lançado

### Adicionado

- Coisa que ainda não saiu.

## [0.10.0] - 2026-03-01

- Coisa da 0.10.0.

## [0.3.0] - 2026-02-01

## [0.2.1] - 2026-01-03

- Correção da 0.2.1.

## [0.2.0] - 2026-01-02

### Corrigido

- Defeito da 0.2.0.

## [0.1.0] - 2026-01-01

- Coisa da 0.1.0.
MD
}

# run <ramo> [VARIÁVEL=valor...]: o script na pipeline de mentira do commit atual, com o remoto de mentira, que entra por ARGUMENTO.
run() {
  local target=$1
  shift
  out=$(cd "$work" && env -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY -u GITHUB_SHA -u GITHUB_REF_NAME -u GH_TOKEN -u GITHUB_SERVER_URL -u GITHUB_REPOSITORY "$@" bash scripts/ci/check-version.sh --remote "$remote" "$target" 2>&1)
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

is() { [ "$1" = "$2" ]; }

check() {
  total=$((total + 1))
  if "${@:2}" > /dev/null 2>&1; then
    echo "ok   $total - $1"
  else
    failures=$((failures + 1))
    echo "FALHA $total - $1"
  fi
}

new_commit() {
  echo "$1" > "$work/arquivo-$RANDOM$RANDOM.txt"
  commit_all "$1"
}

# clear_tags: o remoto sem tag nenhuma (cada bloco do teste monta as que precisa).
clear_tags() {
  local ref
  while read -r ref; do git -C "$remote" update-ref -d "$ref"; done < <(git -C "$remote" for-each-ref --format='%(refname)' refs/tags)
}

write_changelog
set_version 0.1.0
first=$(commit_all "primeiro")
home_branch=$(git -C "$work" symbolic-ref --short HEAD)

# ============ develop: o beta da próxima versão estável ============

run develop
expect "develop sem tag nenhuma: LANÇA o beta 1 da versão do package.json" 0 "LANÇA o beta v0.1.0-beta.1"
expect "o beta não precisa de seção no changelog nem a lê" 0 "pré-lançamento" "CHANGELOG"

# --- versões hostis, fora do formato ou com sufixo: nada vira nome de tag, de ramo ou de arquivo ---

for hostile in "0.1" "v0.1.0" "0.1.0-alpha.1" "01.2.3" "1.02.3" "1.2.3-beta.01" "1.2.3-beta" "1.2.3.4" "1.2.3 " "1.2.3;id" '1.2.3$(id)' "1.2.3/../x" "1.2.3-rc.1.2" "1234567890.0.0" "1.2.3+build" "-1.2.3" "1.2.x"; do
  set_version "$hostile"
  run develop
  expect "a versão \"$hostile\" é recusada pelo formato" 1 "não segue o formato X.Y.Z" "LANÇA"
done
for suffixed in "0.1.0-beta.1" "0.1.0-rc.2"; do
  set_version "$suffixed"
  run develop
  expect "a versão \"$suffixed\" no package.json é recusada: o sufixo quem põe é a pipeline" 1 "sem sufixo" "LANÇA"
  run main
  expect "e na main também" 1 "sem sufixo" "LANÇA"
done

printf '{\n  "name": "prism-client",\n  "devDependencies": {\n    "version": "9.9.9"\n  }\n}\n' > "$work/src/client/package.json"
run develop
expect "sem o campo version no primeiro nível falha (o de devDependencies não vale)" 1 'não achei o campo "version"'
set_version 0.1.0

# --- o número do beta: um a mais que o maior já publicado da versão, por nome exato ---

remote_tag v0.1.0-beta.1 "$first"
second=$(new_commit "segundo")
run develop
expect "com o beta 1 num commit anterior, LANÇA o beta 2" 0 "LANÇA o beta v0.1.0-beta.2"

remote_tag v0.1.0-beta.2 "$first" "Prism 0.1.0-beta.2"
remote_tag v0.1.0-beta.10 "$first"
run develop
expect "a conta é por número, e não por texto: depois do beta 10 vem o 11 (tag anotada inclusive)" 0 "LANÇA o beta v0.1.0-beta.11"

remote_tag v0.1.0-beta.010 "$first"
remote_tag v0.1.0-beta.99x "$first"
git -C "$remote" update-ref refs/tags/x/refs/tags/v0.1.0-beta.50 "$first"
git -C "$remote" update-ref refs/heads/refs/tags/v0.1.0-beta.60 "$first"
run develop
expect "tags fora do formato, a tag-isca (x/refs/tags/…) e o ramo-isca não contam no número" 0 "LANÇA o beta v0.1.0-beta.11" "beta.51"
git -C "$remote" tag -d v0.1.0-beta.010 v0.1.0-beta.99x > /dev/null
git -C "$remote" update-ref -d refs/tags/x/refs/tags/v0.1.0-beta.50
git -C "$remote" update-ref -d refs/heads/refs/tags/v0.1.0-beta.60

# --- já lançado daqui; e o commit mais antigo que o último beta ---

remote_tag v0.1.0-beta.11 "$second"
run develop
expect "o beta 11 aponta para este commit: JÁ LANÇADA, e não lança outro" 0 "JÁ LANÇADA. A tag v0.1.0-beta.11 aponta para este commit" "LANÇA o beta"

third=$(new_commit "terceiro")
git -C "$remote" tag -d v0.1.0-beta.11 > /dev/null
remote_tag v0.1.0-beta.11 "$third"
git -C "$work" checkout -q "$second"
run develop
expect "o último beta saiu de um commit à frente deste: NÃO LANÇA (job verde), e diz por quê" 0 "não está na história deste" "LANÇA o beta"
expect "e o aviso fica à vista (AVISO fora do GitHub Actions)" 0 "AVISO (Não lança)"

summary=$sandbox/resumo.md
: > "$summary"
git -C "$work" checkout -q "$second"
run develop GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY="$summary"
expect "no GitHub Actions o aviso é uma anotação ::warning" 0 "::warning title=Não lança::"
check "e uma seção no resumo do job" grep -q 'Não lança' "$summary"
git -C "$work" checkout -q "$home_branch"

fourth=$(new_commit "quarto")
run develop
expect "um commit depois do último beta: LANÇA o seguinte" 0 "LANÇA o beta v0.1.0-beta.12"

outputs=$sandbox/outputs
: > "$outputs"
run develop GITHUB_ACTIONS=true GITHUB_OUTPUT="$outputs"
check "no GitHub Actions o plano vai aos outputs do job: lança, a tag e a versão DO BETA para os pacotes" is "$(cat "$outputs")" "$(printf 'lanca=true\ntag=v0.1.0-beta.12\nversao=0.1.0-beta.12')"

# ============ develop depois de uma estável: a versão da vez é a seguinte à maior estável ============

remote_tag v0.1.0 "$third" "Prism 0.1.0"
run develop
expect "develop com o package.json na versão que já saiu como estável: o beta é o da PRÓXIMA (0.1.1), e o número volta a 1" 0 "LANÇA o beta v0.1.1-beta.1" "já tem a tag estável"
expect "e a saída diz por que a versão da vez não é a do package.json (sem aviso: é o caso normal)" 0 "a versão da vez é a 0.1.1" "AVISO"
: > "$outputs"
run develop GITHUB_ACTIONS=true GITHUB_OUTPUT="$outputs"
check "no GitHub Actions o plano leva a versão DA VEZ: a tag e a versão dos pacotes são as do beta 0.1.1-beta.1" is "$(cat "$outputs")" "$(printf 'lanca=true\ntag=v0.1.1-beta.1\nversao=0.1.1-beta.1')"

remote_tag v0.1.1-beta.1 "$fourth"
fifth=$(new_commit "quinto")
run develop
expect "o número do beta da versão nova conta só os betas dela: depois do 0.1.1-beta.1 vem o beta.2 (os da 0.1.0 não contam)" 0 "LANÇA o beta v0.1.1-beta.2"

set_version 0.2.0
run develop
expect "package.json MAIOR que a maior estável: vale ele, e o primeiro beta dele é o 1" 0 "LANÇA o beta v0.2.0-beta.1" "a versão da vez é"

set_version 0.0.9
run develop
expect "package.json MENOR que a maior estável: não reprova mais, vira a seguinte à estável (0.1.1)" 0 "LANÇA o beta v0.1.1-beta.2" "não seria maior"
expect "e o aviso da correção fica à vista" 0 "AVISO (Versão corrigida)"
run develop GITHUB_ACTIONS=true
expect "no GitHub Actions o aviso da correção é uma anotação ::warning" 0 "::warning title=Versão corrigida::"

set_version 0.1
run develop
expect "o formato inválido segue reprovando, mesmo com estável lançada" 1 "não segue o formato X.Y.Z" "LANÇA"
set_version 0.0.9-beta.1
run develop
expect "o sufixo no package.json também" 1 "sem sufixo" "LANÇA"

# --- a regressão frente a um BETA continua reprovando: só a maior ESTÁVEL é corrigida ---

remote_tag v0.3.0-beta.2 "$first"
set_version 0.2.0
run develop
expect "o beta 0.2.0-beta.1 não seria maior que o 0.3.0-beta.2 já publicado: FALHA" 1 "não seria maior que a 0.3.0-beta.2"
set_version 0.3.0
run develop
expect "a mesma versão do beta publicado: o número segue (0.3.0-beta.3)" 0 "LANÇA o beta v0.3.0-beta.3"
set_version 0.10.0
run develop
expect "a comparação é número a número: 0.10.0 vem depois da 0.3.0" 0 "LANÇA o beta v0.10.0-beta.1"

# ============ main: a estável de sempre, com a seção no changelog ou sem ela ============

clear_tags
remote_tag v0.1.0-beta.3 "$first"
set_version 0.1.0
branch=main
main_commit=$(commit_all "release: v0.1.0")
run main
expect "main sem tag estável nenhuma (só betas): LANÇA a primeira estável, a versão do package.json" 0 "LANÇA a versão estável v0.1.0" "a versão da vez é"
expect "a seção da versão está no changelog: é dela que saem as notas" 0 'As notas saem da seção "## [0.1.0] - AAAA-MM-DD"'

set_version 0.9.0
commit_all "versão sem seção" > /dev/null
run main
expect "main com a versão SEM a seção no changelog: LANÇA do mesmo jeito" 0 "LANÇA a versão estável v0.9.0" "AVISO"
expect "e diz que as notas saem do git-cliff" 0 "as notas saem do git-cliff"

set_version 0.3.0
run main
expect "a seção com o título certo e sem texto não conta: LANÇA, com as notas do git-cliff" 0 "as notas saem do git-cliff" "AVISO"

rm "$work/CHANGELOG.md"
set_version 0.9.0
run main
expect "sem CHANGELOG.md: LANÇA, com as notas do git-cliff" 0 "LANÇA a versão estável v0.9.0" "AVISO"
expect "e diz que as notas saem do git-cliff" 0 "as notas saem do git-cliff"

# O título da seção tem de ser EXATAMENTE "## [X.Y.Z] - AAAA-MM-DD": um título que cita a versão de outro jeito é ERRO, para o texto
# escrito não ser trocado, sem ninguém ver, pelas notas do git-cliff.
for heading in "## [0.9.0]" "## 0.9.0 - 2026-02-01" "## [v0.9.0] - 2026-02-01" "## [0.9.0] - 01/02/2026" "## [0.9.0] - 2026-13-01" "## [0.9.0] - 2026-02-32" "## [0.9.0] 2026-02-01" "##  [0.9.0] - 2026-02-01" "## Versão 0.9.0"; do
  printf '# Changelog\n\n## Não lançado\n\n%s\n\n- Coisa da 0.9.0.\n' "$heading" > "$work/CHANGELOG.md"
  run main
  expect "o título \"$heading\" cita a 0.9.0 fora do formato: FALHA" 1 "não está no formato exato" "LANÇA a versão"
done
printf '# Changelog\n\n## Não lançado\n\n## [0.19.0] - 2026-02-01\n\n- Outra.\n\n## 10.9.0\n\n- Outra.\n' > "$work/CHANGELOG.md"
run main
expect "um título de outra versão (0.19.0, 10.9.0) não é o da 0.9.0: LANÇA, sem erro, com as notas do git-cliff" 0 "as notas saem do git-cliff" "não está no formato exato"
for heading in "## [0.9.0] - 2026-02-01" "## [0.9.0] - 2026-02-01 [YANKED]"; do
  printf '# Changelog\n\n## Não lançado\n\n%s\n\n- Coisa da 0.9.0.\n\n## [0.8.0] - 2026-01-01\n\n- Outra.\n' "$heading" > "$work/CHANGELOG.md"
  run main
  expect "o título \"$heading\" é a seção da 0.9.0: LANÇA, com as notas dela" 0 'As notas saem da seção "## [0.9.0] - AAAA-MM-DD"'
done
write_changelog

# --- depois de uma estável: a versão da vez é a seguinte, e sem commit novo não há o que lançar ---

clear_tags
set_version 0.2.0
stable_commit=$(commit_all "release: v0.2.0")
remote_tag v0.2.0 "$stable_commit" "Prism 0.2.0"
run main
expect "main no commit da maior estável: JÁ LANÇADA" 0 "JÁ LANÇADA. A tag v0.2.0 aponta para este commit" "LANÇA a versão"
expect "e diz que não há nada novo desde ela" 0 "nada novo desde a v0.2.0"
other=$(new_commit "outro na main")
run main
expect "main com commit novo e o package.json ainda na versão que saiu (0.2.0): LANÇA a seguinte, a 0.2.1" 0 "LANÇA a versão estável v0.2.1" "AVISO"
expect "a seção 0.2.1 do changelog é a das notas: a busca é pela versão da vez, e não pela do package.json" 0 'As notas saem da seção "## [0.2.1] - AAAA-MM-DD"'

git -C "$work" checkout -q "$first"
run main
expect "main num commit da história da maior estável: NÃO LANÇA (job verde), nada novo desde a v0.2.0" 0 "nada novo desde a v0.2.0" "LANÇA a versão"
expect "o aviso fica à vista" 0 "AVISO (Não lança)"
: > "$outputs"
run main GITHUB_ACTIONS=true GITHUB_OUTPUT="$outputs"
check "sem lançamento, os outputs dizem que não lança, e os pacotes levam a versão do package.json" is "$(cat "$outputs")" "$(printf 'lanca=false\ntag=\nversao=0.1.0')"
git -C "$work" checkout -q "$home_branch"

# O commit da maior estável que este clone não tem: sem ele não dá para saber se há commit novo, e "não consegui perguntar" não vira
# "não há".
ghost=$(git -C "$remote" commit-tree "$(git -C "$remote" hash-object -t tree /dev/null)" -m "fantasma")
remote_tag v9.0.0 "$ghost"
run main
expect "a maior estável aponta para um commit que o clone não tem: FALHA, e diz o que falta" 1 "não está neste clone" "LANÇA a versão"
git -C "$remote" tag -d v9.0.0 > /dev/null

# --- package.json menor que a estável, na main ---

set_version 0.1.1
run main
expect "main com o package.json MENOR que a maior estável (0.2.0): não reprova, vira a 0.2.1, com o aviso" 0 "LANÇA a versão estável v0.2.1" "não é maior"
expect "o aviso da correção fica à vista" 0 "AVISO (Versão corrigida)"
set_version 0.10.0
run main
expect "package.json MAIOR que a estável: 0.10.0 depois da 0.2.0 LANÇA (a comparação é número a número)" 0 "LANÇA a versão estável v0.10.0" "a versão da vez é"

git -C "$remote" update-ref refs/tags/x/refs/tags/v0.10.0 "$first"
run main
expect "uma tag-isca (x/refs/tags/v0.10.0) não faz a versão 0.10.0 passar por lançada" 0 "LANÇA a versão estável v0.10.0" "JÁ LANÇADA"
git -C "$remote" update-ref -d refs/tags/x/refs/tags/v0.10.0
git -C "$remote" update-ref refs/heads/refs/tags/v0.10.0 "$first"
run main
expect "um ramo comum chamado refs/tags/v0.10.0 também não" 0 "LANÇA a versão estável v0.10.0" "JÁ LANÇADA"
git -C "$remote" update-ref -d refs/heads/refs/tags/v0.10.0

remote_tag v0.11.0-beta.1 "$first"
run main
expect "a estável da vez que não seria maior que um beta já publicado (0.11.0-beta.1): FALHA (regrediu)" 1 "não é maior que a 0.11.0-beta.1"
expect "a mensagem diz que nada foi gerado nem enviado" 1 "Nada foi gerado nem enviado"
git -C "$remote" tag -d v0.11.0-beta.1 > /dev/null

# ============ o ramo, o commit e o remoto ============

run feat/qualquer
expect "outro ramo: FALHA (a pipeline só lança de develop e main)" 1 "só lança dos ramos develop e main"
out=$(cd "$work" && env -u GITHUB_ACTIONS -u GITHUB_SHA GITHUB_REF_NAME=main bash scripts/ci/check-version.sh --remote "$remote" 2>&1); code=$?
expect "sem argumento vale o GITHUB_REF_NAME (o ramo da pipeline)" 0 "LANÇA a versão estável v0.10.0"
out=$(cd "$work" && env -u GITHUB_ACTIONS -u GITHUB_SHA -u GITHUB_REF_NAME bash scripts/ci/check-version.sh --remote "$remote" 2>&1); code=$?
expect "sem argumento e sem GITHUB_REF_NAME é erro de uso" 2 "Uso:"
run main GITHUB_SHA="$first"
expect "GITHUB_SHA que não é o commit em que o job está: FALHA" 1 "não é o commit em que este job está"

out=$(cd "$work" && env -u GITHUB_ACTIONS -u GITHUB_SHA bash scripts/ci/check-version.sh --remote "$sandbox/nao-existe.git" main 2>&1); code=$?
expect "remoto que não responde falha, e não é dado como lançamento" 1 "não consegui ler as tags do remoto" "LANÇA"

# Nenhuma variável de ambiente troca o remoto: só o argumento --remote, e, fora da pipeline, o origin.
git init -q --bare "$sandbox/outro.git"
git -C "$work" push -q "$sandbox/outro.git" HEAD:refs/heads/main
git -C "$sandbox/outro.git" tag v0.10.0 "$(git -C "$work" rev-parse HEAD)"
run main PRISM_GIT_REMOTE="$sandbox/outro.git" release_remote_arg="$sandbox/outro.git"
expect "PRISM_GIT_REMOTE e release_remote_arg no ambiente não trocam o remoto" 0 "LANÇA a versão estável v0.10.0" "JÁ LANÇADA"
git -C "$work" remote add origin "$remote"
out=$(cd "$work" && env -u GITHUB_ACTIONS -u GITHUB_SHA -u GITHUB_SERVER_URL -u GITHUB_REPOSITORY PRISM_GIT_REMOTE="$sandbox/outro.git" release_remote_arg="$sandbox/outro.git" bash scripts/ci/check-version.sh main 2>&1); code=$?
expect "sem --remote, fora da pipeline, vale o origin" 0 "LANÇA a versão estável v0.10.0" "JÁ LANÇADA"
out=$(cd "$work" && bash scripts/ci/check-version.sh --remote 2>&1); code=$?
expect "--remote sem valor é erro de uso" 2 "Uso:"
out=$(cd "$work" && bash scripts/ci/check-version.sh --inventada main 2>&1); code=$?
expect "opção desconhecida é erro de uso" 2 "Uso:"

echo
echo "$((total - failures)) de $total casos passaram."
[ "$failures" -eq 0 ]
