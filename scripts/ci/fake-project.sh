#!/usr/bin/env bash
# Para ser lido com `source` pelos testes do lançamento (check-version.test.sh e release.test.sh): um projeto de mentira numa
# pasta temporária, com um repositório `bare` local no papel do remoto (o ramo padrão dele é a develop, como no repositório de
# verdade). Nada sai da máquina e nenhum token de verdade existe aqui.
# Antes: a variável `here` com a pasta de scripts/ci. Depois de `fake_project`:
#   $sandbox  a pasta temporária (apague-a no fim)
#   $remote   o repositório bare, que os scripts recebem pelo argumento `--remote`
#   $work     o clone de trabalho, com scripts/ci copiado, o package.json e o CHANGELOG.md de mentira
#   $branch   o ramo para onde `commit_all` envia (develop, até o teste trocar)
export GIT_AUTHOR_NAME=teste GIT_AUTHOR_EMAIL=nobody GIT_COMMITTER_NAME=teste GIT_COMMITTER_EMAIL=nobody
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

fake_project() {
  sandbox=$(mktemp -d)
  # Sem a pasta, os `git -C "$work"` dos testes cairiam no repositório de quem os roda.
  [ -n "$sandbox" ] && [ -d "$sandbox" ] || { echo "fake-project: não consegui criar a pasta temporária." >&2; exit 1; }
  remote=$sandbox/remote.git
  work=$sandbox/work
  branch=develop
  git init -q --bare "$remote"
  git -C "$remote" symbolic-ref HEAD refs/heads/develop
  git init -q "$work"
  mkdir -p "$work/scripts/ci" "$work/src/client"
  cp "$here"/*.sh "$here/packages.txt" "$work/scripts/ci/"
  [ ! -f "$here/../../cliff.toml" ] || cp "$here/../../cliff.toml" "$work/cliff.toml"
  printf 'release/\nrelease-notes.md\n' > "$work/.gitignore"
}

# set_version <versão>: o package.json de mentira, com um segundo "version" mais fundo, que não é o da versão.
set_version() {
  printf '{\n  "name": "prism-client",\n  "version": "%s",\n  "private": true,\n  "devDependencies": {\n    "version": "0.0.0"\n  }\n}\n' "$1" > "$work/src/client/package.json"
}

# commit_all [mensagem]: um commit com tudo o que há no projeto de mentira, enviado ao ramo $branch do remoto. Escreve o commit.
commit_all() {
  git -C "$work" add -A
  git -C "$work" commit -q --allow-empty -m "${1:-teste}"
  git -C "$work" push -q "$remote" "HEAD:refs/heads/$branch"
  git -C "$work" rev-parse HEAD
}

# remote_tag <nome> <commit> [mensagem]: uma tag no remoto; com mensagem, anotada.
remote_tag() {
  if [ -n "${3:-}" ]; then git -C "$remote" tag -a "$1" -m "$3" "$2"; else git -C "$remote" tag "$1" "$2"; fi
}

# remote_commit_of <ref>: o commit para onde o ref do remoto aponta, ou nada. O ref é procurado pelo nome EXATO (um nome sem
# `refs/` é uma tag): o `git rev-parse` sozinho aceitaria, no lugar de `refs/tags/v1`, um ramo chamado `refs/tags/v1`.
remote_commit_of() {
  local ref=$1
  [[ "$ref" == refs/* ]] || ref=refs/tags/$ref
  git -C "$remote" show-ref --verify --quiet "$ref" || return 0
  git -C "$remote" rev-parse --verify --quiet "$ref^{commit}" || true
}
