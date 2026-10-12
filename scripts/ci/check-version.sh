#!/usr/bin/env bash
# Job `versao` do workflow verificar: diz, antes de qualquer pacote ser gerado, o que o merge deste ramo vai lançar
# (RN-VERSAO-008). A decisão é a de version.sh (`decide_release`), a mesma que o publish-release.sh refaz na hora de publicar.
#  - develop: o beta vX.Y.Z-beta.N da próxima versão estável (N um a mais que o maior já publicado dela). Se a versão já tem a tag
#    estável, NÃO LANÇA e avisa que a versão precisa subir.
#  - main: a estável vX.Y.Z, quando a versão não tem tag e o CHANGELOG.md tem a seção dela. Sem a seção, ou com a tag, NÃO LANÇA,
#    com o aviso.
#  - FALHA (e nenhum pacote é gerado): a versão fora do formato ou com sufixo, a versão que regrediu, um título do CHANGELOG.md
#    que cita a versão fora do formato exato (só na main), outro ramo e o remoto que não respondeu.
# O "não lança" não é falha: o job fica verde, e o aviso aparece à vista (anotação e resumo do job; actions.sh).
# No GitHub Actions o script também escreve o plano nos outputs do job (lanca, tag e versao): a versão com que os pacotes desta
# execução são gerados (a do beta, X.Y.Z-beta.N, num lançamento da develop) e a tag que o job de lançamento espera publicar.
#
# Uso: bash scripts/ci/check-version.sh [ramo]      (sem argumento, vale GITHUB_REF_NAME, o ramo da pipeline). Na sua máquina,
#                                                    diga o ramo de destino: `check-version.sh main` no ramo do pull request de
#                                                    lançamento diz se o merge vai lançar e o que falta.
#      … --remote <remoto>                          só para os testes: o remoto de mentira (a pipeline nunca passa isto)
# Lê as tags do remoto (version.sh diz qual é e como o token chega ao git). Precisa de bash, git, sed e awk.
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
# Actions). Os pacotes de um beta levam a versão DO BETA (X.Y.Z-beta.N), que é a que o app instalado vai dizer que é; os de uma
# execução que não lança levam a do package.json. O job de lançamento não confia no plano: decide de novo e recusa se o estado das
# tags mudou (publish-release.sh --expect).
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
      message="LANÇA a versão estável $release_tag ($(release_name "$version")) do commit $commit, depois dos pacotes."
    fi
    echo "check-version: $message"
    ci_summary "**Lançamento.** $message"
    outputs true "$release_tag" "${release_tag#v}"
    ;;
  done)
    echo "check-version: JÁ LANÇADA. A tag $release_tag aponta para este commit: nada a publicar."
    ci_summary "**Já lançada.** A tag $release_tag aponta para este commit."
    outputs false "" "${release_tag#v}"
    ;;
  *)
    ci_warning "Não lança" "$(no_launch_message "$version")"
    outputs false "" "$version"
    ;;
esac
