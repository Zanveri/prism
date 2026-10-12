#!/usr/bin/env bash
# Job `versao` do workflow verificar: diz, antes de qualquer pacote ser gerado, o que o merge deste ramo vai lançar
# (RN-VERSAO-008). A decisão é a de version.sh (`decide_release`), a mesma que o publish-release.sh refaz na hora de publicar. A
# versão da vez (E) é a do campo `version` de src/client/package.json (V) quando ela é maior que a maior tag ESTÁVEL do remoto (S) ou
# quando não há tag estável; senão, é a S com o patch + 1 ("automático": depois da v0.1.0, a 0.1.1 sozinha). Uma V menor que a S não
# reprova: é corrigida para a seguinte à S, com um aviso.
#  - develop: o beta vE-beta.N (N um a mais que o maior já publicado de E; o primeiro é 1).
#  - main: a estável vE, SEMPRE, com a seção "## [E] - AAAA-MM-DD" do CHANGELOG.md se ela existir e, sem ela, com as notas do git-cliff.
#    Só NÃO LANÇA quando não há commit novo desde a maior estável (o commit é o dela ou está na história dela): avisa "nada novo
#    desde a vS".
#  - FALHA (e nenhum pacote é gerado): a versão fora do formato ou com sufixo, a versão da vez que não é maior que um beta já
#    publicado (a versão regrediu), um título do CHANGELOG.md que cita a versão da vez fora do formato exato (só na main), outro
#    ramo e o remoto que não respondeu.
# O "não lança" não é falha: o job fica verde, e o aviso aparece à vista (anotação e resumo do job; actions.sh).
# No GitHub Actions o script também escreve o plano nos outputs do job (lanca, tag e versao): a versão com que os pacotes desta
# execução são gerados (a da vez: a do beta, X.Y.Z-beta.N, num lançamento da develop, e X.Y.Z numa estável) e a tag que o job de
# lançamento espera publicar.
#
# Uso: bash scripts/ci/check-version.sh [ramo]      (sem argumento, vale GITHUB_REF_NAME, o ramo da pipeline). Na sua máquina,
#                                                    diga o ramo de destino: `check-version.sh main` no ramo do pull request de
#                                                    lançamento diz se o merge vai lançar e o que sai.
#      … --remote <remoto>                          só para os testes: o remoto de mentira (a pipeline nunca passa isto)
# Lê as tags do remoto (version.sh diz qual é e como o token chega ao git) e precisa do histórico do clone, com os commits delas
# (`git fetch --tags`). Precisa de bash, git, sed e awk.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$here/../.."
# shellcheck source=version.sh
source "$here/version.sh"
# shellcheck source=actions.sh
source "$here/actions.sh"

fail() {
  echo "check-version: $1" >&2
  ci_summary "**A versão não passou na conferência.** $1"
  exit 1
}

usage() {
  echo "Uso: check-version.sh [--remote <remoto>] [develop|main]" >&2
  exit 2
}

branch=${GITHUB_REF_NAME:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --remote) [ $# -ge 2 ] || usage; release_remote_arg=$2; shift ;;
    -*) usage ;;
    *) branch=$1 ;;
  esac
  shift
done
[ -n "$branch" ] || usage

version=$(package_version)
[ -n "$version" ] || fail "não achei o campo \"version\" no primeiro nível de src/client/package.json."
commit=$(pipeline_commit) || fail "o commit da pipeline não confere. Nada foi gerado nem enviado."

decide_release "$version" "$branch" "$commit"

# outputs <lança> <tag> <versão dos pacotes>: o plano desta execução, para os jobs seguintes (os outputs do job no GitHub
# Actions). Os pacotes de um lançamento levam a versão DA VEZ (um beta é X.Y.Z-beta.N, que é a que o app instalado vai dizer que é;
# uma estável, X.Y.Z, que pode ser maior que a do package.json: set-build-version.sh); os de uma execução que não lança levam a do
# package.json. O job de lançamento não confia no plano: decide de novo e recusa se o estado das tags mudou (publish-release.sh
# --expect).
outputs() {
  if ci_in_actions && [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'lanca=%s\ntag=%s\nversao=%s\n' "$1" "$2" "$3" >> "$GITHUB_OUTPUT"; fi
  echo "check-version: plano: lança=$1 tag=${2:-nenhuma} versão dos pacotes=$3"
}

case "$decision" in
  error)
    fail "$decision_detail Nada foi gerado nem enviado."
    ;;
  launch)
    if [ "$branch" = develop ]; then
      message="LANÇA o beta $release_tag ($(release_name "${release_tag#v}"), pré-lançamento) do commit $commit, depois dos pacotes."
    else
      message="LANÇA a versão estável $release_tag ($(release_name "$release_version")) do commit $commit, depois dos pacotes. $(notes_message)"
    fi
    # A versão da vez que não é a do package.json: igual à maior estável é o caso normal (uma nota); menor que ela, um aviso.
    if [ -n "$version_notice" ] && [ "$version_regressed" -eq 0 ]; then message="$message $version_notice"; fi
    echo "check-version: $message"
    ci_summary "**Lançamento.** $message"
    if [ "$version_regressed" -eq 1 ]; then ci_warning "Versão corrigida" "$version_notice"; fi
    outputs true "$release_tag" "${release_tag#v}"
    ;;
  done)
    if [ "$branch" = main ]; then
      echo "check-version: JÁ LANÇADA. A tag $release_tag aponta para este commit: nada novo desde a $release_tag, nada a publicar."
      ci_summary "**Já lançada.** A tag $release_tag aponta para este commit: nada novo desde a $release_tag."
    else
      echo "check-version: JÁ LANÇADA. A tag $release_tag aponta para este commit: nada a publicar."
      ci_summary "**Já lançada.** A tag $release_tag aponta para este commit."
    fi
    outputs false "" "${release_tag#v}"
    ;;
  *)
    ci_warning "Não lança" "$(no_launch_message)"
    outputs false "" "$version"
    ;;
esac
