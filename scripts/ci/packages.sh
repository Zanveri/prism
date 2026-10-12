#!/usr/bin/env bash
# Para ser lido com `source`: package_files <versão> <grupo>... escreve os nomes de arquivo dos grupos (win, linux, mac-arm64,
# mac-x64) em packages.txt, um por linha, com a versão no lugar de @VERSION@. Falha (e não escreve nada) se algum grupo não existe,
# mesmo havendo outro válido ao lado, ou se nenhum grupo foi pedido: uma lista vazia ou incompleta faria a conferência dos pacotes
# passar sem conferir tudo. O caminho do packages.txt é resolvido ao ler este arquivo, então vale de qualquer pasta.
# (Sem nada do bash 4: o package-desktop.sh lê este arquivo também no bash 3.2 do macOS.)
packages_file=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/packages.txt

package_files() {
  local version=$1 group known names
  shift
  [ $# -gt 0 ] || { echo "packages.sh: nenhum grupo pedido." >&2; return 1; }
  known=$(awk '/^#/ || NF == 0 { next } { print $1 }' "$packages_file" | sort -u) || return 1
  for group in "$@"; do
    printf '%s\n' "$known" | grep -qx -- "$group" || { echo "packages.sh: grupo desconhecido: $group (os de $packages_file são: $(printf '%s ' $known))." >&2; return 1; }
  done
  names=$(awk -v v="$version" -v groups=" $* " '/^#/ || NF == 0 { next } index(groups, " " $1 " ") { gsub(/@VERSION@/, v, $2); print $2 }' "$packages_file") || return 1
  [ -n "$names" ] || { echo "packages.sh: nenhum arquivo para o(s) grupo(s) \"$*\" em $packages_file." >&2; return 1; }
  printf '%s\n' "$names"
}

# launch_origin_problem <plataforma>: escreve por que este job NÃO pode gerar o pacote de um lançamento, ou nada se pode. Na
# pipeline (GITHUB_ACTIONS), a origem das atualizações que o pacote leva tem de ser a do PRÓPRIO repositório do workflow
# (RN-ATUALIZA-001 e RN-GITHUB-005): PRISM_UPDATE_API igual a $GITHUB_API_URL, PRISM_UPDATE_SITE igual a $GITHUB_SERVER_URL,
# PRISM_UPDATE_REPOSITORY igual a $GITHUB_REPOSITORY e, no pacote de Linux, PRISM_HOMEPAGE igual a
# $GITHUB_SERVER_URL/$GITHUB_REPOSITORY. O workflow as tira do contexto `github`, e as GITHUB_* ninguém sobrescreve (documentação
# das variáveis padrão); a conferência fica aqui para uma edição futura do workflow, que passasse um valor de `vars.` ou de
# segredo, não trocar sem ninguém ver o servidor de onde todo Prism instalado baixa a próxima versão. Fora do GitHub Actions nada
# é conferido. As mensagens não repetem os valores.
launch_origin_problem() {
  [ "${GITHUB_ACTIONS:-}" = true ] || return 0
  if [ -z "${GITHUB_API_URL:-}" ] || [ -z "${GITHUB_SERVER_URL:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ] \
    || [ "${PRISM_UPDATE_API:-}" != "$GITHUB_API_URL" ] || [ "${PRISM_UPDATE_SITE:-}" != "$GITHUB_SERVER_URL" ] || [ "${PRISM_UPDATE_REPOSITORY:-}" != "$GITHUB_REPOSITORY" ]; then
    echo "na pipeline a origem das atualizações tem de ser a do próprio repositório do workflow: PRISM_UPDATE_API igual a \$GITHUB_API_URL, PRISM_UPDATE_SITE igual a \$GITHUB_SERVER_URL e PRISM_UPDATE_REPOSITORY igual a \$GITHUB_REPOSITORY. Uma delas está vazia ou com outro valor. Um pacote que procura atualização em outro lugar não é gerado."
    return 0
  fi
  if [ "$1" = linux ] && [ "${PRISM_HOMEPAGE:-}" != "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" ]; then
    echo "na pipeline PRISM_HOMEPAGE tem de ser \$GITHUB_SERVER_URL/\$GITHUB_REPOSITORY (a página do próprio repositório): está vazia ou com outro valor."
  fi
}

# update_origin_problem <pasta de saída do electron-builder>: escreve por que o pacote gerado NÃO serve a um lançamento, ou nada
# se serve. A origem das atualizações são PRISM_UPDATE_API, PRISM_UPDATE_SITE e PRISM_UPDATE_REPOSITORY, que o `dist` grava no
# package.json de dentro do pacote (app.asar). Sem elas o `dist` só avisa, e o pacote sairia como uma versão que nunca se
# atualiza, em silêncio: aqui a falta é erro. O app.asar guarda os arquivos sem compressão, e o electron-builder escreve o
# package.json com `"chave": "valor"`, então basta procurar cada valor como um texto JSON COMPLETO, com as duas aspas (assim a
# página do projeto, "https://github.com/dono/repo", não passa pelo site, "https://github.com"). A conferência não depende do
# nome das chaves: quem as escolhe é o `dist` (src/client/scripts/dist-plan.mjs).
update_origin_problem() {
  local dir=$1 api=${PRISM_UPDATE_API:-} site=${PRISM_UPDATE_SITE:-} repo=${PRISM_UPDATE_REPOSITORY:-} asar found=0
  if [ -z "$api" ] || [ -z "$site" ] || [ -z "$repo" ]; then
    echo "PRISM_UPDATE_API, PRISM_UPDATE_SITE e PRISM_UPDATE_REPOSITORY têm de estar definidas no job de pacote (na pipeline, o endereço da API, o do site e o dono/repositório do workflow)."
    return 0
  fi
  if ! printf '%s' "$repo" | grep -Eq '^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$' || [[ "$repo" == *..* ]]; then
    echo "PRISM_UPDATE_REPOSITORY tem de ser dono/repositório, como o GitHub os escreve."
    return 0
  fi
  api=${api%/}
  site=${site%/}
  while IFS= read -r asar; do
    found=1
    if ! grep -a -q -F "\": \"$api\"" "$asar" || ! grep -a -q -F "\": \"$site\"" "$asar" || ! grep -a -q -F "\": \"$repo\"" "$asar"; then
      echo "o pacote em $asar não traz gravada a origem das atualizações (os valores de PRISM_UPDATE_API, PRISM_UPDATE_SITE e PRISM_UPDATE_REPOSITORY deste job)."
      return 0
    fi
  done < <(find "$dir" -name app.asar)
  [ "$found" -eq 1 ] || echo "não achei nenhum app.asar em $dir para conferir a origem das atualizações."
}
