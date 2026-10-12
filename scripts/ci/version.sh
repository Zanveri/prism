#!/usr/bin/env bash
# Para ser lido com `source`, da raiz do repositório: o que os scripts do lançamento (RN-VERSAO-008) têm em comum, e a decisão ÚNICA
# de lançar ou não, que o check-version.sh e o publish-release.sh usam (`decide_release`). Quem decide é o estado do REMOTO (as
# tags) e do CHANGELOG.md, lidos na hora: nada passa de um job a outro por variável, e repetir um job dá o mesmo resultado.
#
# A pipeline só roda no merge em `develop` e em `main` (RN-ABERTO-005). Nos dois ramos o campo `version` de
# src/client/package.json é a PRÓXIMA versão estável, X.Y.Z, sem sufixo: o sufixo -beta.N quem põe é a pipeline.
#
#   develop                                                  decisão
#   a tag estável vX.Y.Z já existe                           stable-exists: não lança (o beta seria mais velho que a estável)
#   um beta vX.Y.Z-beta.K já aponta para este commit         done: já lançado daqui
#   o último beta saiu de um commit que este não contém      behind: não lança (execução repetida ou fora de ordem)
#   senão                                                    launch: o beta vX.Y.Z-beta.N, N = um a mais que o maior
#
#   main                                                     decisão
#   a tag vX.Y.Z aponta para este commit                     done: já lançada daqui
#   a tag vX.Y.Z aponta para outro commit                    tagged-elsewhere: não lança
#   sem a tag e sem a seção "## [X.Y.Z] - AAAA-MM-DD"        no-notes: não lança
#   sem a tag e com a seção                                  launch: a estável vX.Y.Z
#
# São ERRO, sempre (nunca aviso, nunca "não existe"): a versão fora do formato ou com sufixo, a versão que regrediu (o que seria
# lançado não é maior que toda tag de versão que já existe), um título do CHANGELOG.md que cita a versão fora do formato exato
# (a seção não seria lida, e o merge passaria sem lançar), outro ramo, e o remoto que não responde.
#
#  - A versão. `package_version` lê o campo `version` de src/client/package.json, o único lugar onde ela mora (RN-VERSAO-003).
#    `version_fields` só aceita X.Y.Z, X.Y.Z-beta.N e X.Y.Z-rc.N (RN-VERSAO-001), cada número sem zero à esquerda e com até nove
#    dígitos: é a regra do atualizador do app (src/client/electron/update/version.ts), e uma versão que o app não entende não é
#    lançada. A versão só vira nome de tag, nome de arquivo ou pedaço de endereço DEPOIS de passar por aqui.
#  - As notas de uma estável. `version_notes` devolve o texto da seção da versão no CHANGELOG.md. O título é EXATAMENTE
#    "## [X.Y.Z] - AAAA-MM-DD" (com " [YANKED]" no fim, se for o caso); um título parecido não é a seção. As notas de um beta não
#    vêm daqui: o release-notes.sh as gera com o git-cliff, desde a tag anterior (`previous_tag`).
#  - O remoto. Na pipeline é SEMPRE a URL limpa do repositório, $GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git, sem usuário nem token;
#    fora dela é `origin`. Só o ARGUMENTO `--remote <remoto>` de cada script troca isso, e a pipeline nunca o passa (os testes passam
#    um repositório de mentira). As variáveis GITHUB_* não podem ser sobrescritas por quem configura o repositório (documentação
#    das variáveis padrão), e nenhuma outra variável de ambiente troca o remoto.
#  - O token. Na pipeline o git o recebe de um auxiliar de credencial (`credential.<servidor>.helper`) que o lê do AMBIENTE
#    (GH_TOKEN) na hora em que o servidor pede, e que SÓ responde ao servidor do repositório (o protocolo e o host de
#    $GITHUB_SERVER_URL): a outro servidor o token não vai. O token não vai em URL, em argumento de comando nem em arquivo; o texto
#    do auxiliar, que só cita o NOME da variável, chega ao git por variáveis de ambiente (GIT_CONFIG_*), não pela linha de comando;
#    a lista de auxiliares é zerada antes; a configuração global e a do sistema da máquina não são lidas; e as variáveis de rastreio
#    do git que mostrariam o cabeçalho HTTP são tiradas. Fora da pipeline (sem GH_TOKEN) vale a credencial que o seu git já tem.
#  - O commit. `pipeline_commit` devolve o commit em que o job está, e recusa um GITHUB_SHA que não seja ele.
#  - "Não consegui perguntar" nunca vira "não existe": toda função que fala com o remoto sai com erro quando ele não responde.

