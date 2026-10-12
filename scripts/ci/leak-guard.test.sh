#!/usr/bin/env bash
# Testes do leak-guard.sh: cada caso monta um repositório descartável com um arquivo (ou um commit) e confere o código de
# saída e o que o script escreve. Rode com `bash scripts/ci/leak-guard.test.sh`; sai com 1 se algum caso falhar.
#
# O que o leak-guard procura é montado por funções em pedaços (o "Users" separado da barra, os quatro números do IP separados),
# para este arquivo não ser ele mesmo um achado: o leak-guard.allow não precisa de exceção para ele.
set -uo pipefail

guard=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/leak-guard.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Identidade só para os commits dos repositórios descartáveis (não há configuração global nem e-mail de verdade aqui).
export GIT_AUTHOR_NAME=teste GIT_AUTHOR_EMAIL=nobody GIT_COMMITTER_NAME=teste GIT_COMMITTER_EMAIL=nobody
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

total=0
failures=0
out=
code=0

# --- o que o leak-guard procura, em pedaços ---
win() { printf 'C:\\%s\\%s\\x' Users "$1"; }
winjson() { printf '"C:\\\\%s\\\\%s\\\\y"' Users "$1"; }
winslash() { printf 'c:/%s/%s/x' users "$1"; }
unixhome() { printf '/%s/%s/x' home "$1"; }
unixusers() { printf '/%s/%s/x' Users "$1"; }
gitbash() { printf '/c/%s/%s/x' Users "$1"; }
wsl() { printf '/mnt/c/%s/%s/x' Users "$1"; }
cygwin() { printf '/cygdrive/c/%s/%s/x' Users "$1"; }
ip() { printf '%s.%s.%s.%s' "$1" "$2" "$3" "$4"; }
registry() { printf 'https://git.exemplo.org/api/v4/%s/%s/-/packages/nuget/index.json' "$1" "$2"; }
varhome() { printf '/%s/%s/%s/x' var home "$1"; }
unc() { printf '\\\\%s\\%s' "$1" "$2"; }
v6() { printf '%s:%s:%s' "$1" "$2" "$3"; }

new_repo() {
  repo="$work/$1"
  rm -rf "$repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
}

commit_all() {
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "${1:-teste}"
}

# run <args do script...>: roda no repositório atual, sem LEAK_GUARD_EXTRA e sem as exceções do projeto.
run() {
  out=$(cd "$repo" && env -u LEAK_GUARD_EXTRA -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY LEAK_GUARD_ALLOW=/dev/null bash "$guard" "$@" 2>&1)
  code=$?
}

# run_with VAR=valor... -- <args>: o mesmo, com variáveis de ambiente.
run_with() {
  local vars=()
  while [ "$1" != -- ]; do vars+=("$1"); shift; done
  shift
  out=$(cd "$repo" && env -u LEAK_GUARD_EXTRA -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY LEAK_GUARD_ALLOW=/dev/null "${vars[@]}" bash "$guard" "$@" 2>&1)
  code=$?
}

# run_allow <arquivo de exceções> [args...]: o mesmo, com um arquivo de exceções.
run_allow() {
  local allow=$1
  shift
  out=$(cd "$repo" && env -u LEAK_GUARD_EXTRA -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY LEAK_GUARD_ALLOW="$allow" bash "$guard" "$@" 2>&1)
  code=$?
}

# expect <descrição> <código esperado> [trecho que a saída deve ter] [trecho que ela não pode ter]
expect() {
  local description=$1 want=$2 has=${3:-} lacks=${4:-} problem=
  total=$((total + 1))
  [ "$code" -eq "$want" ] || problem="saiu com $code, esperava $want"
  [ -z "$has" ] || [[ "$out" == *"$has"* ]] || problem="${problem:+$problem; }a saída não tem \"$has\""
  [ -z "$lacks" ] || [[ "$out" != *"$lacks"* ]] || problem="${problem:+$problem; }a saída tem \"$lacks\""
  if [ -z "$problem" ]; then
    echo "ok   $total - $description"
  else
    failures=$((failures + 1))
    echo "FALHA $total - $description: $problem"
    printf '%s\n' "$out" | sed 's/^/       | /'
  fi
}

# --- caminho de perfil de usuário ---

new_repo limpo
printf 'Nada a ver com o assunto.\n' > "$repo/a.md"
commit_all
run
expect "repositório limpo passa" 0 "nada encontrado"
expect "sem termos extras, a saída diz que só os padrões genéricos valem" 0 "nenhum termo extra"

