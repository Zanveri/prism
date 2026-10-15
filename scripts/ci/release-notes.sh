#!/usr/bin/env bash
# As notas de uma release (RN-VERSAO-007), em release-notes.md, seguidas das somas SHA-256 dos pacotes (o SHA256SUMS que o
# publish-release.sh escreveu):
#  - versão ESTÁVEL: a seção dela no CHANGELOG.md, de título EXATO "## [X.Y.Z] - AAAA-MM-DD" (a que o git-cliff gerou, ou a escrita
#    à mão, como a da 0.1.0), SE ela existir e tiver texto. Sem ela, as notas saem do git-cliff, do mesmo jeito que as do beta, com
#    os commits desde a estável anterior (`--since <tag>`; sem ela, o histórico inteiro): uma estável sai sempre, com o changelog
#    escrito ou sem ele (version.sh, `decide_release`);
#  - BETA (`--beta`, X.Y.Z-beta.N): as notas do git-cliff, geradas na hora com os commits desde a tag anterior (`--since <tag>`;
#    sem ela, o histórico inteiro), e NÃO gravadas no CHANGELOG.md.
# O git-cliff roda com o cliff.toml do repositório, pela imagem fixada de scripts/ci/git-cliff.sh. As mensagens de commit viram
# texto das notas: é texto de fora, e o app o desenha com o interpretador próprio (RN-ATUALIZA-004).
#
# O BLOCO DAS SOMAS É CONTRATO COM O ATUALIZADOR DO APP (RN-ATUALIZA-005). Quem o lê é src/client/electron/update/ (checksums.ts,
# `splitNotes`), do jeito mais estrito: o ÚLTIMO título exatamente igual a `sums_heading`, uma linha em branco, a cerca, as
# linhas do SHA256SUMS (64 dígitos hexadecimais, dois espaços e o nome do arquivo), a cerca que fecha, e NADA depois. O app
# confere o pacote baixado contra essas somas e contra as do arquivo SHA256SUMS da release; se o bloco mudar de título, ganhar a
# linguagem na cerca ou um parágrafo depois dele, todo Prism instalado passa a RECUSAR a atualização. O título e a cerca moram só
# nas duas variáveis abaixo, e o release-notes.test.sh falha se o formato mudar: mudou aqui, mude o leitor no mesmo pull request.
#
# Uso: bash scripts/ci/release-notes.sh [--sums <arquivo>] [--since <tag>] [versão]      (a estável; sem a versão, a do package.json)
#      bash scripts/ci/release-notes.sh [--sums <arquivo>] --beta [--since <tag>] <versão-beta>
# Precisa de src/client/release/SHA256SUMS; `--sums` aponta outro arquivo, para rodar na própria máquina. O arquivo das somas só
# troca por ARGUMENTO, que a pipeline nunca passa. O git-cliff (o beta e a estável sem seção no changelog) precisa do Docker (a
# imagem dele) e do histórico do git.
set -euo pipefail

sums_heading='### Somas SHA-256'
fence='```'

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$here/../.."
# shellcheck source=version.sh
source "$here/version.sh"
# shellcheck source=actions.sh
source "$here/actions.sh"

fail() {
  echo "release-notes: $1" >&2
  exit 1
}

usage() {
  echo "Uso: release-notes.sh [--sums <arquivo>] [--since <tag>] [versão] | release-notes.sh [--sums <arquivo>] --beta [--since <tag>] <versão>" >&2
  exit 2
}

version=
sums=src/client/release/SHA256SUMS
beta=0
since=
while [ $# -gt 0 ]; do
  case "$1" in
    --sums) [ $# -ge 2 ] || usage; sums=$2; shift ;;
    --beta) beta=1 ;;
    --since) [ $# -ge 2 ] || usage; since=$2; shift ;;
    -*) usage ;;
    *) version=$1 ;;
  esac
  shift
