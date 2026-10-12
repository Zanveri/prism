#!/usr/bin/env bash
# O git-cliff (RN-VERSAO-007), pela imagem dele fixada por tag E digest, com a pasta do repositório montada: é o mesmo na
# pipeline (as notas de um beta, release-notes.sh) e na máquina de quem escreve o CHANGELOG.md (docs/versionamento.md). Roda com o
# usuário e o grupo de quem chama, para os arquivos que ele escreve não saírem do root, e sem rede (o git-cliff só lê o
# histórico local; o cliff.toml não tem [remote]).
#
# Para atualizar: a tag nova da imagem orhunp/git-cliff e o digest dela (docker pull, depois
# `docker inspect --format '{{index .RepoDigests 0}}' orhunp/git-cliff:<tag>`), e o ensaio do --prepend de docs/versionamento.md.
#
# Uso: bash scripts/ci/git-cliff.sh <argumentos do git-cliff>      (da pasta do repositório; precisa do Docker)
set -euo pipefail

image=orhunp/git-cliff:2.14.2@sha256:1e696a381a1b0366bb6ccbb6bd4e50e73473fda88eab3a757b95e0d0d66c9531
root=$(git rev-parse --show-toplevel)
exec docker run --rm --network none --user "$(id -u):$(id -g)" --volume "$root:/app" --workdir /app "$image" "$@"