# O remoto de mentira dos testes: cada script o preenche com o argumento `--remote`. Zerado aqui de propósito, para uma variável
# de ambiente com este nome não valer.
release_remote_arg=

version_number='(0|[1-9][0-9]{0,8})'
stable_version="$version_number\\.$version_number\\.$version_number"
version_pattern="^$stable_version(-(beta|rc)\\.$version_number)?\$"
stable_pattern="^$stable_version\$"

package_version() {
  sed -n 's/^  "version": "\([^"]*\)".*$/\1/p' src/client/package.json | head -n 1
}

# version_fields <versão>: "X Y Z ordem N", para comparar número a número; ordem 0 é beta, 1 é rc e 2 é a estável (a estável vem
# depois dos pré-lançamentos dela, como manda o SemVer). Sai com 1 se a versão não tem o formato.
version_fields() {
  [[ "$1" =~ $version_pattern ]] || return 1
  local rank=2 n=0
  if [ -n "${BASH_REMATCH[4]}" ]; then
    n=${BASH_REMATCH[6]}
    if [ "${BASH_REMATCH[5]}" = beta ]; then rank=0; else rank=1; fi
  fi
  echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} $rank $n"
}

# version_greater <a> <b>: a vem depois de b na ordem do SemVer?
version_greater() {
  local a b i
  a=$(version_fields "$1") || return 2
  b=$(version_fields "$2") || return 2
  a=($a)
  b=($b)
  for i in 0 1 2 3 4; do
    [ "${a[$i]}" -le "${b[$i]}" ] || return 0
    [ "${a[$i]}" -ge "${b[$i]}" ] || return 1
  done
  return 1
}

# O título da release. O GitHub marca o pré-lançamento na própria release (`prerelease`); o título só leva a versão.
release_name() {
  echo "Prism $1"
}

