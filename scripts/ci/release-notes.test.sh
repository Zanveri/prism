#!/usr/bin/env bash
# Testes do release-notes.sh: uma cópia do script num projeto de mentira, com o CHANGELOG.md e o SHA256SUMS que cada caso pede.
# Rode com `bash scripts/ci/release-notes.test.sh`; sai com 1 se algum caso falhar.
#
# O caso "CONTRATO" fixa, byte a byte, o bloco das somas que o atualizador do app lê (src/client/electron/update/checksums.ts).
# Se ele falhar, o formato mudou: NÃO acerte o esperado sem mudar o leitor no mesmo pull request, ou todo Prism instalado passa a
# recusar a atualização.
#
# As frases das plataformas que faltam (a falha do pacote de uma plataforma não segura o lançamento das outras) saem das somas: um
# grupo de packages.txt que não está INTEIRO nelas faltou. Por isso cada caso escreve as somas da versão que roda, com os grupos que
# a pipeline espera (um beta: Windows e Linux; uma estável: os quatro), e os casos das frases escolhem os grupos.
set -uo pipefail

real=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-notes.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/scripts/ci" "$work/src/client/release"
cp "$real" "$(dirname "$real")/version.sh" "$(dirname "$real")/actions.sh" "$(dirname "$real")/packages.sh" "$(dirname "$real")/packages.txt" "$work/scripts/ci/"
# shellcheck source=packages.sh
source "$(dirname "$real")/packages.sh"
printf '{\n  "name": "prism-client",\n  "version": "0.2.0",\n  "private": true\n}\n' > "$work/src/client/package.json"

total=0
failures=0
out=
code=0

a=$(printf 'a%.0s' {1..64})
b=$(printf 'b%.0s' {1..64})
c=$(printf 'c%.0s' {1..64})

write_changelog() {
  cat > "$work/CHANGELOG.md" <<'MD'
# Changelog

Abertura.

## Não lançado

### Adicionado

- Coisa de pré-lançamento.

## [0.2.0] - 2026-01-02

### Corrigido

- Defeito da 0.2.0.

## [0.1.0] - 2026-01-01

### Adicionado

- Coisa da 0.1.0.
MD
}

# write_sums <versão> <grupo>...: o SHA256SUMS com os arquivos desses grupos (a soma do .exe é `a`, a do tar.gz do Linux é `b`, e as
# outras são `c`).
write_sums() {
  local version=$1 file
  shift
  : > "$work/src/client/release/SHA256SUMS"
  for file in $(package_files "$version" "$@"); do
    case "$file" in
      *-win-x64.exe) printf '%s  %s\n' "$a" "$file" ;;
      *-linux-x64.tar.gz) printf '%s  %s\n' "$b" "$file" ;;
      *) printf '%s  %s\n' "$c" "$file" ;;
    esac >> "$work/src/client/release/SHA256SUMS"
  done
}

# Sem pedido em contrário, o `run` escreve as somas completas do que a pipeline espera daquela versão (um beta: Windows e Linux; uma
# estável: as quatro plataformas). Os casos que precisam de somas próprias desligam isto (`sums_auto=0`) e as escrevem.
sums_auto=1
sums_for() {
  local version=0.2.0 kind=stable
  while [ $# -gt 0 ]; do
    case "$1" in
      --beta) kind=beta ;;
      --since | --sums) shift ;;
      -*) ;;
      *) version=${1#v} ;;
    esac
    shift
  done
  # Uma versão fora do formato (o caso da recusa) fica com as somas de antes.
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?$ ]] || return 0
  write_sums "$version" $(expected_groups "$kind")
}

