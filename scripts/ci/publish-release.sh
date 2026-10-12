#!/usr/bin/env bash
# Job `publicar` do workflow lancar: o lançamento de uma versão (RN-VERSAO-008), numa release do GitHub.
#
# A decisão é a de version.sh (`decide_release`), refeita aqui na hora, com o estado do remoto: o plano que o job `versao` fez no
# começo da execução (`--expect <tag>`) só é seguido se for o mesmo que a decisão de agora, porque os pacotes desta execução foram
# gerados com a versão do plano (set-build-version.sh). A versão da vez é a do package.json ou, se ela já saiu como estável, a
# maior estável com o patch + 1. Assim:
#  - não lança (o beta saiu de um commit à frente, ou a main sem commit novo desde a maior estável): o aviso à vista e saída 0, sem
#    escrever nada;
#  - já lançada daqui (a tag do beta, ou a da maior estável na main, aponta para este commit): confere que a release está publicada
#    e completa, e sai;
#  - lança: o caminho abaixo, nesta ordem.
#
# O caminho, nesta ordem (o que a documentação de releases imutáveis recomenda: rascunho, anexos, publicação):
#  1. as conferências de antes de escrever: o plano, os pacotes (os dez da lista de packages.txt, com a versão da tag) e o
#     SHA256SUMS, as notas (release-notes.sh: a seção do changelog numa estável, se ela existir; senão, e num beta, o git-cliff desde a
#     tag anterior; na estável, a estável anterior) e o
#     commit, que não pode acrescentar nem mudar arquivo de .github/workflows/ em relação ao ramo padrão (a API de releases
#     responde 404 a um GITHUB_TOKEN nesse caso: ele não pode ter a permissão de workflows);
#  2. o RASCUNHO da release: um rascunho com a mesma tag e este commit, deixado por uma tentativa que parou no meio, é retomado;
#     um rascunho com a mesma tag e OUTRO commit é apagado (um rascunho não é público e não tem tag); senão, um rascunho novo. O
#     rascunho não cria a tag;
#  3. os ANEXOS: cada pacote e o SHA256SUMS. Um anexo que já está no rascunho com a mesma soma SHA-256 é pulado; um com outra soma,
#     ou pela metade (o envio que falha pode deixar um anexo "starter"), é apagado e enviado de novo; um anexo que não é da lista é
#     apagado. Depois, o rascunho é relido e conferido: os onze nomes, todos completos, cada soma igual à do arquivo;
#  4. a PUBLICAÇÃO (draft=false), que é o que cria a tag, no commit desta execução. Antes dela, a tag é procurada no remoto pelo
#     nome EXATO: se ela já existe (alguém a criou, ou outra execução publicou), nada é publicado;
#  5. a conferência: a tag aponta para este commit e a release publicada tem os onze anexos. Se a release não saiu imutável (as
#     releases imutáveis desligadas no repositório), o aviso fica à vista: a garantia que o README dá depende delas.
# Repetir o job depois de uma falha em qualquer ponto é seguro: o que já foi feito é conferido e pulado. Nenhum pedido que cria,
# muda ou apaga é repetido pelo script; só as leituras (GET) são repetidas, até três vezes, num erro passageiro.
#
# O único token é o GITHUB_TOKEN do job (GH_TOKEN, com `contents: write` só neste job). O `gh` roda com uma pasta de configuração
# própria e vazia, sem as variáveis que mudariam o que ele faz ou escreve (GH_DEBUG, DEBUG, GH_ENTERPRISE_TOKEN, …), e sem
# perguntar nada; o token nunca vai em argumento, em URL nem em arquivo, e nada é impresso com ele. O git recebe o token como
# version.sh diz. As notas, que trazem mensagens de commit, vão ao log com os comandos de workflow desligados.
#
# Uso (só na pipeline): bash scripts/ci/publish-release.sh --expect <tag>
#      … --remote <remoto>      só para os testes: o remoto de mentira (a pipeline nunca passa isto)
# Variáveis: GH_TOKEN, e as padrão do GitHub Actions: GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_REF_NAME e GITHUB_SHA.
# Precisa de bash, git, gh, jq, sha256sum e, num beta (ou numa estável sem seção no changelog), do Docker (a imagem do git-cliff).
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
cd "$root"
# shellcheck source=version.sh
source "$here/version.sh"
# shellcheck source=packages.sh
source "$here/packages.sh"
# shellcheck source=actions.sh
source "$here/actions.sh"

