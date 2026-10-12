#!/usr/bin/env bash
# Testes do release-notes.sh: uma cópia do script num projeto de mentira, com o CHANGELOG.md e o SHA256SUMS que cada caso pede.
# Rode com `bash scripts/ci/release-notes.test.sh`; sai com 1 se algum caso falhar.
#
# O caso "CONTRATO" fixa, byte a byte, o bloco das somas que o atualizador do app lê (src/client/electron/update/checksums.ts).
# Se ele falhar, o formato mudou: NÃO acerte o esperado sem mudar o leitor no mesmo pull request, ou todo Prism instalado passa a
# recusar a atualização.
set -uo pipefail

real=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-notes.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/scripts/ci" "$work/src/client/release"
cp "$real" "$(dirname "$real")/version.sh" "$(dirname "$real")/actions.sh" "$work/scripts/ci/"
printf '{\n  "name": "prism-client",\n  "version": "0.2.0",\n  "private": true\n}\n' > "$work/src/client/package.json"

total=0
failures=0
out=
code=0

a=$(printf 'a%.0s' {1..64})
b=$(printf 'b%.0s' {1..64})

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

write_sums() {
  printf '%s  Prism-0.2.0-win-x64.exe\n%s  Prism-0.2.0-linux-x64.tar.gz\n' "$a" "$b" > "$work/src/client/release/SHA256SUMS"
}

# run [versão]
run() {
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
write_sums

run 0.2.0
expect "versão estável com seção: usa a seção, e só ela" 0 "Defeito da 0.2.0." "Coisa da 0.1.0."
expect "as notas terminam com as somas SHA-256 dos pacotes" 0 "$b  Prism-0.2.0-linux-x64.tar.gz"
expect "o título da seção não entra nas notas (a release já tem o dela)" 0 "" "## [0.2.0]"
total=$((total + 1))
if grep -q 'Somas SHA-256' "$work/release-notes.md" && ! grep -q 'Coisa de pré-lançamento' "$work/release-notes.md"; then echo "ok   $total - release-notes.md tem as somas e não tem a seção \"Não lançado\""; else failures=$((failures + 1)); echo "FALHA $total - conteúdo de release-notes.md"; fi

# CONTRATO com o atualizador do app: o arquivo inteiro, byte a byte. O bloco é o ÚLTIMO título "### Somas SHA-256", uma linha em
# branco, a cerca sem linguagem, as linhas do SHA256SUMS, a cerca que fecha e NADA depois. (A linha em branco do começo é a que
# o CHANGELOG.md tem depois do título da seção.)
total=$((total + 1))
expected=$(printf '\n### Corrigido\n\n- Defeito da 0.2.0.\n\n### Somas SHA-256\n\n```\n%s  Prism-0.2.0-win-x64.exe\n%s  Prism-0.2.0-linux-x64.tar.gz\n```\nfim' "$a" "$b")
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

run 0.3.0
expect "versão estável SEM seção no CHANGELOG.md falha" 1 'não tem a seção "## [0.3.0]"'

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
expect "beta: diz que é beta e de onde as notas partem" 0 "desde a v0.1.0"
total=$((total + 1))
if [ "$(cat "$work/cliff-args")" = "--config cliff.toml --unreleased --strip all v0.1.0..HEAD" ]; then echo "ok   $total - beta: o git-cliff roda com o cliff.toml do repositório, só o que não foi lançado, sem cabeçalho, desde a tag anterior"; else failures=$((failures + 1)); echo "FALHA $total - argumentos do git-cliff: $(cat "$work/cliff-args")"; fi
total=$((total + 1))
expected=$(printf '> Versão beta (pré-lançamento), com os commits desde a v0.1.0.\n\n### Adicionado\n\n- **client:** Coisa nova do beta\n\n### Corrigido\n\n- Defeito do beta\n\n### Somas SHA-256\n\n```\n%s  Prism-0.2.0-win-x64.exe\n%s  Prism-0.2.0-linux-x64.tar.gz\n```\nfim' "$a" "$b")
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
expect "o primeiro beta (sem tag anterior) usa o histórico inteiro" 0 "com os commits do histórico inteiro"
total=$((total + 1))
if [ "$(cat "$work/cliff-args")" = "--config cliff.toml --unreleased --strip all" ]; then echo "ok   $total - e o git-cliff roda sem intervalo"; else failures=$((failures + 1)); echo "FALHA $total - argumentos do git-cliff sem tag anterior: $(cat "$work/cliff-args")"; fi

printf '\n\n' > "$work/cliff-body"
run --beta --since v0.1.0-beta.1 0.1.0-beta.2
expect "beta sem nenhum commit no formato: as notas dizem isso (nunca ficam vazias)" 0 "Nenhum commit no formato dos commits do projeto"

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

run '0.2.0;id'
expect "versão fora do formato falha" 1 "não segue o formato"

write_changelog
printf 'aaaa  Prism-0.2.0-win-x64.exe\n' > "$work/src/client/release/SHA256SUMS"
run 0.2.0
expect "SHA256SUMS com soma que não tem 64 dígitos falha (o app ignoraria a linha e recusaria o pacote)" 1 "fora do formato"

printf '%s  ../Prism-0.2.0-win-x64.exe\n' "$a" > "$work/src/client/release/SHA256SUMS"
run 0.2.0
expect "SHA256SUMS com caminho no nome falha" 1 "fora do formato"

# O arquivo das somas só troca por ARGUMENTO: uma variável de CI chamada PRISM_SUMS_FILE trocaria as somas das notas de uma release.
write_sums
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