new_repo windows
printf 'linha 1\nabra %s\n' "$(win fulano)" > "$repo/a.md"
commit_all
run
expect "caminho de perfil do Windows falha, com arquivo, linha e padrão, sem escrever o nome" 1 "a.md:2: [caminho-de-usuario]" "fulano"

new_repo windows-barra
printf '%s e %s\n' "$(winslash fulano)" "$(winjson beltrano)" > "$repo/a.json"
commit_all
run
expect "caminho do Windows com barra normal e com barra dupla de JSON falha" 1 "a.json:1: [caminho-de-usuario]"

new_repo unix
printf '# comando\ncp %s /tmp\n' "$(unixhome fulano)" > "$repo/a.sh"
commit_all
run
expect "caminho no diretório de usuários do Linux falha" 1 "a.sh:2: [caminho-de-usuario]"

new_repo mac
printf 'abra %s\n' "$(unixusers fulano)" > "$repo/a.md"
commit_all
run
expect "caminho no diretório de usuários do macOS falha" 1 "a.md:1: [caminho-de-usuario]"

# As formas do ambiente de quem desenvolve em Windows e as que vêm coladas a outro texto.
new_repo formas
{
  printf '%s\n' "$(gitbash fulano)"
  printf '%s\n' "$(wsl fulano)"
  printf '%s\n' "$(cygwin fulano)"
  printf 'PATH=/usr/bin:%s\n' "$(unixhome fulano)"
  printf 'scp servidor:%s .\n' "$(unixhome fulano)"
  printf 'file://%s\n' "$(unixhome fulano)"
} > "$repo/a.md"
commit_all
run
for linha in 1 2 3 4 5 6; do
  case $linha in
    1) nome="Git Bash (/c/…)" ;;
    2) nome="WSL (/mnt/c/…)" ;;
    3) nome="Cygwin (/cygdrive/c/…)" ;;
    4) nome="PATH=…:/…" ;;
    5) nome="scp host:/…" ;;
    6) nome="file:///…" ;;
  esac
  [[ "$out" == *"a.md:$linha: [caminho-de-usuario]"* ]] && code=1 || code=0
  expect "a forma $nome é achada" 1
done

new_repo genericos
{
  printf 'C:\\%s\\<nome>\\AppData\n' Users
  printf '/%s/<usuario>/x\n' home
  printf '/%s/user/y\n' home
  printf 'C:\\%s\\Public\\z\n' Users
  printf '/%s/$USER/w\n' Users
  printf 'C:\\%s\\%%USERNAME%%\\v\n' Users
  printf '/c/%s/<nome>/x\n' Users
} > "$repo/a.md"
commit_all
run
expect "marcadores e nomes genéricos passam" 0 "nada encontrado"

new_repo parecidos
printf 'GET /api/users/42\nhttps://exemplo.org/%s/lista\nsrc/%s/x.ts\n' Users home > "$repo/a.md"
commit_all
run
expect "rota /users/, URL com /Users/ e /home/ dentro de caminho relativo não são perfil de usuário" 0 "nada encontrado"

# --- registro privado de pacotes (o endereço de API com grupo ou projeto pelo número) ---

new_repo registro
printf 'source: %s\n' "$(registry groups 123)" > "$repo/n.config"
commit_all
run
expect "URL de registro de grupo pelo número falha" 1 "n.config:1: [registro-privado]"

new_repo registro-projeto
printf 'curl %s\n' "$(registry projects 45)" > "$repo/n.sh"
commit_all
run
expect "URL de registro de projeto pelo número falha" 1 "n.sh:1: [registro-privado]"

new_repo registro-variavel
printf '%s\n' '"${API_URL}/api/v4/projects/${PROJECT_ID}/packages/x"' '/api/v4/projects/<número>/packages' > "$repo/ci.md"
commit_all
run
expect "a URL montada com variáveis (sem número) passa" 0 "nada encontrado"

# --- IP de rede privada ---

new_repo ips
printf 'a %s\nb %s\nc %s\nd %s\ne (%s)\n' "$(ip 10 1 2 3)" "$(ip 172 16 5 4)" "$(ip 172 31 255 255)" "$(ip 192 168 0 9)" "$(ip 192 168 1 1)" > "$repo/a.md"
commit_all
run
expect "IP de 10/8, 172.16/12 e 192.168/16 falha, com a última linha listada" 1 "a.md:5: [ip-privado]"
count=$(printf '%s\n' "$out" | grep -c 'ip-privado')
total=$((total + 1))
if [ "$count" -eq 5 ]; then echo "ok   $total - as cinco linhas foram listadas"; else failures=$((failures + 1)); echo "FALHA $total - as cinco linhas deviam ser listadas, saíram $count"; fi

