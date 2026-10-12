# Motor do leak-guard.sh (RN-ABERTO-003). Lê linhas de texto e escreve uma linha por achado:
#   <onde>: [<padrão>]            ou, com show=1,  <onde>: [<padrão>] <texto da linha>
# Variáveis (-v): mode (tree, names ou history), show (0 ou 1), allow (arquivo de exceções; vazio no modo history).
# Ambiente: LEAK_GUARD_EXTRA, um termo por linha.
#
# Só usa o que o awk POSIX tem (nada de gensub, IGNORECASE nem \< \>): roda no mawk da imagem do .NET e no gawk do Git Bash.
#
# Modo tree: os arquivos vêm como argumento, com "./" na frente (o nome do arquivo é o "onde").
# Modo names: cada linha da entrada é o nome de um arquivo versionado; o nome também é inspecionado.
# Modo history: a saída de `git log` e de `git for-each-ref` com as marcas "@@COMMIT <sha>", "@@PERSON <autor>", "@@MSGEND",
# "@@TAG <tipo> <nome>" e "@@TAGEND", seguida do diff (-U0): só as linhas acrescentadas (+) de cada commit entram, que é o que
# cada commit trouxe de novo. Nome e e-mail de quem escreveu (autor, committer e quem criou a tag) só são comparados com os termos
# extras.