# heading_version <linha>: se a linha é o título de uma seção de versão no formato EXATO, "## [X.Y.Z] - AAAA-MM-DD" (uma versão
# estável da RN-VERSAO-001, um mês de 01 a 12, um dia de 01 a 31, e " [YANKED]" opcional no fim), escreve a versão. Senão sai com
# 1: "## 0.1.0", "## [v0.1.0] - …", "## [0.1.0]" e "## [0.1.0] - 11/10/2026" não são títulos de versão.
heading_version() {
  local pattern="^## \\[($stable_version)\\] - [0-9]{4}-([0-9]{2})-([0-9]{2})( \\[YANKED\\])?\$"
  [[ "$1" =~ $pattern ]] || return 1
  local month=${BASH_REMATCH[5]#0} day=${BASH_REMATCH[6]#0}
  [ "$month" -ge 1 ] && [ "$month" -le 12 ] && [ "$day" -ge 1 ] && [ "$day" -le 31 ] || return 1
  echo "${BASH_REMATCH[1]}"
}

# notes_heading <versão>: o título que o CHANGELOG.md precisa ter para a versão estável ter notas (para as mensagens).
notes_heading() {
  echo "## [$1] - AAAA-MM-DD"
}

# version_notes <versão> [arquivo]: o texto da seção da versão estável no CHANGELOG.md, sem o título, até o próximo "## ". Nada
# se a seção não existe (ou se o arquivo não existe).
version_notes() {
  local version=$1 file=${2:-CHANGELOG.md} line found=0
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    if [ "$found" -eq 1 ]; then
      [[ "$line" != "## "* ]] || break
      printf '%s\n' "$line"
    elif [[ "$line" == "## ["* ]] && [ "$(heading_version "$line")" = "$version" ]; then
      found=1
    fi
  done < "$file"
}

# loose_headings <versão> [arquivo]: os títulos de segundo nível do CHANGELOG.md que CITAM a versão e não estão no formato exato
# ("## 0.9.0 - …", "## [v0.9.0] - …", "## [0.9.0]", a data fora do formato), um por linha. Com um título desses o merge na main
# passaria sem lançar e sem ninguém ver por quê: quem chama trata como erro.
loose_headings() {
  local version=$1 file=${2:-CHANGELOG.md} line escaped
  [ -f "$file" ] || return 0
  escaped=${version//./\\.}
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [[ "$line" == "## "* ]] || continue
    [[ "$line" =~ (^|[^0-9.])$escaped([^0-9]|$) ]] || continue
    [ "$(heading_version "$line")" = "$version" ] || printf '%s\n' "$line"
  done < "$file"
}

release_remote() {
  if [ -n "$release_remote_arg" ]; then
    echo "$release_remote_arg"
  elif [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
    echo "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git"
  else
    echo origin
  fi
}

# pipeline_commit: o commit em que o job está (`git rev-parse HEAD`). Com GITHUB_SHA no ambiente, ele tem de ser esse mesmo
# commit; senão sai com 1, com o motivo na saída de erro (sem repetir o valor recebido).
pipeline_commit() {
  local head
  head=$(git rev-parse HEAD) || return 1
  if [ -n "${GITHUB_SHA+set}" ] && [ "$GITHUB_SHA" != "$head" ]; then
    echo "a variável GITHUB_SHA não é o commit em que este job está ($head): nada é lançado com um commit que não é o do job." >&2
    return 1
  fi
  echo "$head"
}

# O git que fala com o remoto. Com GH_TOKEN e GITHUB_SERVER_URL (a pipeline), o usuário `x-access-token` com o token como senha, que
# é a forma que a documentação do GitHub dá para o token de instalação de um app (o GITHUB_TOKEN é um). O auxiliar fica preso ao
# servidor do repositório: a chave é `credential.<protocolo>://<host>.helper`. A configuração global e a do sistema não são lidas
# (GIT_CONFIG_GLOBAL e GIT_CONFIG_NOSYSTEM): nada da máquina do runner muda para onde o git vai nem o que ele manda.
remote_git() {
  if [ -z "${GH_TOKEN:-}" ] || [ -z "${GITHUB_SERVER_URL:-}" ]; then
    git "$@"
    return
  fi
  local rest=${GITHUB_SERVER_URL#*://}
  local server=${GITHUB_SERVER_URL%%://*}://${rest%%/*}
  env -u GIT_TRACE_CURL -u GIT_CURL_VERBOSE -u GIT_TRACE_REDACT -u GIT_ASKPASS -u SSH_ASKPASS \
    GIT_TERMINAL_PROMPT=0 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= \
    GIT_CONFIG_KEY_1="credential.$server.helper" \
    GIT_CONFIG_VALUE_1='!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$GH_TOKEN"; }; f' \
    git "$@"
}

# remote_ref_commit <ref completo>: o commit para onde o ref aponta no remoto (a tag anotada é seguida até o commit), ou nada se o
# ref não existe. O `git ls-remote` casa o padrão pela CAUDA do nome: `refs/tags/v0.2.0` também devolve uma tag chamada
# `x/refs/tags/v0.2.0` e um ramo comum chamado `refs/tags/v0.2.0`, que qualquer um que possa enviar ramo consegue criar. Só vale a
# linha cujo nome é EXATAMENTE o ref pedido (ou ele com `^{}`, que é a tag anotada seguida até o commit).
remote_ref_commit() {
  local out
  out=$(remote_git ls-remote "$(release_remote)" "$1" "$1^{}") || return 1
  printf '%s\n' "$out" | awk -v ref="$1" '$2 == ref || $2 == ref "^{}" { if ($2 == ref "^{}" || sha == "") sha = $1 } END { if (sha != "") print sha }'
}

# remote_version_refs: "<versão> <commit>", uma por linha, de toda tag do remoto cujo nome é EXATAMENTE `v` + uma versão no formato
# da RN-VERSAO-001 (v0.1.0 sai como "0.1.0 <commit>"; a tag anotada é seguida até o commit). `vNext`, `v1`, `v0.1.0-beta.01` e uma
# tag-isca como `x/refs/tags/v0.1.0` não entram. Sai com 1 se o remoto não respondeu.
remote_version_refs() {
  local out
  out=$(remote_git ls-remote --tags "$(release_remote)" 'refs/tags/v*') || return 1
  printf '%s\n' "$out" | awk '
    $2 ~ /^refs\/tags\/v/ {
      name = substr($2, 12)
      peeled = sub(/\^\{\}$/, "", name)
      if (peeled || !(name in sha)) sha[name] = $1
    }
    END { for (name in sha) print name, sha[name] }' | while read -r name commit; do
    version_fields "$name" > /dev/null && printf '%s %s\n' "$name" "$commit"
  done
  return 0
}

# greatest_version <versão>...: a maior na ordem do SemVer (nada, sem argumento).
greatest_version() {
  local greatest= version
  for version in "$@"; do
    if [ -z "$greatest" ] || version_greater "$version" "$greatest"; then greatest=$version; fi
  done
  [ -z "$greatest" ] || echo "$greatest"
}

# is_ancestor <a> <b>: o commit a está na história de b (ou é o próprio b)? Sai com 2 se um dos dois não está no clone: o job
# do lançamento clona o histórico inteiro, com as tags.
is_ancestor() {
  git cat-file -e "$1^{commit}" 2> /dev/null && git cat-file -e "$2^{commit}" 2> /dev/null || return 2
  git merge-base --is-ancestor "$1" "$2"
}

# previous_tag <commit>: a maior tag de versão (estável ou beta) cujo commit está na história de <commit> e não é ele: é "a tag
# anterior" de onde as notas de um beta começam. Nada se não há nenhuma (o primeiro beta). Usa `version_refs`, que quem chama já
# leu com `remote_version_refs`; sai com 1 se o commit de uma tag não está no clone.
previous_tag() {
  local commit=$1 version tag_commit candidates=() status
  while read -r version tag_commit; do
    [ -n "$version" ] || continue
    [ "$tag_commit" != "$commit" ] || continue
    status=0
    is_ancestor "$tag_commit" "$commit" || status=$?
    [ "$status" -ne 2 ] || return 1
    [ "$status" -ne 0 ] || candidates+=("$version")
  done <<< "$version_refs"
  version=$(greatest_version "${candidates[@]+"${candidates[@]}"}")
  [ -z "$version" ] || echo "v$version"
}

# decide_release <versão> <ramo> <commit>: a decisão única do lançamento (as tabelas do topo). Não escreve nada: deixa em
# `decision` uma destas palavras, em `decision_detail` o motivo ou o commit que importa, em `release_tag` a tag (a lançar, ou a
# que já existe neste commit) e em `version_refs` as tags de versão do remoto, como `remote_version_refs` as escreve.
#   launch | done | stable-exists | behind | tagged-elsewhere | no-notes | error
decide_release() {
  local version=$1 branch=$2 commit=$3 greatest candidate tag_commit loose notes
  decision=error
  decision_detail=
  release_tag=
  version_refs=
  if ! version_fields "$version" > /dev/null; then
    decision_detail="a versão \"$version\" de src/client/package.json não segue o formato X.Y.Z, com cada número sem zero à esquerda (RN-VERSAO-001)."
    return 0
  fi
  if [[ ! "$version" =~ $stable_pattern ]]; then
    decision_detail="o campo \"version\" de src/client/package.json é \"$version\": nos ramos develop e main ele é a próxima versão estável, X.Y.Z, sem sufixo. O sufixo -beta.N de um pré-lançamento quem põe é a pipeline (docs/versionamento.md)."
    return 0
  fi
  case "$branch" in
    develop | main) ;;
    *)
      decision_detail="a pipeline só lança dos ramos develop e main, e o ramo é \"$branch\"."
      return 0
      ;;
  esac
  if ! version_refs=$(remote_version_refs); then
    decision_detail="não consegui ler as tags do remoto, e sem elas não dá para saber o que já foi lançado."
    return 0
  fi
  greatest=$(greatest_version $(printf '%s\n' "$version_refs" | awk 'NF { print $1 }'))
  tag_commit=$(printf '%s\n' "$version_refs" | awk -v v="$version" '$1 == v { print $2 }')

  if [ "$branch" = main ]; then
    release_tag=v$version
    if [ -n "$tag_commit" ]; then
      decision_detail=$tag_commit
      if [ "$tag_commit" = "$commit" ]; then decision=done; else decision=tagged-elsewhere; fi
      return 0
    fi
    if [ -n "$greatest" ] && ! version_greater "$version" "$greatest"; then
      decision_detail="a versão \"$version\" de src/client/package.json não é maior que a $greatest, a maior já lançada (tag v$greatest): a versão regrediu. Um número já usado ou mais antigo não é lançado."
      return 0
    fi
    loose=$(loose_headings "$version")
    if [ -n "$loose" ]; then
      decision_detail="o CHANGELOG.md tem o título \"$(printf '%s' "$loose" | head -n 1)\", que cita a versão $version e não está no formato exato \"$(notes_heading "$version")\" (a versão sem o v, entre colchetes, e a data com ano, mês e dia). Com outro título a seção não é lida, e o merge passaria sem lançar."
      return 0
    fi
    notes=$(version_notes "$version")
    if [ -n "${notes//[[:space:]]/}" ]; then decision=launch; else decision=no-notes; fi
    return 0
  fi

  # develop: um beta da próxima versão estável.
  if [ -n "$tag_commit" ]; then
    decision=stable-exists
    decision_detail=$tag_commit
    return 0
  fi
  local betas here= latest= latest_commit= n
  betas=$(printf '%s\n' "$version_refs" | awk -v prefix="$version-beta." 'index($1, prefix) == 1 { print substr($1, length(prefix) + 1), $2 }' | sort -n)
  while read -r n tag_commit; do
    [ -n "$n" ] || continue
    [ "$tag_commit" != "$commit" ] || here=$n
    latest=$n
    latest_commit=$tag_commit
  done <<< "$betas"
  if [ -n "$here" ]; then
    decision=done
    release_tag=v$version-beta.$here
    decision_detail=$commit
    return 0
  fi
  if [ -n "$latest" ]; then
    local ancestry=0
    is_ancestor "$latest_commit" "$commit" || ancestry=$?
    case $ancestry in
      0) ;;
      1)
        decision=behind
        release_tag=v$version-beta.$latest
        decision_detail=$latest_commit
        return 0
        ;;
      *)
        decision_detail="o commit $latest_commit da tag v$version-beta.$latest não está neste clone: o job precisa do histórico inteiro, com as tags."
        return 0
        ;;
    esac
  fi
  candidate=$version-beta.$(( ${latest:-0} + 1 ))
  if [ -n "$greatest" ] && ! version_greater "$candidate" "$greatest"; then
    decision_detail="o beta $candidate não seria maior que a $greatest, a maior versão já lançada (tag v$greatest): a versão de src/client/package.json regrediu."
    return 0
  fi
  decision=launch
  release_tag=v$candidate
}