new_repo ips-publicos
printf 'a %s\nb %s\nc %s\nd %s.5\ne %s\nf versão %s.1\ng %s\n' "$(ip 8 8 8 8)" "$(ip 172 32 0 1)" "$(ip 192 0 2 10)" "$(ip 1 10 0 1)" "$(ip 10 0 0 256)" "$(ip 10 0 19041 0)" "$(ip 11 1 2 3)" > "$repo/a.md"
commit_all
run
expect "IP público, fora da faixa, inválido ou parte de número mais comprido passa" 0 "nada encontrado"

new_repo ips-versao
{
  printf 'Version=%s\n' "$(ip 10 0 0 0)"
  printf 'tag v%s\n' "$(ip 10 1 2 3)"
  printf '"version": "%s"\n' "$(ip 10 0 0 1)"
  printf '<AssemblyVersion>%s</AssemblyVersion>\n' "$(ip 192 168 1 0)"
} > "$repo/a.md"
commit_all
run
expect "número de versão (Version=, vN, \"version\": e <Version>) não é IP" 0 "nada encontrado"

new_repo ips-versao-xml
{
  printf '<Version>%s</Version>\n' "$(ip 10 0 0 1)"
  printf '<FileVersion>%s</FileVersion>\n' "$(ip 192 168 1 0)"
  printf 'v%s e V%s\n' "$(ip 10 1 2 3)" "$(ip 172 16 0 1)"
  printf 'dobrado %s.10\n' "$(ip 1 192 168 1)"
} > "$repo/a.md"
commit_all
run
expect "<Version>, <FileVersion>, vN e um endereço colado a mais um grupo de números não são IP" 0 "nada encontrado"

new_repo ips-chave
printf 'HOST=%s\nserver=%s\n' "$(ip 10 0 0 5)" "$(ip 192 168 1 1)" > "$repo/a.env.md"
commit_all
run
expect "um = sozinho não basta para passar: HOST=<ip> é endereço" 1 "a.env.md:2: [ip-privado]"

# --- rotas HTTP, /var/home, caminho de rede e IPv6 ---

new_repo rotas
{
  printf 'GET %s\n' "$(unixusers 42 | sed 's|/x$||')"
  printf 'POST %s\n' "$(unixhome dashboard | sed 's|/x$||')"
  printf 'cp %s /tmp\n' "$(unixhome fulano)"
} > "$repo/a.md"
commit_all
run
expect "o mesmo tipo de caminho num cp é perfil de usuário" 1 "a.md:3: [caminho-de-usuario]"
expect "rota logo depois de um verbo HTTP (GET /Users/42) não é perfil de usuário" 1 "" "a.md:1:"
expect "...nem POST /home/dashboard" 1 "" "a.md:2:"

new_repo var-home
printf 'abra %s\n' "$(varhome fulano)" > "$repo/a.md"
commit_all
run
expect "/var/home/<nome> falha" 1 "a.md:1: [caminho-de-usuario]"

new_repo rede
{
  printf 'abra %s\n' "$(unc servidor compartilhamento)"
  u=$(unc servidor compartilhamento)
  printf 'json "%s"\n' "${u//\\/\\\\}"
  printf 'pipe %s\n' "$(unc . pipe)"
  printf 'pasta\\\\arquivo\\\\outro\n'
  printf 'modelo %s\n' "$(unc '<servidor>' pasta)"
} > "$repo/a.md"
commit_all
run
expect "caminho de rede (UNC) falha" 1 "a.md:1: [caminho-de-rede]"
expect "...também com as barras dobradas de um JSON" 1 "a.md:2: [caminho-de-rede]"
expect "...mas o pipe nomeado não é caminho de rede" 1 "" "a.md:3:"
expect "...nem pasta\\arquivo com barras dobradas no meio da linha" 1 "" "a.md:4:"
expect "...nem o marcador <servidor>" 1 "" "a.md:5:"

