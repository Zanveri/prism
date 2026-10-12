#!/usr/bin/env bash
# Verificação da RN-ABERTO-003: nenhum arquivo versionado e nenhuma mensagem de commit pode citar a infraestrutura de quem
# publica o projeto. Procura cinco coisas, e só as formas genéricas ficam escritas aqui:
#   caminho-de-usuario       C:\Users\<nome>, /c/Users/<nome>, /mnt/c/Users/<nome>, /cygdrive/c/Users/<nome>, /home/<nome>,
#                            /var/home/<nome> e /Users/<nome> (marcadores como <nome> e nomes genéricos passam)
#   caminho-de-rede          caminho UNC: duas barras invertidas, o servidor, outra barra invertida e o compartilhamento
#   registro-privado         /api/v4/groups/<número>/... e /api/v4/projects/<número>/... (endereço de API de registro privado de
#                            pacotes, com o grupo ou o projeto pelo número)
#   ip-privado               10/8, 172.16/12 e 192.168/16, e, em IPv6, os prefixos fc e fd e o link-local fe80 a febf (para exemplo
#                            em documento, use 192.0.2.x ou 2001:db8::, que não são privados)
#   termo-extra#N            cada termo da variável LEAK_GUARD_EXTRA (um por linha; N é a linha dele na variável), palavra
#                            inteira, sem diferenciar maiúsculas nem acentos. É por ela que entram os termos próprios de
#                            quem publica: nunca no repositório. Na pipeline ela vem do segredo do repositório de mesmo nome, que
#                            só chega ao passo que roda este script; um segredo não cadastrado chega VAZIO, e por isso, no GitHub
#                            Actions, a variável vazia é "segredo ausente" (o script roda só com os padrões genéricos e avisa à
#                            vista). Na sua máquina o valor pode ser o caminho de um arquivo com os termos, fora do repositório: um
#                            valor de UMA linha só com / ou \ e sem arquivo com esse caminho é erro (grupo/projeto seria tomado por
#                            caminho): para um termo com barra, use o arquivo de termos.
#
# Uso (da raiz do repositório, ou de qualquer pasta dentro dele):
#   bash scripts/ci/leak-guard.sh              os arquivos versionados (conteúdo, sem binários nem lock files, e os NOMES de
#                                              todos os arquivos). "~usuario" não é procurado (dá falso positivo demais).
#   bash scripts/ci/leak-guard.sh --push-range BASE..PONTA
#                                              o mesmo e também as mensagens dos commits que um envio trouxe (na pipeline, o
#                                              `before` e o `after` do push). BASE zerada (ramo novo) ou fora do clone (envio
#                                              forçado): só a árvore, e o aviso diz isso.
#   bash scripts/ci/leak-guard.sh --history    todos os commits: as linhas que cada um acrescentou, as mensagens, nome e e-mail
#                                              de autor, committer e de quem criou cada tag, a mensagem das tags anotadas e os
#                                              nomes de todos os arquivos que algum commit já teve.
#                                              Ignora o arquivo de exceções. Para rodar antes de publicar o repositório (RN-ABERTO-009).
#   bash scripts/ci/leak-guard.sh --messages BASE..PONTA   só as mensagens dos commits desse intervalo
#   … --visibility public|private              na pipeline: a visibilidade do repositório. PÚBLICO, achado reprova (saída 1) e
#                                              nenhum pacote sai; PRIVADO, achado vira aviso à vista e a saída é 0 (o ensaio com o
#                                              repositório privado anda enquanto a limpeza da Tarefa 19 não acontece). Erro de
#                                              uso e de cadastro reprova sempre. Não vale com --history.
#   -v, --show                                 mostra também o texto da linha achada. Só na própria máquina: o log
#                                              de uma pipeline pública não deve receber o que a verificação encontrou.
# Antes de enviar (é o que evita o vazamento): guarde os termos num arquivo FORA do repositório e rode
#   LEAK_GUARD_EXTRA=/caminho/do/arquivo bash scripts/ci/leak-guard.sh --history
# Variáveis: LEAK_GUARD_EXTRA (termos) e LEAK_GUARD_ALLOW (arquivo de exceções; padrão: leak-guard.allow ao lado deste).
# Exceções: "arquivo|padrão|justificativa", uma por linha: valem para UM padrão genérico em UM arquivo e nunca para o termo extra.
# Saída: 0 limpo (ou só avisos, no repositório privado), 1 achados, 2 erro de uso. Precisa de bash, git e awk (mawk ou gawk); o
# sed e o xargs são os do GNU.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=actions.sh
source "$here/actions.sh"
mode=tree
show=0
range=
push_range=
visibility=
usage() {
  echo "Uso: leak-guard.sh [--history | --messages BASE..PONTA | --push-range BASE..PONTA] [--visibility public|private] [-v|--show]" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --history) mode=history ;;
    --messages) range=${2:-}; [[ "$range" == ?*..?* ]] || { echo "leak-guard: --messages pede um intervalo (BASE..PONTA)." >&2; exit 2; }; shift ;;
    --push-range) push_range=${2:-}; [[ "$push_range" == ?*..?* ]] || { echo "leak-guard: --push-range pede um intervalo (BASE..PONTA)." >&2; exit 2; }; shift ;;
    --visibility)
      visibility=${2:-}
      case "$visibility" in public | private) ;; *) echo "leak-guard: --visibility pede public ou private." >&2; exit 2 ;; esac
      shift
      ;;
    -v | --show) show=1 ;;
    *) usage ;;
  esac
  shift
