#!/usr/bin/env bash
# As notas de uma release (RN-VERSAO-007), em release-notes.md, seguidas das somas SHA-256 dos pacotes (o SHA256SUMS que o
# publish-release.sh escreveu, só com as plataformas que vieram inteiras):
#  - versão ESTÁVEL: a seção dela no CHANGELOG.md, de título EXATO "## [X.Y.Z] - AAAA-MM-DD" (a que o git-cliff gerou, ou a escrita
#    à mão, como a da 0.1.0), SE ela existir e tiver texto. Sem ela, as notas saem do git-cliff, do mesmo jeito que as do beta, com
#    os commits desde a estável anterior (`--since <tag>`; sem ela, o histórico inteiro): uma estável sai sempre, com o changelog
#    escrito ou sem ele (version.sh, `decide_release`);
#  - BETA (`--beta`, X.Y.Z-beta.N): as notas do git-cliff, geradas na hora com os commits desde a tag anterior (`--since <tag>`;
#    sem ela, o histórico inteiro), e NÃO gravadas no CHANGELOG.md.
# AS PLATAFORMAS QUE FALTAM. A falha do pacote de uma plataforma não segura o lançamento das outras (decisão do dono, 2026-10-20), e
# quem usa a plataforma sem pacote precisa saber por que a versão nova não chega a ele. As notas dizem, logo no começo, uma frase por
# conjunto de plataformas que a pipeline espera daquele lançamento (packages.sh, `expected_groups`: Windows e Linux num beta, as
# quatro numa estável) e que não está INTEIRO nas somas: Windows, Linux e o macOS (Apple Silicon e Intel juntos, numa frase só,
# ou o que faltar de um só). A falta do macOS num beta é o esperado, e não é frase de falta: todo beta traz, no lugar dela, a
# frase fixa de que os betas saem para Windows e Linux. O texto de uma release publicada é imutável na prática (o app lê as
# notas da release de cada versão), então a frase de uma versão antiga continua à vista nas notas que o app mostra de várias
# versões, e é o que explica por que ele não a oferece a quem não tem o pacote (src/client/electron/update/, `offerable`).
#
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
# shellcheck source=packages.sh
source "$here/packages.sh"

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

# missing_notes <beta|stable>: as frases das plataformas esperadas que não estão inteiras nas somas, cada uma seguida de uma linha em
# branco, em `platform_notes` (vazio se nada falta), e os grupos que faltam, em `missing`.
missing_notes() {
  local listing present group
  platform_notes=
  missing=
  listing=$(mktemp)
  awk '{ print $2 }' "$sums" > "$listing"
  present=" $(present_groups "$version" "$listing" | tr '\n' ' ')" || { rm -f "$listing"; fail "não consegui ler os grupos de packages.txt."; }
  rm -f "$listing"
  for group in $(expected_groups "$1"); do
    case "$present" in *" $group "*) ;; *) missing="$missing $group" ;; esac
  done
  missing=${missing# }
  [ -n "$missing" ] || return 0

  local sentence arm intel
  for group in win linux; do
    case " $missing " in *" $group "*) platform_notes="${platform_notes}$(missing_sentence "$(group_label "$group")" "$(group_label "$group")")"$'\n\n' ;; esac
  done
  case " $missing " in *" mac-arm64 "*) arm=1 ;; *) arm=0 ;; esac
  case " $missing " in *" mac-x64 "*) intel=1 ;; *) intel=0 ;; esac
  sentence=
  if [ "$arm" -eq 1 ] && [ "$intel" -eq 1 ]; then
    sentence=$(missing_sentence "macOS (Apple Silicon e Intel)" "macOS")
  elif [ "$arm" -eq 1 ]; then
    sentence=$(missing_sentence "macOS (Apple Silicon)" "macOS com Apple Silicon")
  elif [ "$intel" -eq 1 ]; then
    sentence=$(missing_sentence "macOS (Intel)" "macOS com processador Intel")
  fi
  [ -z "$sentence" ] || platform_notes="${platform_notes}${sentence}"$'\n\n'
}

# missing_sentence <o pacote que faltou> <quem o usa>
missing_sentence() {
  printf 'Esta versão saiu sem o pacote de %s, que não foi gerado nesta execução. Quem usa %s continua na versão anterior e recebe a próxima que tiver o pacote.' "$1" "$2"
}

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
  header="Versão beta (pré-lançamento), para experimentar. Os betas saem para Windows e Linux; no macOS, as atualizações chegam pelas versões estáveis. Abaixo, $origin."
  missing_notes beta
  echo "release-notes: beta $version, notas do git-cliff: $origin."
else
  [[ "$version" =~ $stable_pattern ]] || fail "\"$version\" é um pré-lançamento: as notas dele vêm do git-cliff, não do changelog (use --beta)."
  header=
  missing_notes stable
  notes=$(version_notes "$version")
  if [ -n "${notes//[[:space:]]/}" ]; then
    echo "release-notes: seção $version do CHANGELOG.md."
  else
    cliff_notes "é a primeira estável"
    echo "release-notes: estável $version, sem a seção \"$(notes_heading "$version")\" com texto no CHANGELOG.md: notas do git-cliff, $origin."
  fi
fi

[ -z "$missing" ] || echo "release-notes: as notas avisam que a release sai sem o pacote de: $(for group in $missing; do printf '%s; ' "$(group_label "$group")"; done | sed 's/; $//')."
{
  printf '%s' "$platform_notes"
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