new_repo rede-fronteiras
sq="'"
{
  printf 'a `%s`\n' "$(unc servidor compartilhamento)"
  printf 'b <Path>%s</Path>\n' "$(unc servidor compartilhamento)"
  printf 'c chave:%s\n' "$(unc servidor compartilhamento)"
  printf 'd [%s]\n' "$(unc servidor compartilhamento)"
  printf 'e x,%s\n' "$(unc servidor compartilhamento)"
  printf 'f %s\n' '"\\d\\d"'
  printf 'g %s%s%s\n' "$sq" '\\n\\n' "$sq"
  printf 'h %s\n' '"\\u00e9\\u00e8"'
  printf 'i %s\n' '"C:\\Windows\\System32"'
  printf 'j %s\n' "$(unc servidor x)"
  printf 'k %s\n' "$(unc srv01 dados)"
} > "$repo/a.md"
commit_all
run
expect "caminho de rede depois de crase falha" 1 "a.md:1: [caminho-de-rede]"
expect "...depois de > (<Path>...)" 1 "a.md:2: [caminho-de-rede]"
expect "...depois de chave:" 1 "a.md:3: [caminho-de-rede]"
expect "...depois de [" 1 "a.md:4: [caminho-de-rede]"
expect "...depois de vírgula" 1 "a.md:5: [caminho-de-rede]"
expect "\"\\\\d\\\\d\" em código não é caminho de rede" 1 "" "a.md:6:"
expect "...nem '\\\\n\\\\n'" 1 "" "a.md:7:"
expect "...nem a sequência \\\\u00e9\\\\u00e8" 1 "" "a.md:8:"
expect "...nem um caminho de unidade com barras dobradas (C:\\\\Windows\\\\System32)" 1 "" "a.md:9:"
expect "...nem compartilhamento de um caractere só" 1 "" "a.md:10:"
expect "...e um servidor de nome curto com compartilhamento comum falha" 1 "a.md:11: [caminho-de-rede]"

new_repo reticencias
{
  printf 'veja https://…/%s/lista\n' Users
  printf 'aspas “%s”\n' "$(unixhome fulano)"
} > "$repo/a.md"
commit_all
run
expect "https://…/Users/lista (endereço abreviado) não é perfil de usuário" 1 "" "a.md:1:"
expect "...mas aspas tipográficas coladas ao caminho não o escondem" 1 "a.md:2: [caminho-de-usuario]"

new_repo ipv6
{
  printf 'a %s\n' "$(v6 fd12 3456 789a)::1"
  printf 'b %s\n' "$(v6 fe80 '' '')1"
  printf 'c [%s]:8080\n' "$(v6 FE80 '' '')1"
  printf 'd %s::1\n' "$(v6 2001 db8 '')"
  printf 'e 0x%s: rotulo\n' fe80
  printf 'f inet6:%s::1\n' fd12
  printf 'g %sfd12::1\n' "$(v6 2001 db8 '')"
  printf 'h chave:%s::1\n' fe80
} > "$repo/a.md"
commit_all
run
expect "IPv6 de rede privada (fc) falha" 1 "a.md:1: [ip-privado]"
expect "IPv6 link-local falha" 1 "a.md:2: [ip-privado]"
expect "IPv6 link-local em maiúsculas e entre colchetes falha" 1 "a.md:3: [ip-privado]"
expect "o 2001:db8:: da documentação não é privado" 1 "" "a.md:4:"
expect "0xfe80: de código não é IPv6" 1 "" "a.md:5:"
expect "um rótulo antes do endereço (inet6:<endereço>) não o esconde" 1 "a.md:6: [ip-privado]"
expect "...um 2001:db8:<hextet fd..> no meio de um endereço de documentação não é privado" 1 "" "a.md:7:"
expect "...e chave:<link-local> também falha" 1 "a.md:8: [ip-privado]"

new_repo til
printf 'abra ~%s/x e ~%s\n' fulano beltrano > "$repo/a.md"
commit_all
run
expect "~usuario fica de fora de propósito (falso positivo demais)" 0 "nada encontrado"

# --- termos de LEAK_GUARD_EXTRA ---

new_repo termos
printf 'O projeto Ouro é interno.\nA serpente Ouroboros é outra palavra.\nso OURO_ aqui\nmeu-ouro-x\nAcme Corp aqui\n' > "$repo/a.md"
commit_all
run_with 'LEAK_GUARD_EXTRA=ouro
acme corp' --
expect "termo casa palavra inteira, sem diferenciar maiúsculas" 1 "a.md:1: [termo-extra#1]"
expect "o termo com espaço (segundo da lista) também casa" 1 "a.md:5: [termo-extra#2]"
expect "o hífen separa palavras: \"meu-ouro-x\" casa" 1 "a.md:4: [termo-extra#1]"
expect "\"Ouroboros\" não casa o termo curto" 1 "" "a.md:2:"
expect "o _ faz parte da palavra: \"OURO_\" não casa" 1 "" "a.md:3:"
expect "a saída nunca escreve o termo" 1 "" "Ouro"
expect "a saída diz quantos termos extras carregou" 1 "2 termo(s) extra(s) carregado(s)"