done
[ "$mode" != history ] || [ -z "$visibility$push_range$range" ] || usage
[ -z "$range" ] || [ -z "$push_range" ] || usage

die() {
  echo "leak-guard: $1" >&2
  exit 2
}

# Os termos extras: o valor da variável, ou, se ele for o caminho de um arquivo, o conteúdo do arquivo. Regra: se o valor é uma
# linha só e existe um arquivo com esse caminho, é arquivo; se é uma linha só, tem / ou \ e o arquivo NÃO existe, é erro (e não
# um termo estranho que deixaria o script verde; a mensagem não repete o valor); senão, é a lista de termos. No GitHub Actions a
# variável vazia é o segredo que não foi cadastrado (o contexto `secrets` devolve vazio), e conta como ausente.
extra_defined=0
[ "${LEAK_GUARD_EXTRA+set}" != set ] || extra_defined=1
secret_missing=0
if ci_in_actions && [ "$extra_defined" -eq 1 ] && [ -z "$LEAK_GUARD_EXTRA" ]; then
  extra_defined=0
  secret_missing=1
  unset LEAK_GUARD_EXTRA
fi
extra=${LEAK_GUARD_EXTRA:-}
single=${extra%$'\n'}
single=${single%$'\r'}
if [ -n "$single" ] && [[ "$single" != *$'\n'* ]]; then
  if [ -f "$single" ]; then
    extra=$(cat "$single")
  elif [[ "$single" == */* || "$single" == *\\* ]]; then
    die "LEAK_GUARD_EXTRA parece o caminho de um arquivo, e esse arquivo não existe."
  fi
fi
export LEAK_GUARD_EXTRA=$extra
terms=$(printf '%s\n' "$extra" | tr -d '\r' | grep -cvE '^[[:space:]]*(#|$)' || true)
if [ "$terms" -eq 0 ]; then
  # Variável definida e sem termo nenhum é erro de cadastro; ausente roda só com os padrões genéricos, e diz isso.
  [ "$extra_defined" -eq 0 ] || die "LEAK_GUARD_EXTRA está definida e não tem nenhum termo (arquivo vazio, ou só linhas em branco e comentários): erro de cadastro. Cadastre os termos ou apague a variável."
  if [ "$secret_missing" -eq 1 ]; then
    ci_warning "Sem os termos extras" "o segredo LEAK_GUARD_EXTRA não está cadastrado no repositório: o leak-guard rodou só com os padrões genéricos, e os termos próprios de quem publica não foram conferidos (docs/ci.md, lista de conferência)."
  else
    echo "leak-guard: nenhum termo extra (LEAK_GUARD_EXTRA ausente): só os padrões genéricos."
  fi
else
  echo "leak-guard: $terms termo(s) extra(s) carregado(s) de LEAK_GUARD_EXTRA."
fi

# Exceções (só fora do modo history): "arquivo|padrão|justificativa".
allow=${LEAK_GUARD_ALLOW:-$here/leak-guard.allow}
if [ "$mode" = history ]; then
  allow=
  echo "leak-guard: o modo history ignora o arquivo de exceções."
elif [ -f "$allow" ]; then
  while IFS= read -r entry || [ -n "$entry" ]; do
    entry=${entry%$'\r'}
    case "$entry" in '' | '#'*) continue ;; esac
    IFS='|' read -r entry_path entry_pattern entry_reason <<< "$entry"
    case "${entry_pattern:-}" in
      caminho-de-usuario | caminho-de-rede | registro-privado | ip-privado) ;;
      termo-extra*) die "o termo extra não tem exceção (leak-guard.allow): $entry" ;;
      *) die "exceção com padrão desconhecido em leak-guard.allow: $entry (use caminho-de-usuario, caminho-de-rede, registro-privado ou ip-privado)" ;;
    esac
    if [ -z "${entry_path:-}" ] || [ -z "${entry_reason//[[:space:]]/}" ]; then
      die "exceção sem arquivo ou sem justificativa em leak-guard.allow: $entry"
    fi
  done < "$allow"
else
  allow=
fi

cd "$(git rev-parse --show-toplevel)"

# Lock files não são lidos por pessoas e carregam endereços de registro do ambiente de quem os gerou.
excludes=(':(exclude,glob)**/pnpm-lock.yaml' ':(exclude,glob)**/package-lock.json' ':(exclude,glob)**/yarn.lock' ':(exclude,glob)**/packages.lock.json' ':(exclude,glob)**/*.lock')

# O formato das marcas de mensagem, quem escreveu e o fim da mensagem, que o awk lê.
message_format='@@COMMIT %H%n@@PERSON %an <%ae>%n@@PERSON %cn <%ce>%n%B%n@@MSGEND'

run_awk() {
  awk -v mode="$1" -v show="$show" -v allow="$allow" -f "$here/leak-guard.awk"
}

findings=
if [ "$mode" = tree ] && [ -z "$range" ]; then
  # Os nomes de todos os arquivos versionados.
  names=$(git -c core.quotepath=off ls-files | run_awk names)

  # O conteúdo: `-I` pula os binários; `--name-only -e ''` lista cada arquivo de texto uma vez (o git grep sai com 1 quando não lista
  # nada). O "./" na frente impede que um arquivo com "=" no nome (x=1.md) seja lido pelo awk como atribuição de variável.
  list=$(mktemp)
  trap 'rm -f "$list"' EXIT
  git -c core.quotepath=off grep -I -z --name-only -e '' -- . "${excludes[@]}" > "$list" || true
  content=$(sed -z 's|^|./|' "$list" | xargs -0 --no-run-if-empty awk -v mode=tree -v show="$show" -v allow="$allow" -f "$here/leak-guard.awk")

  # As mensagens dos commits que o envio trouxe (o push que disparou a pipeline). A base zerada é a de um ramo novo, e a que não
  # está no clone é a de um envio forçado (a reescrita do histórico): nesses casos não há "o que o envio trouxe" a ler.
  if [ -n "$push_range" ]; then
    base=${push_range%%..*}
    if [[ "$base" =~ ^0+$ ]]; then
      echo "leak-guard: o envio criou um ramo novo (commit de partida zerado): só a árvore é conferida."
    elif ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
      ci_warning "Mensagens não conferidas" "o commit de partida do envio não está no clone (um envio forçado?): as mensagens dos commits deste envio não foram conferidas, só a árvore."
    else
      range=$push_range
    fi
  fi
  findings=$(printf '%s\n%s\n' "$names" "$content" | sed '/^$/d')
fi

if [ -n "$range" ]; then
  git rev-parse --verify --quiet "${range%%..*}^{commit}" > /dev/null || die "o commit de partida do intervalo $range não está neste clone: o job precisa do histórico inteiro (fetch-depth: 0)."
  messages=$(git log "$range" --format="$message_format" | run_awk history)
  findings=$(printf '%s\n%s\n' "$findings" "$messages" | sed '/^$/d')
fi

if [ "$mode" = history ]; then
  # Os nomes de todos os arquivos que algum commit já teve (o modo árvore só vê os de agora).
  names=$(git -c core.quotepath=off log --all --name-only --format= | sort -u | run_awk names)

  # Quatro leituras: as mensagens e quem escreveu (sem caminho, para não perder o commit que só mexeu em lock file), as linhas
  # acrescentadas por cada commit, e as tags (a mensagem só existe nas anotadas).
  findings=$(
    {
      git log --all --format="$message_format"
      git -c core.quotepath=off log --all --no-merges -p -U0 --no-color --format='@@COMMIT %H%n@@MSGEND' -- . "${excludes[@]}"
      git for-each-ref refs/tags --format='@@TAG %(objecttype) %(refname:short)%0a@@PERSON %(taggername) %(taggeremail)%0a%(contents)%0a@@TAGEND'
    } | run_awk history
  )
  findings=$(printf '%s\n%s\n' "$names" "$findings" | sed '/^$/d')
fi

if [ -n "$findings" ]; then
  printf '%s\n' "$findings"
  count=$(printf '%s\n' "$findings" | wc -l | tr -d ' ')
  if [ "$visibility" = private ]; then
    ci_warning "Vazamento na árvore" "o leak-guard achou $count achado(s) (a lista está no log deste passo, com arquivo, linha e padrão). O repositório é PRIVADO, e por isso o achado não segura os pacotes; no repositório público ele reprova e nenhum pacote sai. A limpeza é a da Tarefa 19 (RN-ABERTO-009)."
    exit 0
  fi
  echo "leak-guard: $count achado(s). Corrija o arquivo ou, se for legítimo, registre a exceção (um padrão genérico em um arquivo), com justificativa, em leak-guard.allow." >&2
  ci_summary "**O leak-guard reprovou:** $count achado(s) (a lista está no log deste passo)."
  exit 1
fi
echo "leak-guard: nada encontrado ($mode)."