done
[ -n "$version" ] || [ "$beta" -eq 1 ] || version=$(package_version)
[ -n "$version" ] || usage
version=${version#v}
version_fields "$version" > /dev/null || fail "a versão \"$version\" não segue o formato X.Y.Z, X.Y.Z-beta.N ou X.Y.Z-rc.N (RN-VERSAO-001)."
out=release-notes.md
[ -s "$sums" ] || fail "falta o $sums (o publish-release.sh o escreve)."
# Uma linha fora do formato o app ignora, e a atualização daquele pacote seria recusada: melhor não publicar.
if grep -qvE '^[0-9a-f]{64}  [A-Za-z0-9][A-Za-z0-9._-]*$' "$sums"; then
  fail "o $sums tem linha fora do formato \"<64 dígitos hexadecimais>  <nome do arquivo>\", que é o que o atualizador do app lê."
fi

# cliff_notes <o que dizer sem tag anterior>: as notas do git-cliff com os commits desde $since (sem ela, o histórico inteiro), em
# `notes`, e de onde elas partem, em `origin`. As notas são para quem usa o app: o cliff.toml só deixa entrar o que muda o que ele
# vê, então um merge só de documentação, testes ou pipeline sai sem item, e as notas dizem isso.
cliff_notes() {
  local range=()
  if [ -n "$since" ]; then
    version_fields "${since#v}" > /dev/null && [[ "$since" == v* ]] || fail "\"$since\" não é uma tag de versão (vX.Y.Z ou vX.Y.Z-beta.N)."
    # Com o intervalo, SEM o --unreleased: junto dele o git-cliff (2.14) volta até a última estável e ignora o começo do
    # intervalo, e as notas de cada beta repetiam tudo desde a estável. O intervalo já é o que não foi lançado.
    range=("$since..HEAD")
    origin="o que mudou desde a ${since#v}"
  else
    # Sem tag anterior, "--unreleased" fica com o histórico inteiro (não há estável antes).
    range=(--unreleased)
    origin="tudo o que entrou até aqui ($1)"
  fi
  # Só o corpo: "--strip all" tira o cabeçalho do CHANGELOG.md.
  notes=$(bash "$here/git-cliff.sh" --config cliff.toml --strip all "${range[@]}") || fail "o git-cliff falhou: as notas de $version não saíram."
  if [ -z "${notes//[[:space:]]/}" ]; then
    notes="
Nenhuma mudança que apareça para quem usa o Prism: só ajustes internos (documentação, testes ou empacotamento)."
  fi
}

if [ "$beta" -eq 1 ]; then
  [[ "$version" =~ -beta\.[0-9]+$ ]] || fail "\"$version\" não é a versão de um beta (X.Y.Z-beta.N)."
  cliff_notes "é o primeiro pré-lançamento"
  # Um parágrafo simples, e não uma citação ("> "): o app desenha a citação como parágrafo com o ">" na frente.
  header="Versão beta (pré-lançamento), para experimentar. Abaixo, $origin."
  echo "release-notes: beta $version, notas do git-cliff: $origin."
else
  [[ "$version" =~ $stable_pattern ]] || fail "\"$version\" é um pré-lançamento: as notas dele vêm do git-cliff, não do changelog (use --beta)."
  header=
  notes=$(version_notes "$version")
  if [ -n "${notes//[[:space:]]/}" ]; then
    echo "release-notes: seção $version do CHANGELOG.md."
  else
    cliff_notes "é a primeira estável"
    echo "release-notes: estável $version, sem a seção \"$(notes_heading "$version")\" com texto no CHANGELOG.md: notas do git-cliff, $origin."
  fi
fi

{
  [ -z "$header" ] || printf '%s\n' "$header"
  printf '%s\n\n' "$notes"
  printf '%s\n\n%s\n' "$sums_heading" "$fence"
  cat "$sums"
  printf '%s\n' "$fence"
} > "$out"

# As notas no log, com a leitura de comandos de workflow desligada: uma mensagem de commit que comece com "::" não vira comando.
ci_quiet_begin
cat "$out"
ci_quiet_end