run_with 'LEAK_GUARD_EXTRA=ouro' -- -v
expect "com -v o texto da linha aparece" 1 "O projeto Ouro é interno."

new_repo termos-acento
printf 'um sério problema\nA AÇÃO foi tomada\nprefixo-ação-sufixo\n' > "$repo/a.md"
commit_all
run_with 'LEAK_GUARD_EXTRA=rio
ação' --
expect "o termo \"rio\" não casa em \"sério\" (letra acentuada é letra)" 1 "" "a.md:1:"
expect "o termo \"ação\" casa em \"AÇÃO\" (maiúscula acentuada)" 1 "a.md:2: [termo-extra#2]"
expect "o hífen continua separando palavras com acento" 1 "a.md:3: [termo-extra#2]"

new_repo termos-vazio
printf 'tudo certo\n' > "$repo/a.md"
commit_all
run_with $'LEAK_GUARD_EXTRA=\n\n  \r\n#comentario\r\n' --
expect "variável definida só com linhas em branco e comentários é erro de cadastro" 2 "não tem nenhum termo"
run_with LEAK_GUARD_EXTRA= --
expect "variável definida e vazia é erro de cadastro" 2 "erro de cadastro"
run
expect "variável ausente roda só com os padrões genéricos, e diz isso" 0 "nenhum termo extra"
run_with GITHUB_ACTIONS=true LEAK_GUARD_EXTRA= --
expect "no GitHub Actions a variável vazia é o segredo que não está cadastrado (um segredo ausente chega vazio): roda só com os padrões genéricos" 0 "o segredo LEAK_GUARD_EXTRA não está cadastrado"
expect "e o aviso fica à vista" 0 "::warning title=Sem os termos extras::"
printf '' > "$work/vazio.txt"
run_with "LEAK_GUARD_EXTRA=$work/vazio.txt" --
expect "arquivo de termos vazio, apontado pela variável, é erro de cadastro" 2 "erro de cadastro"
run_with $'LEAK_GUARD_EXTRA=ouro\n#comentario\n\n' --
expect "linhas em branco e comentários ao lado de um termo são ignorados" 0 "1 termo(s) extra(s)"

# Na própria máquina: LEAK_GUARD_EXTRA é o caminho de um arquivo com os termos, fora do repositório.
printf 'ouro\nacme corp\n' > "$work/termos.txt"
new_repo termos-arquivo
printf 'O projeto Ouro é interno.\nAcme Corp aqui\n' > "$repo/a.md"
commit_all
run_with "LEAK_GUARD_EXTRA=$work/termos.txt" --
expect "o valor pode ser o caminho de um arquivo com os termos (variável do tipo arquivo)" 1 "a.md:2: [termo-extra#2]"
run_with "LEAK_GUARD_EXTRA=$work/nao-existe.txt" --
expect "caminho indicado que não existe é erro, e não um termo estranho" 2 "esse arquivo não existe"
expect "a mensagem do erro não repete o valor" 2 "" "nao-existe"
run_with "LEAK_GUARD_EXTRA=../termos.txt" --
expect "caminho relativo que existe é arquivo" 1 "a.md:2: [termo-extra#2]"
run_with "LEAK_GUARD_EXTRA=../nao-existe/termos.txt" --
expect "caminho relativo que não existe é erro" 2 "esse arquivo não existe"
run_with 'LEAK_GUARD_EXTRA=C:\nao\existe\termos.txt' --
expect "caminho do Windows (com barra invertida) que não existe é erro" 2 "esse arquivo não existe"
run_with "LEAK_GUARD_EXTRA=$work/termos.txt
" --
expect "o caminho de um arquivo com um fim de linha depois também é arquivo" 1 "a.md:2: [termo-extra#2]"

# --- nomes de arquivo e arquivo com = no nome ---