# run [argumentos do release-notes.sh]
run() {
  if [ "$sums_auto" -eq 1 ]; then sums_for "$@"; fi
  out=$(cd "$work" && bash scripts/ci/release-notes.sh "$@" 2>&1)
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

write_changelog

run 0.2.0
expect "versão estável com seção: usa a seção, e só ela" 0 "Defeito da 0.2.0." "Coisa da 0.1.0."
expect "as notas terminam com as somas SHA-256 dos pacotes" 0 "$b  Prism-0.2.0-linux-x64.tar.gz"
expect "com as quatro plataformas inteiras, as notas não dizem que falta pacote" 0 "" "saiu sem o pacote"
expect "o título da seção não entra nas notas (a release já tem o dela)" 0 "" "## [0.2.0]"
total=$((total + 1))
if grep -q 'Somas SHA-256' "$work/release-notes.md" && ! grep -q 'Coisa de pré-lançamento' "$work/release-notes.md"; then echo "ok   $total - release-notes.md tem as somas e não tem a seção \"Não lançado\""; else failures=$((failures + 1)); echo "FALHA $total - conteúdo de release-notes.md"; fi

# CONTRATO com o atualizador do app: o arquivo inteiro, byte a byte. O bloco é o ÚLTIMO título "### Somas SHA-256", uma linha em
# branco, a cerca sem linguagem, as linhas do SHA256SUMS, a cerca que fecha e NADA depois. (A linha em branco do começo é a que
# o CHANGELOG.md tem depois do título da seção.)
total=$((total + 1))
sums_block=$(cat "$work/src/client/release/SHA256SUMS")
expected=$(printf '\n### Corrigido\n\n- Defeito da 0.2.0.\n\n### Somas SHA-256\n\n```\n%s\n```\nfim' "$sums_block")
if [ "$(cat "$work/release-notes.md"; printf fim)" = "$expected" ]; then
  echo "ok   $total - CONTRATO: o bloco das somas tem o título, a cerca e as linhas que o atualizador lê, e nada depois dele"
else
  failures=$((failures + 1))
  echo "FALHA $total - CONTRATO: o bloco das somas mudou de formato. O atualizador do app (src/client/electron/update/checksums.ts) o lê assim; mude os dois juntos."
  diff <(cat "$work/release-notes.md"; printf fim) <(printf '%s' "$expected") | sed 's/^/       | /'
fi

run
expect "sem argumento vale a versão de src/client/package.json" 0 "seção 0.2.0 do CHANGELOG.md"

run v0.2.0
expect "aceita a versão com o v na frente" 0 "seção 0.2.0 do CHANGELOG.md"

# --- beta: as notas do git-cliff desde a tag anterior, e o mesmo bloco das somas ---

# O git-cliff de mentira: anota os argumentos e escreve o corpo que o caso pediu ($work/cliff-body), como o de verdade escreveria.
cat > "$work/scripts/ci/git-cliff.sh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$(dirname "${BASH_SOURCE[0]}")/../../cliff-args"
[ ! -e "$(dirname "${BASH_SOURCE[0]}")/../../cliff-falha" ] || { echo "git-cliff de mentira: falhou" >&2; exit 3; }
cat "$(dirname "${BASH_SOURCE[0]}")/../../cliff-body"
SH
printf '\n### Adicionado\n\n- **client:** Coisa nova do beta\n\n### Corrigido\n\n- Defeito do beta\n' > "$work/cliff-body"

run --beta --since v0.1.0 0.2.0-beta.3
expect "beta: as notas são as do git-cliff" 0 "Coisa nova do beta" "Coisa de pré-lançamento."
expect "beta: o changelog não entra (nem a seção \"Não lançado\" nem a de uma versão)" 0 "" "Defeito da 0.2.0."
expect "beta: diz que é beta e de onde as notas partem" 0 "o que mudou desde a 0.1.0"
expect "beta: a frase fixa diz que os betas saem para Windows e Linux e que o macOS atualiza pelas estáveis" 0 "Os betas saem para Windows e Linux; no macOS, as atualizações chegam pelas versões estáveis."
expect "beta com Windows e Linux inteiros: a falta do macOS é o esperado, e não vira frase de pacote que faltou" 0 "" "saiu sem o pacote"
total=$((total + 1))
if [ "$(cat "$work/cliff-args")" = "--config cliff.toml --strip all v0.1.0..HEAD" ]; then echo "ok   $total - beta: o git-cliff roda com o cliff.toml do repositório, sem cabeçalho, desde a tag anterior e sem o --unreleased (que faria o git-cliff ignorar o começo do intervalo)"; else failures=$((failures + 1)); echo "FALHA $total - argumentos do git-cliff: $(cat "$work/cliff-args")"; fi
total=$((total + 1))
sums_block=$(cat "$work/src/client/release/SHA256SUMS")
expected=$(printf 'Versão beta (pré-lançamento), para experimentar. Os betas saem para Windows e Linux; no macOS, as atualizações chegam pelas versões estáveis. Abaixo, o que mudou desde a 0.1.0.\n\n### Adicionado\n\n- **client:** Coisa nova do beta\n\n### Corrigido\n\n- Defeito do beta\n\n### Somas SHA-256\n\n```\n%s\n```\nfim' "$sums_block")
if [ "$(cat "$work/release-notes.md"; printf fim)" = "$expected" ]; then
  echo "ok   $total - CONTRATO (beta): as notas terminam com o mesmo bloco das somas, e nada depois dele"
else
  failures=$((failures + 1))
  echo "FALHA $total - CONTRATO (beta): o arquivo não é o esperado"
  diff <(cat "$work/release-notes.md"; printf fim) <(printf '%s' "$expected") | sed 's/^/       | /'
fi

printf '\n### Adicionado\n\n- ::error::uma mensagem de commit que imita um comando\n' > "$work/cliff-body"
out=$(cd "$work" && GITHUB_ACTIONS=true bash scripts/ci/release-notes.sh --beta --since v0.1.0 0.2.0-beta.3 2>&1); code=$?
token=$(printf '%s\n' "$out" | sed -n 's/^::stop-commands::\(prism-[0-9a-f]*\)$/\1/p' | head -n 1)
total=$((total + 1))
if [ -n "$token" ] && printf '%s\n' "$out" | grep -qx "::$token::" && [ "$(printf '%s\n' "$out" | grep -n '::error::' | cut -d: -f1)" -gt "$(printf '%s\n' "$out" | grep -n '^::stop-commands::' | cut -d: -f1)" ]; then
  echo "ok   $total - no GitHub Actions as notas vão ao log entre ::stop-commands:: e o fim, com senha sorteada (texto de commit não vira comando)"
else
  failures=$((failures + 1)); echo "FALHA $total - as notas não foram ao log com os comandos de workflow desligados"; printf '%s\n' "$out" | sed 's/^/       | /'
fi
printf '\n### Adicionado\n\n- **client:** Coisa nova do beta\n\n### Corrigido\n\n- Defeito do beta\n' > "$work/cliff-body"

run --beta 0.1.0-beta.1
expect "o primeiro beta (sem tag anterior) usa o histórico inteiro" 0 "tudo o que entrou até aqui"
total=$((total + 1))
if [ "$(cat "$work/cliff-args")" = "--config cliff.toml --strip all --unreleased" ]; then echo "ok   $total - e o git-cliff roda sem intervalo"; else failures=$((failures + 1)); echo "FALHA $total - argumentos do git-cliff sem tag anterior: $(cat "$work/cliff-args")"; fi

printf '\n\n' > "$work/cliff-body"
run --beta --since v0.1.0-beta.1 0.1.0-beta.2
expect "beta sem nenhuma mudança para quem usa: as notas dizem isso (nunca ficam vazias)" 0 "Nenhuma mudança que apareça para quem usa o Prism"

touch "$work/cliff-falha"
run --beta --since v0.1.0 0.2.0-beta.3
expect "o git-cliff que falha derruba as notas" 1 "o git-cliff falhou"
rm "$work/cliff-falha"

run --beta --since 'v0.1.0;id' 0.2.0-beta.3
expect "a tag anterior fora do formato é recusada (ela vira argumento do git-cliff)" 1 "não é uma tag de versão"
run --beta 0.2.0
expect "--beta com uma versão estável é recusado" 1 "não é a versão de um beta"
run 0.2.0-beta.1
expect "um beta sem --beta é recusado (as notas dele não vêm do changelog)" 1 "use --beta"
run 0.2.0-rc.1
expect "rc também não sai do changelog" 1 "use --beta"

# --- estável SEM a seção no changelog: as notas do git-cliff, como as do beta, desde a estável anterior ---

printf '\n### Adicionado\n\n- **client:** Coisa nova do beta\n\n### Corrigido\n\n- Defeito do beta\n' > "$work/cliff-body"
rm -f "$work/cliff-args"
run --since v0.1.0 0.2.0
expect "estável COM a seção: é a seção que vale (o --since é ignorado)" 0 "seção 0.2.0 do CHANGELOG.md" "git-cliff"
total=$((total + 1))
if [ ! -e "$work/cliff-args" ]; then echo "ok   $total - e o git-cliff nem roda"; else failures=$((failures + 1)); echo "FALHA $total - o git-cliff rodou, com a seção no changelog"; fi

run --since v0.2.0 0.3.0
expect "estável SEM a seção: as notas são as do git-cliff" 0 "Coisa nova do beta" "Defeito da 0.2.0."
expect "e a saída diz que a seção falta e desde que tag as notas partem" 0 'sem a seção "## [0.3.0] - AAAA-MM-DD"' "falha"
expect "sem o título da versão nem a faixa de beta: a estável não leva cabeçalho" 0 "" "Versão beta"
total=$((total + 1))
if [ "$(cat "$work/cliff-args")" = "--config cliff.toml --strip all v0.2.0..HEAD" ]; then echo "ok   $total - estável: o git-cliff roda como no beta, desde a estável anterior"; else failures=$((failures + 1)); echo "FALHA $total - argumentos do git-cliff na estável: $(cat "$work/cliff-args")"; fi
total=$((total + 1))
sums_block=$(cat "$work/src/client/release/SHA256SUMS")
expected=$(printf '\n### Adicionado\n\n- **client:** Coisa nova do beta\n\n### Corrigido\n\n- Defeito do beta\n\n### Somas SHA-256\n\n```\n%s\n```\nfim' "$sums_block")
if [ "$(cat "$work/release-notes.md"; printf fim)" = "$expected" ]; then
  echo "ok   $total - CONTRATO (estável do git-cliff): as notas terminam com o mesmo bloco das somas, e nada depois dele"
else
  failures=$((failures + 1))
  echo "FALHA $total - CONTRATO (estável do git-cliff): o arquivo não é o esperado"
  diff <(cat "$work/release-notes.md"; printf fim) <(printf '%s' "$expected") | sed 's/^/       | /'
fi

run 0.3.0
expect "estável sem a seção e sem a tag anterior (a primeira estável): o histórico inteiro" 0 "tudo o que entrou até aqui"
total=$((total + 1))
if [ "$(cat "$work/cliff-args")" = "--config cliff.toml --strip all --unreleased" ]; then echo "ok   $total - e o git-cliff roda sem intervalo"; else failures=$((failures + 1)); echo "FALHA $total - argumentos do git-cliff sem tag anterior: $(cat "$work/cliff-args")"; fi

printf '# Changelog\n\n## [0.3.0] - 2026-02-01\n\n## [0.2.0] - 2026-01-02\n\n- Defeito da 0.2.0.\n' > "$work/CHANGELOG.md"
run --since v0.2.0 0.3.0
expect "a seção com o título certo e sem texto não conta: as notas saem do git-cliff" 0 "Coisa nova do beta"
rm "$work/CHANGELOG.md"
run --since v0.2.0 0.3.0
expect "sem CHANGELOG.md: as notas saem do git-cliff" 0 "Coisa nova do beta"
write_changelog

printf '\n\n' > "$work/cliff-body"
run --since v0.2.0 0.3.0
expect "estável sem nenhuma mudança para quem usa: as notas dizem isso (nunca ficam vazias)" 0 "Nenhuma mudança que apareça para quem usa o Prism"
printf '\n### Adicionado\n\n- **client:** Coisa nova do beta\n\n### Corrigido\n\n- Defeito do beta\n' > "$work/cliff-body"

touch "$work/cliff-falha"
run --since v0.2.0 0.3.0
expect "o git-cliff que falha derruba as notas da estável também" 1 "o git-cliff falhou"
rm "$work/cliff-falha"
run --since 'v0.2.0;id' 0.3.0
expect "a tag anterior da estável fora do formato é recusada (ela vira argumento do git-cliff)" 1 "não é uma tag de versão"

run '0.2.0;id'
expect "versão fora do formato falha" 1 "não segue o formato"

# --- as plataformas que faltam: uma frase por conjunto, logo no começo das notas, no beta e na estável ---

# sums_of <versão> <grupo>...: as somas só desses grupos, e o `run` não as troca.
sums_of() {
  sums_auto=0
  write_sums "$@"
}
sentence_win='Esta versão saiu sem o pacote de Windows, que não foi gerado nesta execução. Quem usa Windows continua na versão anterior e recebe a próxima que tiver o pacote.'
sentence_linux='Esta versão saiu sem o pacote de Linux, que não foi gerado nesta execução. Quem usa Linux continua na versão anterior e recebe a próxima que tiver o pacote.'
sentence_mac='Esta versão saiu sem o pacote de macOS (Apple Silicon e Intel), que não foi gerado nesta execução. Quem usa macOS continua na versão anterior e recebe a próxima que tiver o pacote.'
beta_sentence='Os betas saem para Windows e Linux; no macOS, as atualizações chegam pelas versões estáveis.'
first_line() { head -n 1 "$work/release-notes.md"; }
total_check() {
  total=$((total + 1))
  if "${@:2}"; then echo "ok   $total - $1"; else failures=$((failures + 1)); echo "FALHA $total - $1"; printf '%s\n' "$out" | sed 's/^/       | /'; sed 's/^/       | /' "$work/release-notes.md"; fi
}
is() { [ "$1" = "$2" ]; }

sums_of 0.2.0-beta.4 linux
run --beta --since v0.1.0 0.2.0-beta.4
expect "beta sem o Windows: a frase do Windows, e a do macOS não (num beta ele não é esperado)" 0 "Esta versão saiu sem o pacote de Windows" "pacote de macOS"
total_check "beta sem o Windows: a frase é a primeira linha das notas, antes da faixa de beta, que continua com a frase fixa" is "$(first_line)" "$sentence_win"
total_check "beta sem o Windows: depois da frase vem uma linha em branco e a faixa de beta, com a frase fixa" is "$(sed -n '2,3p' "$work/release-notes.md")" "$(printf '\nVersão beta (pré-lançamento), para experimentar. %s Abaixo, o que mudou desde a 0.1.0.' "$beta_sentence")"
expect "beta sem o Windows: o log diz o que faltou" 0 "a release sai sem o pacote de: Windows"

sums_of 0.2.0-beta.4 win
run --beta --since v0.1.0 0.2.0-beta.4
total_check "beta sem o Linux: a frase do Linux é a primeira linha" is "$(first_line)" "$sentence_linux"

sums_auto=0
printf '%s  Prism-0.2.0-beta.4-win-x64.exe\n%s  Prism-0.2.0-beta.4-linux-x86_64.rpm\n' "$a" "$b" > "$work/src/client/release/SHA256SUMS"
run --beta --since v0.1.0 0.2.0-beta.4
expect "beta com um arquivo só de cada grupo (nenhum inteiro): as frases do Windows e do Linux, nessa ordem" 0 "$sentence_win"
total_check "beta com os dois grupos incompletos: Windows primeiro, Linux depois" is "$(sed -n '1p;3p' "$work/release-notes.md")" "$(printf '%s\n%s' "$sentence_win" "$sentence_linux")"

sums_of 0.2.0 win linux
run 0.2.0
total_check "estável sem o macOS: a primeira linha é a frase dos dois macOS juntos, e não há faixa de beta" is "$(first_line)" "$sentence_mac"
expect "estável sem o macOS: o resto das notas continua (a seção do changelog e as somas)" 0 "Defeito da 0.2.0." "Versão beta"
total=$((total + 1))
expected=$(printf '%s\n\n\n### Corrigido\n\n- Defeito da 0.2.0.\n\n### Somas SHA-256\n\n```\n%s\n```\nfim' "$sentence_mac" "$(cat "$work/src/client/release/SHA256SUMS")")
if [ "$(cat "$work/release-notes.md"; printf fim)" = "$expected" ]; then echo "ok   $total - CONTRATO (estável sem o macOS): a frase, a seção do changelog e o bloco das somas, e nada depois dele"; else failures=$((failures + 1)); echo "FALHA $total - CONTRATO (estável sem o macOS)"; diff <(cat "$work/release-notes.md"; printf fim) <(printf '%s' "$expected") | sed 's/^/       | /'; fi

sums_of 0.2.0 win linux mac-arm64
run 0.2.0
expect "estável sem o macOS Intel: a frase fala só do Intel e de quem o usa" 0 "Esta versão saiu sem o pacote de macOS (Intel), que não foi gerado nesta execução. Quem usa macOS com processador Intel continua na versão anterior" "Apple Silicon"

sums_of 0.2.0 win linux mac-x64
run 0.2.0
expect "estável sem o macOS Apple Silicon: a frase fala só do Apple Silicon e de quem o usa" 0 "Esta versão saiu sem o pacote de macOS (Apple Silicon), que não foi gerado nesta execução. Quem usa macOS com Apple Silicon continua na versão anterior" "Intel"

sums_of 0.2.0 win mac-arm64 mac-x64
run 0.2.0
total_check "estável sem o Linux: só a frase do Linux" is "$(first_line)" "$sentence_linux"

sums_of 0.2.0 linux mac-arm64
run 0.2.0
total_check "estável sem Windows e sem macOS Intel: uma frase para cada conjunto, na ordem Windows, Linux, macOS" is "$(grep '^Esta versão saiu' "$work/release-notes.md" | sed 's/, que.*//')" "$(printf 'Esta versão saiu sem o pacote de Windows\nEsta versão saiu sem o pacote de macOS (Intel)')"

sums_of 0.2.0 win linux mac-arm64 mac-x64
grep -v 'mac-x64.zip' "$work/src/client/release/SHA256SUMS" > "$work/sums-sem-zip" && mv "$work/sums-sem-zip" "$work/src/client/release/SHA256SUMS"
run 0.2.0
expect "estável com um grupo pela metade (o .dmg do Intel sem o .zip): o grupo conta como faltando" 0 "Esta versão saiu sem o pacote de macOS (Intel)"

sums_auto=0
printf '%s  Prism-0.2.0-plantado.exe\n' "$a" > "$work/src/client/release/SHA256SUMS"
run 0.2.0
total_check "estável sem nenhum grupo reconhecido nas somas: uma frase para cada conjunto esperado (Windows, Linux e os dois macOS juntos)" is "$(grep -c '^Esta versão saiu sem o pacote de' "$work/release-notes.md")" 3
sums_auto=1

write_changelog
sums_auto=0
printf 'aaaa  Prism-0.2.0-win-x64.exe\n' > "$work/src/client/release/SHA256SUMS"
run 0.2.0
expect "SHA256SUMS com soma que não tem 64 dígitos falha (o app ignoraria a linha e recusaria o pacote)" 1 "fora do formato"

printf '%s  ../Prism-0.2.0-win-x64.exe\n' "$a" > "$work/src/client/release/SHA256SUMS"
run 0.2.0
expect "SHA256SUMS com caminho no nome falha" 1 "fora do formato"

# O arquivo das somas só troca por ARGUMENTO: uma variável de CI chamada PRISM_SUMS_FILE trocaria as somas das notas de uma release.
write_sums 0.2.0 win linux
printf '%s  Prism-0.2.0-plantado.exe\n' "$b" > "$work/outras-somas"
out=$(cd "$work" && PRISM_SUMS_FILE="$work/outras-somas" bash scripts/ci/release-notes.sh 0.2.0 2>&1); code=$?
expect "PRISM_SUMS_FILE no ambiente não troca as somas das notas" 0 "Prism-0.2.0-win-x64.exe" "plantado"
run --sums "$work/outras-somas" 0.2.0
expect "--sums <arquivo> troca (é como se roda na própria máquina)" 0 "Prism-0.2.0-plantado.exe" "Prism-0.2.0-win-x64.exe"
run --sums
expect "--sums sem valor é erro de uso" 2 "Uso:"

rm "$work/src/client/release/SHA256SUMS"
run 0.2.0
expect "sem o SHA256SUMS falha" 1 "falta o"

echo
echo "$((total - failures)) de $total casos passaram."
[ "$failures" -eq 0 ]