BEGIN {
  # Exceções: "arquivo|padrão|justificativa" (o leak-guard.sh já recusou o que não tem esse formato). Valem para um padrão
  # genérico em um arquivo; o termo extra nunca tem exceção.
  while (allow != "" && (getline entry < allow) > 0) {
    sub(/\r$/, "", entry)
    if (entry ~ /^[ \t]*(#|$)/) continue
    nallow++
    split(entry, part, "|")
    allow_path[nallow] = part[1]
    allow_pattern[nallow] = part[2]
  }

  # Termos próprios de quem publica (variável de CI): palavra inteira, sem diferenciar maiúsculas nem acentos.
  count = split(ENVIRON["LEAK_GUARD_EXTRA"], raw, "\n")
  for (i = 1; i <= count; i++) {
    term = raw[i]
    sub(/\r$/, "", term)
    gsub(/^[ \t]+|[ \t]+$/, "", term)
    if (term == "" || term ~ /^#/) continue
    nterm++
    extra[nterm] = fold(term)
    extra_index[nterm] = i
  }
}

# --- onde estamos ---

mode == "tree" {
  path = FILENAME
  sub(/^\.\//, "", path)
  lineno = FNR
  inspect($0)
  next
}

mode == "names" { path = $0; lineno = 0; inspect($0); next }

mode == "history" && /^@@COMMIT / { commit = $2; state = "message"; lineno = 0; path = "(mensagem)"; next }
mode == "history" && /^@@TAG / {
  commit = ""
  if ($2 == "tag") { state = "tag"; path = "(mensagem da tag " $3 ")"; lineno = 0 } else state = "skip"
  next
}
mode == "history" && $0 == "@@TAGEND" { state = "skip"; next }
mode == "history" && $0 == "@@MSGEND" { state = "diff"; next }
mode == "history" && /^@@PERSON / {
  if (state == "skip") next
  saved_path = path
  saved_lineno = lineno
  path = (state == "tag") ? "(quem criou a tag)" : "(autor ou committer)"
  lineno = 0
  for (n = 1; n <= nterm; n++) check_term(substr($0, 10), n)
  path = saved_path
  lineno = saved_lineno
  next
}
mode == "history" && state == "skip" { next }
mode == "history" && (state == "message" || state == "tag") { lineno++; inspect($0); next }
mode == "history" && /^\+\+\+ / {
  if ($0 != "+++ /dev/null") { path = substr($0, 5); sub(/^b\//, "", path); sub(/\t.*$/, "", path) }
  next
}
mode == "history" && /^@@ -/ {
  hunk = $0
  sub(/^@@ -[0-9]+(,[0-9]+)? \+/, "", hunk)
  sub(/[^0-9].*$/, "", hunk)
  lineno = hunk + 0
  next
}
mode == "history" && state == "diff" && /^\+/ { inspect(substr($0, 2)); lineno++; next }

# --- verificações ---

function inspect(line,    n) {
  check_user_paths(line)
  check_network_paths(line)
  check_registry(line)
  check_private_ips(line)
  check_private_ipv6(line)
  for (n = 1; n <= nterm; n++) check_term(line, n)
}

function report(id, line,    where, text) {
  if (is_allowed(id)) return
  if (mode == "history") where = (commit != "" ? "commit " substr(commit, 1, 12) " " : "") path ":" lineno
  else if (mode == "names") where = path " (nome do arquivo)"
  else where = path ":" lineno
  if (show) {
    text = line
    sub(/^[ \t]+/, "", text)
    if (length(text) > 200) text = substr(text, 1, 200) "..."
    print where ": [" id "] " text
  } else {
    print where ": [" id "]"
  }
}

# A exceção é de um arquivo e de um padrão genérico, e nunca cobre o termo extra nem o que não é arquivo (mensagem de commit, quem
# escreveu, mensagem de tag: o "arquivo" deles começa com parêntese).
function is_allowed(id,    i) {
  if (id ~ /^termo-extra/ || path ~ /^\(/) return 0
  for (i = 1; i <= nallow; i++) if (allow_path[i] == path && allow_pattern[i] == id) return 1
  return 0
}

# Minúsculas e sem acento: "AÇÃO" e "ação" viram "acao", e o "sério" de um termo "rio" fica "serio" (a fronteira de palavra é
# de letra ASCII). Só as linhas com byte fora do ASCII pagam o custo.
function fold(s) {
  # As letras acentuadas saem antes do tolower: num awk de locale de um byte só (o gawk do Git Bash no Windows), o tolower
  # estraga o primeiro byte de uma letra UTF-8 maiúscula e a troca deixaria de casar.
  if (s ~ /[^\001-\177]/) {
    gsub(/(à|á|â|ã|ä|å|À|Á|Â|Ã|Ä|Å)/, "a", s)
    gsub(/(ç|Ç)/, "c", s)
    gsub(/(è|é|ê|ë|È|É|Ê|Ë)/, "e", s)
    gsub(/(ì|í|î|ï|Ì|Í|Î|Ï)/, "i", s)
    gsub(/(ñ|Ñ)/, "n", s)
    gsub(/(ò|ó|ô|õ|ö|Ò|Ó|Ô|Õ|Ö)/, "o", s)
    gsub(/(ù|ú|û|ü|Ù|Ú|Û|Ü)/, "u", s)
    gsub(/(ý|ÿ|Ý)/, "y", s)
  }
  return tolower(s)
}

# Nomes que não identificam ninguém: um marcador (<nome>, $USER, %USERNAME%, {user}) ou uma palavra genérica reservada.
function is_generic(name,    lower) {
  if (name ~ /^[<$%{]/) return 1
  lower = tolower(name)
  return lower ~ /^(usuario|user|username|nome|seu-usuario|exemplo|example|public|default)$/
}

# Caminho de perfil de usuário: C:\Users\<nome> (também com / e com \\ de JSON), /c/Users/<nome> (Git Bash), /mnt/c/Users/<nome>
# (WSL), /cygdrive/c/Users/<nome>, /home/<nome> e /Users/<nome>. Depois da raiz pode vir qualquer coisa que não seja letra,
# dígito, _, . ou -: "PATH=…:/home/<nome>", "host:/home/<nome>" e "file:///home/<nome>" também casam.
function check_user_paths(line,    rest, lower, name, found, pos, start, text, lead, before) {
  rest = line
  gsub(/\\/, "/", rest)
  lower = tolower(rest)
  while (match(lower, /[a-z]:\/+users\/+[^\/ \t"'`]+/)) {
    name = substr(rest, RSTART, RLENGTH)
    sub(/^[A-Za-z]:\/+[Uu][Ss][Ee][Rr][Ss]\/+/, "", name)
    sub(/[.,;:)]+$/, "", name)
    if (!is_generic(name)) found = 1
    rest = substr(rest, RSTART + RLENGTH)
    lower = substr(lower, RSTART + RLENGTH)
  }

  rest = line
  lower = tolower(rest)
  while (match(lower, /(^|[^a-z0-9_.-])\/(mnt\/|cygdrive\/)?[a-z]\/users\/+[^\/ \t"'`]+/)) {
    name = substr(rest, RSTART, RLENGTH)
    sub(/^.*\/[Uu][Ss][Ee][Rr][Ss]\/+/, "", name)
    sub(/[.,;:)]+$/, "", name)
    if (!is_generic(name)) found = 1
    rest = substr(rest, RSTART + RLENGTH)
    lower = substr(lower, RSTART + RLENGTH)
  }

  # /home/<nome>, /var/home/<nome> (distribuições imutáveis) e /Users/<nome>. Uma rota HTTP não é perfil de usuário: o que vem
  # logo depois de um verbo (GET /Users/42, POST /home/dashboard) não conta, nem o que vem colado ao caractere de reticências
  # (https://…/Users/lista: o endereço foi abreviado, a barra não abre um caminho). "~usuario" fica de fora de propósito: dá
  # falso positivo demais.
  pos = 1
  while (pos <= length(line) && match(substr(line, pos), /(^|[^A-Za-z0-9_.-])\/((var\/)?home|Users)\/+[^\/ \t"'`]+/)) {
    start = pos + RSTART - 1
    text = substr(line, start, RLENGTH)
    pos = start + RLENGTH
    lead = substr(text, 1, 1)
    before = substr(line, 1, start - 1) (lead != "/" ? lead : "")
    name = text
    sub(/^.*\/((var\/)?home|Users)\/+/, "", name)
    sub(/[.,;:)]+$/, "", name)
    if (is_generic(name)) continue
    if (before ~ /(^|[^A-Za-z])(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)[ \t]+$/) continue
    if (before ~ /…$/) continue
    found = 1
  }

  if (found) report("caminho-de-usuario", line)
}

# Caminho de rede (UNC): duas barras invertidas, o nome do servidor, outra barra invertida e o compartilhamento (também com as
# barras dobradas de um texto JSON). Só conta quando começa depois de espaço, aspas, crase, = ( [ < > , ; : { ou |, e quando o
# servidor e o compartilhamento têm dois caracteres ou mais: "\\d\\d" e '\\n\\n' em código não são caminho. Também não contam
# "pasta\\arquivo\\outro" (a barra vem colada a uma palavra), \\.\pipe\… (pipe nomeado), \\?\…, as sequências \\uXXXX e \\xXX e
# o caminho de unidade em JSON (C:\\Windows\\System32: dois-pontos depois de uma letra só).
function check_network_paths(line,    rest, base, text, lead, before, name, host, share, found) {
  rest = line
  base = 0
  while (match(rest, /(^|[ \t"'`=(<>,;:{|[])\\\\+[A-Za-z0-9._-]+\\+[A-Za-z0-9$._-]+/)) {
    text = substr(rest, RSTART, RLENGTH)
    before = substr(line, 1, base + RSTART - 1)
    base += RSTART + RLENGTH - 1
    rest = substr(rest, RSTART + RLENGTH)
    lead = substr(text, 1, 1)
    if (lead == "\\") {
      if (before != "") continue
    } else {
      text = substr(text, 2)
      if (lead == ":" && before ~ /(^|[^A-Za-z0-9])[A-Za-z]$/) continue
    }
    name = text
    sub(/^\\+/, "", name)
    host = name
    sub(/\\.*$/, "", host)
    share = name
    sub(/^[^\\]*\\+/, "", share)
    if (length(host) < 2 || length(share) < 2 || host ~ /^\.+$/ || is_generic(host)) continue
    if (length(host) == 5 && host ~ /^[uU][0-9A-Fa-f]+$/) continue
    if (length(host) == 3 && host ~ /^[xX][0-9A-Fa-f]+$/) continue
    found = 1
  }
  if (found) report("caminho-de-rede", line)
}

# Endereço de API de registro privado de pacotes com o grupo ou o projeto pelo número: /api/v4/groups/<n>/... ou
# /api/v4/projects/<n>/... (é o formato do servidor de código de quem publica). Os marcadores não têm dígitos e não casam.
function check_registry(line) {
  if (tolower(line) ~ /\/api\/v4\/(projects|groups)\/[0-9]+/) report("registro-privado", line)
}

# IP de rede privada (10/8, 172.16/12 e 192.168/16). Não é endereço o que vem colado a mais um grupo de dígitos (versão com
# cinco partes), o que vem depois de "v" ou "V" (v10.1.2.3) nem o que vem depois da palavra "version" (Version=10.0.0.0,
# "version": "10.0.0.1"). Um "=" sozinho não basta: HOST=<número> é endereço.
function check_private_ips(line,    pos, tail, start, ip, octet, before, earlier, found) {
  pos = 1
  while (pos <= length(line) && match(substr(line, pos), /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/)) {
    start = pos + RSTART - 1
    ip = substr(line, start, RLENGTH)
    tail = substr(line, start + RLENGTH, 2)
    pos = start + RLENGTH
    before = (start > 1) ? substr(line, start - 1, 1) : ""
    earlier = (start > 2) ? substr(line, start - 2, 1) : ""
    if (before ~ /[0-9.]/ || tail ~ /^\.[0-9]/) continue
    if (before ~ /[vV]/ && earlier !~ /[A-Za-z0-9_]/) continue
    earlier = tolower(substr(line, 1, start - 1))
    sub(/[ \t"'=:>]+$/, "", earlier)
    if (earlier ~ /version$/) continue
    split(ip, octet, ".")
    if (octet[1] > 255 || octet[2] > 255 || octet[3] > 255 || octet[4] > 255) continue
    if (octet[1] == 10 || (octet[1] == 172 && octet[2] >= 16 && octet[2] <= 31) || (octet[1] == 192 && octet[2] == 168)) found = 1
  }
  if (found) report("ip-privado", line)
}

# Endereço IPv6 de rede privada (prefixos fc e fd) e link-local (fe80 a febf). Antes de procurar, o que é rótulo e não endereço sai
# da linha (strip_labels): uma palavra com letra fora de a-f (ou _) seguida de dois-pontos, como "chave:", "inet6:" ou o "0xfe80:"
# de código.
# O 2001:db8:: da documentação não casa.
function check_private_ipv6(line,    low) {
  if (index(line, ":") == 0) return
  low = strip_labels(tolower(line))
  if (low ~ /(^|[^0-9a-f:.])(f[cd][0-9a-f][0-9a-f]|fe[89ab][0-9a-f]):[0-9a-f:]+/) report("ip-privado", line)
}

# strip_labels <linha em minúsculas>: a linha sem os rótulos, cada um trocado por um espaço. Rótulo é a sequência de letras, dígitos e
# _ colada à esquerda de um dois-pontos que tem uma letra fora de a-f (ou _), com o dois-pontos: "chave:", "inet6:", "0xfe80:".
# Sem regex de propósito: a equivalente, [a-z0-9_]*[g-z_][a-z0-9_]*:, é ambígua e, numa linha longa de letras (um SVG com uma
# imagem em base64), levava minutos; aqui cada caractere é olhado uma vez por dois-pontos que o segue.
function strip_labels(low,    out, pos, head, i) {
  out = ""
  while ((pos = index(low, ":")) > 0) {
    head = substr(low, 1, pos - 1)
    i = pos - 1
    while (i > 0 && index("abcdefghijklmnopqrstuvwxyz0123456789_", substr(head, i, 1)) > 0) i--
    if (substr(head, i + 1) ~ /[g-z_]/) out = out substr(head, 1, i) " "
    else out = out head ":"
    low = substr(low, pos + 1)
  }
  return out low
}

# Termo de LEAK_GUARD_EXTRA: palavra inteira (a letra antes e a depois não pode ser letra, dígito nem _), sem diferenciar
# maiúsculas nem acentos. "ouro" não casa em "Ouroboros", "rio" não casa em "sério" e "ação" casa em "AÇÃO". O padrão no relatório
# é o número do termo, nunca o termo.
function check_term(line, n,    lower, offset, at, before, after, size) {
  lower = fold(line)
  size = length(extra[n])
  offset = 0
  while ((at = index(substr(lower, offset + 1), extra[n])) > 0) {
    at += offset
    before = (at > 1) ? substr(lower, at - 1, 1) : ""
    after = substr(lower, at + size, 1)
    if (before !~ /[a-z0-9_]/ && after !~ /[a-z0-9_]/) {
      report("termo-extra#" extra_index[n], line)
      return
    }
    offset = at
  }
}