new_repo nomes
printf 'nada\n' > "$repo/ouro-do-cliente.md"
mkdir -p "$repo/docs"
printf 'nada\n' > "$repo/docs/$(ip 10 1 2 3).txt"
printf 'abra %s\n' "$(win fulano)" > "$repo/x=1.md"
commit_all
run_with 'LEAK_GUARD_EXTRA=ouro' --
expect "o nome do arquivo também é inspecionado (termo extra)" 1 "ouro-do-cliente.md (nome do arquivo): [termo-extra#1]"
expect "o nome do arquivo também é inspecionado (IP)" 1 "docs/$(ip 10 1 2 3).txt (nome do arquivo): [ip-privado]"
expect "um arquivo com = no nome é lido (e não pulado como atribuição do awk)" 1 "x=1.md:1: [caminho-de-usuario]"

# --- exceções ---

new_repo excecao
mkdir -p "$repo/docs" "$repo/outra"
printf 'ex: %s\nbeltrano em %s\n' "$(win fulano)" "$(ip 10 1 2 3)" > "$repo/docs/a.md"
printf '%s\n' "$(win fulano)" > "$repo/outra/b.md"
commit_all
printf '%s\n' '# exceções do teste' 'docs/a.md|caminho-de-usuario|exemplo de caminho' > "$work/ok.allow"
run_allow "$work/ok.allow"
expect "a exceção cobre um padrão em um arquivo" 1 "docs/a.md:2: [ip-privado]" "docs/a.md:1:"
expect "a exceção de um arquivo não cobre outro" 1 "outra/b.md:1:"

printf '%s\n' 'docs/a.md|caminho-de-usuario|exemplo' 'docs/a.md|ip-privado|exemplo' 'outra/b.md|caminho-de-usuario|exemplo' > "$work/tudo.allow"
run_allow "$work/tudo.allow"
expect "as exceções de cada padrão e arquivo, juntas, cobrem tudo" 0 "nada encontrado"

run_allow "$work/tudo.allow" --history
expect "o modo history ignora o arquivo de exceções" 1 "[caminho-de-usuario]" "nada encontrado"
expect "o modo history diz que ignorou as exceções" 1 "ignora o arquivo de exceções"

printf '%s\n' 'docs/a.md|termo-extra#1|não pode' > "$work/termo.allow"
run_allow "$work/termo.allow"
expect "o termo extra não tem exceção" 2 "termo extra não tem exceção"

printf '%s\n' 'docs/a.md|inventado|nada' > "$work/padrao.allow"
run_allow "$work/padrao.allow"
expect "padrão desconhecido na exceção é erro de uso" 2 "padrão desconhecido"

printf '%s\n' 'docs/a.md|caminho-de-usuario|' > "$work/sem.allow"
run_allow "$work/sem.allow"
expect "exceção sem justificativa é erro de uso" 2 "sem arquivo ou sem justificativa"

printf '%s\n' 'docs/|caminho-de-usuario|pasta inteira' > "$work/pasta.allow"
run_allow "$work/pasta.allow"
expect "exceção de pasta ou de arquivo inteiro não existe mais: só vale o arquivo e o padrão exatos" 1 "docs/a.md:1: [caminho-de-usuario]"

# --- o que não se lê ---

new_repo binarios-e-locks
printf '%s\n\000binario' "$(win fulano)" > "$repo/dado.bin"
printf 'resolved: http://%s:4873/x\n' "$(ip 192 168 1 1)" > "$repo/pnpm-lock.yaml"
mkdir -p "$repo/src/api/x"
printf '"source": "%s"\n' "$(registry projects 9)" > "$repo/src/api/x/packages.lock.json"
commit_all
run
expect "binário e lock files não são lidos" 0 "nada encontrado"

# --- histórico: linhas, mensagens, quem escreveu e tags ---

new_repo historico
printf 'conteúdo com %s\n' "$(win fulano)" > "$repo/a.md"
commit_all "primeiro"
printf 'conteúdo limpo\n' > "$repo/a.md"
commit_all "segundo, com o termo ouro na mensagem"
run
expect "na árvore atual, o que já saiu do arquivo não conta" 0 "nada encontrado"
run --history
expect "no histórico, a linha acrescentada por um commit antigo falha" 1 "a.md:1: [caminho-de-usuario]"
run_with 'LEAK_GUARD_EXTRA=ouro' -- --history
expect "no histórico, a mensagem de commit também é lida" 1 "(mensagem):1: [termo-extra#1]"

new_repo historico-nomes
printf 'x\n' > "$repo/ouro-antigo.md"
commit_all "primeiro"
git -C "$repo" rm -q ouro-antigo.md
commit_all "segundo, apaga"
run_with 'LEAK_GUARD_EXTRA=ouro' --
expect "na árvore atual, o arquivo apagado não conta" 0 "nada encontrado"
run_with 'LEAK_GUARD_EXTRA=ouro' -- --history
expect "no histórico, o nome de um arquivo que algum commit já teve também é inspecionado" 1 "ouro-antigo.md (nome do arquivo): [termo-extra#1]"