fail() {
  echo "publish-release: $1" >&2
  ci_summary "**O lançamento parou.** $1"
  exit 1
}

usage() {
  echo "Uso: publish-release.sh --expect <tag> [--remote <remoto>]" >&2
  exit 2
}

expected=
while [ $# -gt 0 ]; do
  case "$1" in
    --remote) [ $# -ge 2 ] || usage; release_remote_arg=$2; shift ;;
    --expect) [ $# -ge 2 ] || usage; expected=$2; shift ;;
    *) usage ;;
  esac
  shift
done
[ -n "$expected" ] || usage

[ -n "${GH_TOKEN:-}" ] || fail "GH_TOKEN ausente: o job de lançamento passa o GITHUB_TOKEN dele ao gh (este script só roda na pipeline)."
for variable in GITHUB_REPOSITORY GITHUB_SERVER_URL GITHUB_REF_NAME GITHUB_SHA; do
  [ -n "${!variable:-}" ] || fail "$variable ausente (este script só roda na pipeline)."
done
if ! printf '%s' "$GITHUB_REPOSITORY" | grep -Eq '^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$' || [[ "$GITHUB_REPOSITORY" == *..* ]]; then
  fail "GITHUB_REPOSITORY não está no formato dono/repositório."
fi
[[ "$GITHUB_SERVER_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || fail "GITHUB_SERVER_URL não é https://<servidor>."
gh_host=${GITHUB_SERVER_URL#https://}
repo=$GITHUB_REPOSITORY
retry_delay=${PRISM_CI_RETRY_DELAY:-3}
[[ "$retry_delay" =~ ^[0-9]+$ ]] || retry_delay=3

commit=$(pipeline_commit) || fail "o commit da execução não confere. Nada foi publicado."
version=$(package_version)
branch=$GITHUB_REF_NAME

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/gh"

# --- o gh: uma pasta de configuração própria e vazia, nada que mude o que ele faz ou escreve ---

gh_api() {
  env -u GH_DEBUG -u DEBUG -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GITHUB_TOKEN -u GH_REPO -u GH_PATH -u GH_BROWSER \
    GH_CONFIG_DIR="$tmp/gh" GH_HOST="$gh_host" GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1 \
    GH_PAGER=cat PAGER=cat NO_COLOR=1 CLICOLOR=0 GH_SPINNER_DISABLED=1 \
    gh api -H 'Accept: application/vnd.github+json' "$@"
}

# gh_get <arquivo de saída> <argumentos do gh api>: uma LEITURA, repetida até três vezes num erro.
gh_get() {
  local out=$1 attempt
  shift
  for attempt in 1 2 3; do
    if gh_api "$@" > "$out" 2> "$tmp/gh-erro"; then return 0; fi
    [ "$attempt" -eq 3 ] || sleep $((retry_delay * attempt))
  done
  cat "$tmp/gh-erro" >&2
  return 1
}

# gh_send <arquivo de saída> <argumentos do gh api>: um pedido que CRIA, MUDA ou APAGA. Nunca é repetido: um pedido que o GitHub
# atendeu e respondeu com erro, repetido às cegas, faria duas vezes. Quem confere o que ficou é a repetição do job.
gh_send() {
  local out=$1
  shift
  gh_api "$@" > "$out" 2> "$tmp/gh-erro" || { cat "$tmp/gh-erro" >&2; return 1; }
}

# releases_of <tag> <arquivo>: as releases (rascunhos inclusive) com essa tag, como uma lista JSON. Lê todas as páginas.
releases_of() {
  local tag=$1 out=$2 page=1 count
  echo '[]' > "$tmp/todas.json"
  while :; do
    gh_get "$tmp/pagina.json" "repos/$repo/releases?per_page=100&page=$page" || return 1
    count=$(jq 'length' "$tmp/pagina.json") || return 1
    jq -s '.[0] + .[1]' "$tmp/todas.json" "$tmp/pagina.json" > "$tmp/juntas.json" && mv "$tmp/juntas.json" "$tmp/todas.json"
    [ "$count" -eq 100 ] || break
    page=$((page + 1))
    [ "$page" -le 100 ] || { echo "publish-release: mais de 10.000 releases: não consegui ler todas." >&2; return 1; }
  done
  jq --arg tag "$tag" '[.[] | select(.tag_name == $tag)]' "$tmp/todas.json" > "$out"
}

# assets_problem <arquivo com a release>: por que os anexos da release não são os desta execução, ou nada se são.
assets_problem() {
  local release=$1 file name state digest size local_sha
  for file in "${files[@]}" SHA256SUMS; do
    name=$(jq -r --arg name "$file" '[.assets[] | select(.name == $name)] | length' "$release")
    [ "$name" = 1 ] || { echo "falta o anexo $file (ou ele está repetido)."; return 0; }
    state=$(jq -r --arg name "$file" '.assets[] | select(.name == $name) | .state' "$release")
    digest=$(jq -r --arg name "$file" '.assets[] | select(.name == $name) | .digest // ""' "$release")
    size=$(jq -r --arg name "$file" '.assets[] | select(.name == $name) | .size' "$release")
    local_sha=$(sha256sum < "src/client/release/$file" | cut -d ' ' -f 1)
    [ "$state" = uploaded ] || { echo "o anexo $file não está completo (estado \"$state\")."; return 0; }
    if [ -n "$digest" ]; then
      [ "$digest" = "sha256:$local_sha" ] || { echo "o anexo $file não tem a soma do arquivo desta execução."; return 0; }
    else
      [ "$size" = "$(wc -c < "src/client/release/$file" | tr -d ' ')" ] || { echo "o anexo $file não tem o tamanho do arquivo desta execução."; return 0; }
    fi
  done
  name=$(jq -r '.assets | length' "$release")
  [ "$name" -eq $(( ${#files[@]} + 1 )) ] || echo "a release tem $name anexos, e eram $(( ${#files[@]} + 1 ))."
}

# verify_published <tag>: a release publicada dessa tag existe, aponta para este commit e tem os anexos desta lista.
verify_published() {
  local tag=$1 now problem
  now=$(remote_ref_commit "refs/tags/$tag") || fail "não consegui reler a tag $tag no remoto. Confira-a à mão."
  [ "$now" = "$commit" ] || fail "a tag $tag aponta para ${now:-nada}, e não para o commit desta execução ($commit)."
  gh_get "$tmp/publicada.json" "repos/$repo/releases/tags/$tag" || fail "a tag $tag existe neste commit e não achei a release publicada dela: a tag foi criada fora do lançamento, ou a release foi apagada. Confira à mão: nada foi publicado agora."
  [ "$(jq -r '.draft' "$tmp/publicada.json")" = false ] || fail "a release $tag não está publicada."
  local names
  names=$(jq -r '[.assets[].name] | sort | join(" ")' "$tmp/publicada.json")
  [ "$names" = "$(printf '%s\n' "${files[@]}" SHA256SUMS | sort | paste -sd ' ' -)" ] || fail "a release publicada $tag não tem os anexos da lista (packages.txt e o SHA256SUMS). Ela não pode ser completada se for imutável: confira à mão."
  if [ "$(jq -r '.immutable // false' "$tmp/publicada.json")" != true ]; then
    ci_warning "Release mutável" "a release $tag não é imutável: as releases imutáveis não estão ligadas no repositório, e um pacote publicado ainda pode ser trocado. A garantia das atualizações que o README descreve conta com elas (docs/ci.md, lista de conferência)."
  fi
}

# --- a decisão de agora, e o plano ---

decide_release "$version" "$branch" "$commit"
case "$decision" in
  error) fail "$decision_detail Nada foi publicado." ;;
  launch | done) ;;
  *)
    ci_warning "Não lança" "$(no_launch_message)"
    exit 0
    ;;
esac
tag=$release_tag
release_version=${tag#v}
prerelease=false
[[ "$release_version" != *-* ]] || prerelease=true
name=$(release_name "$release_version")
groups=(win linux mac-arm64 mac-x64)
list=$(package_files "$release_version" "${groups[@]}") || exit 1
files=()
while IFS= read -r file; do files+=("$file"); done <<< "$list"

if [ "$decision" = done ]; then
  verify_published "$tag"
  echo "publish-release: o $name já foi lançado deste commit (a tag $tag e a release existem). Nada a publicar."
  ci_summary "**Já lançada.** $name, tag $tag, commit $commit."
  exit 0
fi
[ "$tag" = "$expected" ] || fail "a conferência do começo da execução planejou $expected, e o estado das tags de agora pede $tag: os pacotes desta execução foram gerados para o plano. Nada foi publicado. Rode a execução inteira de novo."

# --- 1. as conferências de antes de escrever ---

missing=0
for file in "${files[@]}"; do
  [ -f "src/client/release/$file" ] || { echo "publish-release: faltou $file" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || fail "faltam pacotes em src/client/release (vêm dos jobs de empacotar, com a versão $release_version). Nada foi publicado."
# Cada linha é "<soma>  <arquivo>", com dois espaços, escrita aqui mesmo: o formato é contrato com o atualizador do app.
(cd src/client/release && for file in "${files[@]}"; do printf '%s  %s\n' "$(sha256sum < "$file" | cut -d ' ' -f 1)" "$file"; done) > "$tmp/SHA256SUMS"
mv "$tmp/SHA256SUMS" src/client/release/SHA256SUMS
cat src/client/release/SHA256SUMS

if [ "$prerelease" = true ]; then
  previous=$(previous_tag "$commit") || fail "o commit de uma tag de versão não está neste clone: o job precisa do histórico inteiro, com as tags."
  bash "$here/release-notes.sh" --beta ${previous:+--since "$previous"} "$release_version" || fail "as notas do beta não saíram. Nada foi publicado."
else
  # Sem a seção da versão no changelog, as notas saem do git-cliff desde a estável anterior (release-notes.sh).
  previous=$(previous_tag "$commit" stable) || fail "o commit de uma tag de versão não está neste clone: o job precisa do histórico inteiro, com as tags."
  bash "$here/release-notes.sh" ${previous:+--since "$previous"} "$release_version" || fail "as notas da versão não saíram. Nada foi publicado."
fi

default_ref=$(remote_git ls-remote --symref "$(release_remote)" HEAD | awk '$1 == "ref:" && $3 == "HEAD" { print $2 }') || true
[[ "$default_ref" == refs/heads/* ]] || fail "não consegui ler o ramo padrão do repositório. Nada foi publicado."
default_commit=$(remote_ref_commit "$default_ref") || fail "não consegui ler o ramo padrão do repositório. Nada foi publicado."
git cat-file -e "$default_commit^{commit}" 2> /dev/null || remote_git fetch --quiet --no-tags "$(release_remote)" "$default_ref" || fail "não consegui buscar o ramo padrão (${default_ref#refs/heads/}). Nada foi publicado."
changed=$(git diff --name-only --diff-filter=AM "$default_commit" "$commit" -- .github/workflows)
[ -z "$changed" ] || fail "o commit $commit acrescenta ou muda arquivos de .github/workflows/ em relação ao ramo padrão (${default_ref#refs/heads/}): $(printf '%s' "$changed" | paste -sd ' ' -). A API de releases recusa (404) criar ou publicar a release de um commit assim com o GITHUB_TOKEN, que não pode ter a permissão de workflows. Leve a mudança ao ramo padrão e rode de novo. Nada foi publicado."

now=$(remote_ref_commit "refs/tags/$tag") || fail "não consegui ler as tags do remoto. Nada foi publicado."
[ -z "$now" ] || fail "a tag $tag apareceu no remoto (no commit $now) depois da decisão, e não foi este job que a criou. Nada foi publicado."

echo "publish-release: LANÇAMENTO do $name ($([ "$prerelease" = true ] && echo pré-lançamento || echo estável)), do commit $commit."

# --- 2. o rascunho ---

releases_of "$tag" "$tmp/da-tag.json" || fail "não consegui ler as releases do repositório. Nada foi publicado; repita o job."
[ "$(jq '[.[] | select(.draft == false)] | length' "$tmp/da-tag.json")" -eq 0 ] || fail "já existe uma release PUBLICADA com o nome de tag $tag, e a tag não existe no remoto: estado inesperado (a tag foi apagada?). Nada foi publicado; confira à mão."
draft_id=
while IFS=$'\t' read -r id target; do
  [ -n "$id" ] || continue
  if [ -z "$draft_id" ] && [ "$target" = "$commit" ]; then
    draft_id=$id
    continue
  fi
  echo "publish-release: apagando o rascunho $id da tag $tag (commit ${target:-nenhum}), que não é deste lançamento."
  gh_send "$tmp/apagou.json" --method DELETE "repos/$repo/releases/$id" || fail "não consegui apagar o rascunho $id. Nada foi publicado; repita o job."
done < <(jq -r '.[] | [.id, .target_commitish] | @tsv' "$tmp/da-tag.json")

jq -n --arg tag "$tag" --arg target "$commit" --arg name "$name" --rawfile body release-notes.md --argjson prerelease "$prerelease" \
  '{tag_name: $tag, target_commitish: $target, name: $name, body: $body, draft: true, prerelease: $prerelease}' > "$tmp/rascunho.json"
if [ -n "$draft_id" ]; then
  echo "publish-release: retomando o rascunho $draft_id, deixado por uma tentativa anterior deste commit."
  gh_send "$tmp/release.json" --method PATCH "repos/$repo/releases/$draft_id" --input "$tmp/rascunho.json" || fail "não consegui atualizar o rascunho $draft_id. Nada foi publicado; repita o job."
else
  gh_send "$tmp/release.json" --method POST "repos/$repo/releases" --input "$tmp/rascunho.json" || fail "a criação do rascunho de $tag falhou, e ele pode ou não ter ficado. Nada foi publicado; repita o job, que retoma o rascunho se ele existir."
  draft_id=$(jq -r '.id' "$tmp/release.json")
fi
[[ "$draft_id" =~ ^[0-9]+$ ]] || fail "o GitHub não devolveu o número do rascunho. Nada foi publicado; repita o job."
[ "$(jq -r '.draft' "$tmp/release.json")" = true ] || fail "a release $draft_id não é um rascunho. Nada foi publicado; confira à mão."

# --- 3. os anexos ---

upload=$(jq -r '.upload_url' "$tmp/release.json")
upload=${upload%%\{*}
[ "$upload" = "https://uploads.$gh_host/repos/$repo/releases/$draft_id/assets" ] || fail "o endereço de envio dos anexos não é o do repositório. Nada foi publicado."
expected_names=$(printf '%s\n' "${files[@]}" SHA256SUMS)
while IFS=$'\t' read -r asset_id asset_name; do
  [ -n "$asset_id" ] || continue
  if ! printf '%s\n' "$expected_names" | grep -qx -- "$asset_name"; then
    echo "publish-release: apagando o anexo $asset_name, que não é desta lista."
    gh_send "$tmp/apagou.json" --method DELETE "repos/$repo/releases/assets/$asset_id" || fail "não consegui apagar o anexo $asset_name do rascunho. Nada foi publicado; repita o job."
  fi
done < <(jq -r '.assets[] | [.id, .name] | @tsv' "$tmp/release.json")
for file in "${files[@]}" SHA256SUMS; do
  local_sha=$(sha256sum < "src/client/release/$file" | cut -d ' ' -f 1)
  existing=$(jq -r --arg name "$file" '.assets[] | select(.name == $name) | [.id, .state, (.digest // "")] | @tsv' "$tmp/release.json")
  if [ -n "$existing" ]; then
    IFS=$'\t' read -r asset_id asset_state asset_digest <<< "$existing"
    if [ "$asset_state" = uploaded ] && [ "$asset_digest" = "sha256:$local_sha" ]; then
      echo "publish-release: $file já está no rascunho com a mesma soma: não envio de novo."
      continue
    fi
    echo "publish-release: o anexo $file do rascunho está pela metade ou é de outros bytes: apago e envio de novo."
    gh_send "$tmp/apagou.json" --method DELETE "repos/$repo/releases/assets/$asset_id" || fail "não consegui apagar o anexo $file do rascunho. Nada foi publicado; repita o job."
  fi
  echo "publish-release: enviando $file"
  gh_send "$tmp/anexo.json" --method POST -H 'Content-Type: application/octet-stream' --input "src/client/release/$file" "$upload?name=$file" || fail "o envio de $file falhou, e o anexo pode ter ficado pela metade. Nada foi publicado; repita o job: ele confere pela soma o que ficou."
done

gh_get "$tmp/rascunho-lido.json" "repos/$repo/releases/$draft_id" || fail "não consegui reler o rascunho $draft_id. Nada foi publicado; repita o job."
problem=$(assets_problem "$tmp/rascunho-lido.json")
[ -z "$problem" ] || fail "o rascunho não ficou com os anexos desta execução: $problem Nada foi publicado; repita o job."
[ "$(jq '[.assets[] | select((.digest // "") == "")] | length' "$tmp/rascunho-lido.json")" -eq 0 ] || ci_warning "Anexo sem soma" "o GitHub não devolveu a soma SHA-256 de algum anexo do rascunho de $tag; o tamanho de cada um foi conferido no lugar."

# --- 4. a publicação, que cria a tag ---

now=$(remote_ref_commit "refs/tags/$tag") || fail "não consegui ler as tags do remoto antes de publicar. Nada foi publicado; repita o job."
[ -z "$now" ] || fail "a tag $tag apareceu no remoto (no commit $now) durante o lançamento. Nada foi publicado: confira à mão."
if [ "$prerelease" = false ]; then latest=true; else latest=false; fi
jq -n --argjson prerelease "$prerelease" --arg latest "$latest" '{draft: false, prerelease: $prerelease, make_latest: $latest}' > "$tmp/publicar.json"
if ! gh_send "$tmp/release.json" --method PATCH "repos/$repo/releases/$draft_id" --input "$tmp/publicar.json"; then
  if grep -q 'HTTP 40[13]' "$tmp/gh-erro"; then
    fail "a publicação de $tag foi recusada (permissão: o job precisa de contents: write, e uma regra de tag em v* pode impedir o GITHUB_TOKEN de criar a tag). O rascunho está completo e a tag não foi criada; corrija e repita o job."
  fi
  fail "a publicação de $tag falhou no caminho, e ela pode ter saído. Repita o job: ele confere a tag e a release antes de fazer qualquer coisa."
fi

# --- 5. a conferência ---

verify_published "$tag"
echo "publish-release: $name publicado. A tag $tag aponta para $commit."
ci_summary "**Publicado:** $name ($([ "$prerelease" = true ] && echo pré-lançamento || echo estável)), tag $tag, commit $commit, com $(( ${#files[@]} + 1 )) anexos."