# no_launch_message <versão>: o porquê de não lançar, para a decisão que `decide_release` deixou (stable-exists, behind,
# tagged-elsewhere ou no-notes). É o mesmo texto no check-version.sh, no começo da execução, e no publish-release.sh.
no_launch_message() {
  local version=$1
  case "$decision" in
    stable-exists) echo "a versão $version já tem a tag estável v$version (no commit $decision_detail): um beta dela seria mais velho que a estável. Os pacotes são gerados e nada é publicado. Suba o campo \"version\" de src/client/package.json na develop (docs/versionamento.md)." ;;
    behind) echo "o beta $release_tag saiu do commit $decision_detail, que não está na história deste: este commit é mais antigo (uma execução repetida ou fora de ordem). Nada é publicado; o próximo merge na develop publica o beta seguinte." ;;
    tagged-elsewhere) echo "a versão $version já tem a tag v$version, no commit $decision_detail. Um merge na main sem versão nova não lança: a estável sai do pull request de lançamento (docs/versionamento.md)." ;;
    no-notes) echo "a versão $version não tem tag e o CHANGELOG.md não tem a seção dela, com o título \"$(notes_heading "$version")\" e com texto. Os pacotes são gerados e nada é publicado (docs/versionamento.md)." ;;
    *) return 1 ;;
  esac
}