new_repo excecao-mensagem
printf 'x
' > "$repo/a.md"
commit_all "base limpa"
printf 'y
' > "$repo/a.md"
commit_all "mensagem com $(ip 10 9 9 9)"
printf '%s
' '(mensagem)|ip-privado|tentativa de calar as mensagens' > "$work/msg.allow"
out=$(cd "$repo" && env -u LEAK_GUARD_EXTRA -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY LEAK_GUARD_ALLOW="$work/msg.allow" bash "$guard" --messages HEAD~1..HEAD 2>&1)
code=$?
expect "exceção não vale para mensagem de commit" 1 "(mensagem):1: [ip-privado]"

new_repo historico-limpo
printf 'tudo limpo\n' > "$repo/a.md"
commit_all "primeiro"
printf 'ainda limpo\n' > "$repo/a.md"
commit_all "segundo"
run --history
expect "histórico limpo passa" 0 "nada encontrado"

new_repo historico-pessoas
printf 'limpo\n' > "$repo/a.md"
git -C "$repo" add -A
GIT_AUTHOR_NAME="Ana Ouro" GIT_AUTHOR_EMAIL=ana@exemplo.invalid git -C "$repo" commit -q -m "um"
printf 'limpo 2\n' > "$repo/a.md"
git -C "$repo" add -A
GIT_COMMITTER_EMAIL=bia@ouro.exemplo.invalid git -C "$repo" commit -q -m "dois"
run_with 'LEAK_GUARD_EXTRA=ouro' -- --history
expect "no histórico, o nome do autor é comparado com os termos extras" 1 "(autor ou committer):0: [termo-extra#1]"
total=$((total + 1))
count=$(printf '%s\n' "$out" | grep -c 'autor ou committer')
if [ "$count" -eq 2 ]; then echo "ok   $total - o e-mail do committer também (dois achados)"; else failures=$((failures + 1)); echo "FALHA $total - esperava 2 achados de autor ou committer, saíram $count"; printf '%s\n' "$out" | sed 's/^/       | /'; fi
run --history
expect "sem termos extras, autor e committer não geram achado" 0 "nada encontrado"

new_repo historico-tags
printf 'limpo\n' > "$repo/a.md"
commit_all "um"
git -C "$repo" tag -a v1.0.0 -m "notas da versão com ouro dentro"
git -C "$repo" tag leve
git -C "$repo" tag -a v2.0.0 -m "abra $(win fulano)"
run_with 'LEAK_GUARD_EXTRA=ouro' -- --history
expect "no histórico, a mensagem de uma tag anotada é comparada com os termos extras" 1 "(mensagem da tag v1.0.0):1: [termo-extra#1]"
expect "no histórico, a mensagem de uma tag anotada é comparada com os padrões genéricos" 1 "(mensagem da tag v2.0.0):1: [caminho-de-usuario]"
total=$((total + 1))
count=$(printf '%s\n' "$out" | grep -c 'mensagem da tag')
if [ "$count" -eq 2 ]; then echo "ok   $total - a tag leve não é lida duas vezes"; else failures=$((failures + 1)); echo "FALHA $total - esperava 2 achados de tag, saíram $count"; fi

# --- uma linha longa (um SVG com uma imagem em base64) não pode travar a busca ---

new_repo linha-longa
# As letras de g a z no meio do base64 são o que fazia a regex antiga (`[a-z0-9_]*[g-z_][a-z0-9_]*:`) levar minutos.
{ printf '<image href="data:image/png;base64,'; for i in $(seq 1 1200); do printf 'Q2xhdWRlIG'; done; printf '" x="1"/>\n'; } > "$repo/logo.svg"
printf 'endereço %s numa linha com "data:" antes\n' "$(v6 fd00 12 3)" >> "$repo/logo.svg"
commit_all
# O tempo é o do motor (o awk), que é onde a regex antiga travava; o `timeout` o encerra de verdade se ele travar.
started=$(date +%s)
out=$(cd "$repo" && timeout 20 awk -v mode=tree -v show=0 -v allow= -f "$(dirname "$guard")/leak-guard.awk" ./logo.svg 2>&1); code=$?
elapsed=$(( $(date +%s) - started ))
total=$((total + 1))
if [ "$code" -eq 0 ] && [ "$elapsed" -le 10 ] && [[ "$out" == *"logo.svg:2: [ip-privado]"* ]]; then
  echo "ok   $total - uma linha de 12 mil letras com dois-pontos é lida em segundos (${elapsed} s), e o endereço da linha seguinte é achado"
else
  failures=$((failures + 1))
  echo "FALHA $total - a linha longa: saiu com $code em ${elapsed} s (a regex ambígua trava; 124 é o timeout)"
  printf '%s\n' "$out" | sed 's/^/       | /'
fi
run
expect "e o leak-guard inteiro acha o mesmo endereço" 1 "logo.svg:2: [ip-privado]"
printf 'chave:%s:fim\n' "$(v6 fe80 1 2)" > "$repo/b.md"
printf 'x0fe80::1 e inet6:%s\n' "$(v6 fd12 3 4)" >> "$repo/b.md"
commit_all
run
expect "o rótulo (palavra com letra fora de a-f) colado ao endereço continua tirado: 'chave:fe80…' acha o fe80 depois dele" 1 "b.md:1: [ip-privado]"
expect "e 'inet6:' antes de um fd12… também" 1 "b.md:2: [ip-privado]"

# --- mensagens de um intervalo, e as do envio que disparou a pipeline ---

new_repo mensagens
printf '1\n' > "$repo/a.md"; commit_all "base com $(ip 10 9 9 9)"
base=$(git -C "$repo" rev-parse HEAD)
printf '2\n' > "$repo/a.md"; commit_all "limpo"
printf '3\n' > "$repo/a.md"; commit_all "abra $(win fulano)"
head=$(git -C "$repo" rev-parse HEAD)
run --messages "$base..HEAD"
expect "--messages lê as mensagens do intervalo" 1 "[caminho-de-usuario]"
expect "--messages não lê a mensagem do commit de partida" 1 "" "[ip-privado]"
run --push-range "$base..$head"
expect "--push-range confere a árvore e também as mensagens dos commits que o envio trouxe" 1 "(mensagem):1: [caminho-de-usuario]"
run --push-range "0000000000000000000000000000000000000000..$head"
expect "--push-range com o commit de partida zerado (ramo novo): só a árvore, e diz isso" 0 "ramo novo"
run --push-range "0123456789abcdef0123456789abcdef01234567..$head"
expect "--push-range com o commit de partida fora do clone (envio forçado): só a árvore, com o aviso" 0 "AVISO (Mensagens não conferidas)"
run --push-range "$base"
expect "--push-range sem o formato BASE..PONTA é erro de uso" 2 "BASE..PONTA"
run --messages 0123456789abcdef0123456789abcdef01234567..HEAD
expect "--messages com o commit de partida ausente do clone é erro de uso, com a dica do histórico inteiro" 2 "histórico inteiro"

# --- a visibilidade do repositório decide se o achado reprova (RN-ABERTO-003) ---

new_repo visibilidade
printf 'abra %s\n' "$(win fulano)" > "$repo/a.md"
commit_all
run --visibility public
expect "repositório público: achado reprova (saída 1)" 1 "a.md:1: [caminho-de-usuario]"
run --visibility private
expect "repositório privado: o achado vira aviso e não reprova (saída 0)" 0 "a.md:1: [caminho-de-usuario]"
expect "e o aviso fica à vista" 0 "AVISO (Vazamento na árvore)"
summary=$work/resumo.md
: > "$summary"
run_with GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY="$summary" -- --visibility private
expect "no GitHub Actions, o aviso do repositório privado é uma anotação" 0 "::warning title=Vazamento na árvore::"
total=$((total + 1))
if grep -q 'público' "$summary" && grep -q '1 achado' "$summary"; then echo "ok   $total - e o resumo do job diz quantos achados e que no repositório público eles reprovam"; else failures=$((failures + 1)); echo "FALHA $total - resumo do aviso"; sed 's/^/       | /' "$summary"; fi
run --visibility qualquer
expect "visibilidade desconhecida é erro de uso (nada vira aviso por engano)" 2 "public ou private"
run --visibility private --history
expect "o --history não aceita --visibility (antes de publicar, achado sempre reprova)" 2 "Uso:"
new_repo visibilidade-limpa
printf 'tudo certo\n' > "$repo/a.md"
commit_all
run --visibility private
expect "repositório privado sem achado: saída 0, sem aviso" 0 "nada encontrado" "AVISO"

echo
echo "$((total - failures)) de $total casos passaram."
[ "$failures" -eq 0 ]
