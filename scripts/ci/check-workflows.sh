#!/usr/bin/env bash
# As REGRAS DO PROJETO para os arquivos da pipeline (RN-ABERTO-005 e 007, RN-GITHUB-002), conferidas sem depender do GitHub: lê
# cada workflow de .github/workflows/ e cada action composta de .github/actions/ (o YAML vira JSON pelo Ruby, que o runner Linux
# do GitHub tem) e reprova, com o arquivo e a regra, quando:
#  - um workflow tem um gatilho que não é `push` (só o de entrada, só nos ramos develop e main, sem tags nem filtro de caminho) ou
#    `workflow_call` (os reutilizáveis). Nenhum pull_request*, workflow_run, schedule, workflow_dispatch nem outro;
#  - um `uses:` não é local (um workflow reutilizável ou uma action composta deste repositório, que existe) nem uma action de
#    `actions/*` ou `github/*` fixada pelo SHA de 40 caracteres com o comentário da versão; o workflow chamado não tem
#    `workflow_call`;
#  - um workflow não começa com `permissions: {}`; um job pede escrita fora do que o projeto aceita (só `contents: write` no job de
#    lançamento, `security-events: write` no do CodeQL, e `pages: write` com `id-token: write` no que publica as páginas, com os
#    jobs que os chamam); `read-all`/`write-all`; um job que chama um workflow reutilizável não diz as permissões dele;
#  - um segredo aparece fora do passo do leak-guard (e do job que o repassa a ele), ou há `secrets: inherit`;
#  - um passo `run:` não é UMA chamada a um roteiro de scripts/ci/ que existe, ou tem uma expressão `${{ }}` (o valor de fora
#    entra por variável de ambiente, nunca colado no comando);
#  - um job sem `timeout-minutes`, com runner que não é um dos rótulos fixos escolhidos, com contêiner sem digest, ou um checkout
#    sem `persist-credentials: false`; a concorrência do workflow de entrada cancela o que está rodando;
#  - uma expressão usa `always()` (em qualquer `if`, de job ou de passo, de workflow ou de action composta): ele roda o job até numa
#    execução cancelada, e o lançamento, que roda mesmo com um pacote em falha, usa `!cancelled()` com os resultados conferidos à mão;
#  - um job num runner de macOS não tem `if: github.ref_name == 'main'`: o macOS só é empacotado na estável (decisão do dono,
#    2026-10-20), porque o minuto de macOS é o mais caro e um beta sai com Windows e Linux;
#  - a lista de jobs não bate com a tabela de docs/ci.md (entre as marcas `tabela-de-jobs`).
# O actionlint (actionlint.sh) confere o resto: que o GitHub entende o arquivo.
#
# Uso: bash scripts/ci/check-workflows.sh [raiz]       (sem argumento, o repositório; os testes passam uma cópia sabotada)
# Precisa de bash, ruby (só a biblioteca padrão), jq, grep e sed.
set -euo pipefail

root=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
cd "$root"
command -v ruby > /dev/null || { echo "check-workflows: falta o ruby (o YAML é lido pela biblioteca padrão dele)." >&2; exit 2; }
command -v jq > /dev/null || { echo "check-workflows: falta o jq." >&2; exit 2; }

runners='["ubuntu-24.04", "windows-2025", "macos-15"]'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
problems=$tmp/problemas
: > "$problems"
problem() { printf '%s\n' "$1" >> "$problems"; }

# yaml_json <arquivo YAML> <arquivo JSON>. Sem âncoras nem tipos além dos básicos. O YAML 1.1 do Ruby lê a chave `on` como o
# booleano true: o JSON a traz como "true", e as consultas abaixo leem as duas.
yaml_json() {
  ruby -ryaml -rjson -e 'print JSON.generate(YAML.safe_load(File.read(ARGV[0]), aliases: false))' "$1" > "$2" 2> "$tmp/erro-yaml" || {
    problem "$1: não é um YAML que o projeto aceite: $(head -n 1 "$tmp/erro-yaml")"
    return 1
  }
}

workflows=()
for file in .github/workflows/*; do
  [ -f "$file" ] || continue
  case "$file" in
    *.yml) workflows+=("$file") ;;
    *) problem "$file: em .github/workflows/ só ficam workflows .yml." ;;
  esac
done
[ "${#workflows[@]}" -gt 0 ] || problem ".github/workflows/: nenhum workflow."
actions=()
for file in .github/actions/*/action.yml; do [ -f "$file" ] && actions+=("$file"); done

# --- os `uses:` pelo texto, para ver o comentário da versão ---
pinned='^(actions|github)/[A-Za-z0-9._-]+(/[A-Za-z0-9._/-]+)?@[0-9a-f]{40} # v[0-9]+(\.[0-9]+)*$'
for file in "${workflows[@]}" "${actions[@]}"; do
  while IFS= read -r line; do
    value=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*(-[[:space:]]*)?uses:[[:space:]]*//')
    case "$value" in
      ./.github/workflows/*)
        target=${value#./}
        [[ "$target" =~ ^\.github/workflows/[A-Za-z0-9._-]+\.yml$ ]] || { problem "$file: uses \"$value\" não é um workflow reutilizável deste diretório."; continue; }
        [ -f "$target" ] || { problem "$file: o workflow reutilizável $target não existe."; continue; }
        yaml_json "$target" "$tmp/chamado.json" || continue
        jq -e '(.on // .["true"]) | (type == "object" and has("workflow_call")) or (type == "string" and . == "workflow_call") or (type == "array" and index("workflow_call") != null)' "$tmp/chamado.json" > /dev/null \
          || problem "$file: o workflow $target é chamado e não tem o gatilho workflow_call."
        ;;
      ./.github/actions/*)
        target=${value#./}
        [[ "$target" =~ ^\.github/actions/[A-Za-z0-9._-]+$ ]] || { problem "$file: uses \"$value\" não é uma action composta de .github/actions/."; continue; }
        [ -f "$target/action.yml" ] || { problem "$file: a action composta $target não existe (falta $target/action.yml)."; continue; }
        ;;
      *)
        if [[ "$value" =~ ^(actions|github)/[A-Za-z0-9._-]+(/[A-Za-z0-9._/-]+)?@[0-9a-f]{40}$ ]]; then
          problem "$file: uses \"$value\" está sem o comentário da versão (# vX.Y.Z) no fim da linha."
        elif [[ ! "$value" =~ $pinned ]]; then
          problem "$file: uses \"$value\": só actions de actions/* ou github/*, fixadas pelo SHA de 40 caracteres, com o comentário da versão."
        fi
        ;;
    esac
  done < <(grep -E '^[[:space:]]*(-[[:space:]]*)?uses:' "$file" || true)
done

# --- as actions compostas ---
for file in "${actions[@]}"; do
  yaml_json "$file" "$tmp/action.json" || continue
  jq -e '.runs.using == "composite"' "$tmp/action.json" > /dev/null || problem "$file: a action não é composta (runs.using: composite)."
  jq -e '[.. | strings | select(test("always\\s*\\("; "i"))] | length == 0' "$tmp/action.json" > /dev/null || problem "$file: uma action composta não usa always(): ele roda o passo até numa execução cancelada."
  jq -r '.runs.steps // [] | to_entries[] | select(.value.run != null) | "\(.key)\t\(.value.run | gsub("\n"; "\\n"))"' "$tmp/action.json" > "$tmp/runs"
  while IFS=$'\t' read -r index command; do
    printf '%s\t%s\t%s\n' "$file" "passo $index" "$command"
  done < "$tmp/runs" >> "$tmp/todos-os-runs"
  jq -r '[.runs.steps // [] | .. | strings | select(test("secrets\\."))] | length' "$tmp/action.json" | grep -qx 0 || problem "$file: uma action composta não recebe segredo."
done

# --- os workflows ---
entry=
: > "$tmp/jobs"
for file in "${workflows[@]}"; do
  yaml_json "$file" "$tmp/w.json" || continue
  # O gatilho, em qualquer das três formas (texto, lista ou mapa), vira a lista de nomes.
  triggers=$(jq -r '(.on // .["true"]) | if type == "string" then [.] elif type == "array" then . elif type == "object" then keys else ["(nenhum)"] end | .[]' "$tmp/w.json")
  for trigger in $triggers; do
    case "$trigger" in
      push | workflow_call) ;;
      *) problem "$file: gatilho \"$trigger\": a pipeline só roda no merge (push em develop e main) e os reutilizáveis só por workflow_call." ;;
    esac
  done
  if printf '%s\n' "$triggers" | grep -qx push; then
    if [ -n "$entry" ]; then problem "$file: só o workflow de entrada ($entry) tem o gatilho push."; else entry=$file; fi
    printf '%s\n' "$triggers" | grep -qx workflow_call && problem "$file: o workflow de entrada não é reutilizável (push e workflow_call juntos)."
    jq -e '(.on // .["true"]).push | type == "object" and (keys == ["branches"]) and ((.branches | sort) == ["develop", "main"])' "$tmp/w.json" > /dev/null \
      || problem "$file: o push tem de ser só nos ramos develop e main, sem tags, sem branches-ignore e sem filtro de caminho."
    jq -e '.concurrency | type == "object" and .["cancel-in-progress"] == false' "$tmp/w.json" > /dev/null \
      || problem "$file: a concorrência do workflow de entrada tem de ter cancel-in-progress: false (um lançamento em curso nunca é cancelado)."
  fi

  jq -e 'has("permissions") and .permissions == {}' "$tmp/w.json" > /dev/null || problem "$file: o topo do workflow tem de ser permissions: {} (o token começa sem permissão)."

  # `always()` roda o job até numa execução cancelada. O lançamento usa `!cancelled()` e os resultados dos `needs` conferidos à mão.
  jq -e '[.. | strings | select(test("always\\s*\\("; "i"))] | length == 0' "$tmp/w.json" > /dev/null || problem "$file: o workflow usa always(): ele roda o job até numa execução cancelada; o lançamento usa !cancelled() com os resultados dos needs conferidos à mão."
  # O macOS só é empacotado na estável (main): o `if` do job pelo ramo, e não um passo que pula por dentro.
  jq -r '.jobs // {} | to_entries[] | select((.value["runs-on"] | type) == "string" and (.value["runs-on"] | startswith("macos-"))) | select((.value["if"] // "") | gsub("^\\$\\{\\{ *| *\\}\\}$"; "") != "github.ref_name == '"'"'main'"'"'") | .key' "$tmp/w.json" \
    | while IFS= read -r job; do problem "$file: o job $job roda num runner de macOS e não tem if: github.ref_name == 'main': o macOS só é empacotado na estável (decisão do dono, 2026-10-20; o minuto de macOS é o mais caro), e um beta sai com Windows e Linux."; done

  name=$(basename "$file")
  jq -r '.jobs // {} | keys[]' "$tmp/w.json" | while IFS= read -r job; do printf '%s\t%s\n' "$name" "$job"; done >> "$tmp/jobs"

  # As permissões de cada job: escrita só onde o projeto aceita.
  jq -r --arg name "$name" '
    .jobs // {} | to_entries[] | .key as $job | .value as $j |
    if ($j.permissions | type) == "string" then "\($job)\t*\t\($j.permissions)"
    elif ($j.permissions | type) == "object" then ($j.permissions | to_entries[] | "\($job)\t\(.key)\t\(.value)")
    else empty end' "$tmp/w.json" > "$tmp/perms"
  while IFS=$'\t' read -r job scope level; do
    [ -n "$job" ] || continue
    case "$scope:$level" in
      *:read | *:none) ;;
      contents:write) [ "$name:$job" = lancar.yml:publicar ] || [ "$name:$job" = pipeline.yml:lancar ] || problem "$file: o job $job pede contents: write; escrita só no job de lançamento." ;;
      security-events:write) [ "$name:$job" = seguranca.yml:codeql ] || [ "$name:$job" = pipeline.yml:seguranca ] || problem "$file: o job $job pede security-events: write; essa escrita só no job do CodeQL." ;;
      pages:write) [ "$name:$job" = paginas.yml:publicar ] || [ "$name:$job" = pipeline.yml:paginas ] || problem "$file: o job $job pede pages: write; essa escrita só no job que publica as páginas." ;;
      id-token:write) [ "$name:$job" = paginas.yml:publicar ] || [ "$name:$job" = pipeline.yml:paginas ] || problem "$file: o job $job pede id-token: write; essa escrita só no job que publica as páginas." ;;
      *) problem "$file: o job $job pede \"$scope: $level\": escrita só no job de lançamento (contents), no do CodeQL (security-events) e no que publica as páginas (pages e id-token), e nunca read-all ou write-all." ;;
    esac
  done < "$tmp/perms"

  # Cada job: o que chama um reutilizável diz as permissões; o que roda passos tem runner fixo, tempo máximo e contêiner por digest.
  jq -r --argjson runners "$runners" '
    .jobs // {} | to_entries[] | .key as $job | .value as $j |
    if $j.uses != null then
      (if ($j | has("permissions")) | not then "\($job): o job chama um workflow reutilizável e não diz as permissions dele (sem elas, o chamado recebe as padrão do token)." else empty end),
      (if $j.secrets == "inherit" then "\($job): secrets: inherit passaria todos os segredos; o segredo vai pelo nome, e só ao job que o usa." else empty end)
    else
      (if ($j["runs-on"] | type) != "string" or ($runners | index($j["runs-on"])) == null then "\($job): runs-on \($j["runs-on"] | tojson) não é um dos rótulos fixos escolhidos (\($runners | join(", ")))." else empty end),
      (if $j["timeout-minutes"] == null then "\($job): falta timeout-minutes." else empty end),
      (if $j.container != null and (($j.container | if type == "string" then . else .image end) | test("@sha256:[0-9a-f]{64}$") | not) then "\($job): o contêiner do job tem de ser fixado por digest (@sha256:…)." else empty end),
      ($j.steps // [] | to_entries[] | .key as $i | .value |
        select(.uses != null and (.uses | startswith("actions/checkout@"))) |
        select(.with["persist-credentials"] != false) |
        "\($job): o checkout do passo \($i) não tem persist-credentials: false (o token ficaria gravado no .git do runner).")
    end' "$tmp/w.json" | while IFS= read -r message; do problem "$file: $message"; done

  # Os passos `run:`, para as regras de baixo.
  jq -r '.jobs // {} | to_entries[] | .key as $job | (.value.steps // []) | to_entries[] | select(.value.run != null) | "\($job) passo \(.key)\t\(.value.run | gsub("\n"; "\\n"))"' "$tmp/w.json" \
    | while IFS=$'\t' read -r where command; do printf '%s\t%s\t%s\n' "$file" "$where" "$command"; done >> "$tmp/todos-os-runs"

  # Os segredos: só o do leak-guard, só no passo dele e no job que o repassa.
  jq -r --arg name "$name" '
    paths(strings) as $p | select(getpath($p) | test("secrets\\.")) | ($p | map(tostring) | join(".")) as $where |
    if ($name == "seguranca.yml" and ($where | test("^jobs\\.leak-guard\\.steps\\.[0-9]+\\.env\\.LEAK_GUARD_EXTRA$")) and getpath($p) == "${{ secrets.LEAK_GUARD_EXTRA }}")
      or ($name == "pipeline.yml" and $where == "jobs.seguranca.secrets.LEAK_GUARD_EXTRA" and getpath($p) == "${{ secrets.LEAK_GUARD_EXTRA }}")
    then empty else "o segredo aparece em \($where): o único segredo (LEAK_GUARD_EXTRA) só chega ao passo do leak-guard." end' "$tmp/w.json" \
    | while IFS= read -r message; do problem "$file: $message"; done
done
[ -n "$entry" ] || problem ".github/workflows/: nenhum workflow de entrada (com o gatilho push)."

# --- os passos `run:`: uma chamada a um roteiro que existe, sem expressão dentro ---
if [ -f "$tmp/todos-os-runs" ]; then
  while IFS=$'\t' read -r file where command; do
    [ -n "$file" ] || continue
    if [[ "$command" == *'${{'* ]]; then
      problem "$file ($where): o run tem uma expressão \${{ }}; o valor entra por variável de ambiente (env:), nunca colado no comando."
      continue
    fi
    # As quebras de linha chegam como "\n" (duas letras): um run de várias linhas não passa.
    if [[ ! "$command" =~ ^bash\ scripts/ci/[A-Za-z0-9._-]+\.sh(\ .*)?$ ]] || [[ "$command" == *'\n'* || "$command" == *[\;\&\|\`\<\>]* || "$command" == *'$('* ]]; then
      problem "$file ($where): o run tem de ser uma chamada a um roteiro de scripts/ci/ (bash scripts/ci/<roteiro>.sh …), e só ela."
      continue
    fi
    script=$(printf '%s' "$command" | sed -E 's/^bash (scripts\/ci\/[A-Za-z0-9._-]+\.sh).*/\1/')
    [ -f "$script" ] || problem "$file ($where): o roteiro $script não existe."
  done < "$tmp/todos-os-runs"
fi

# --- a tabela de docs/ci.md ---
if [ -f docs/ci.md ]; then
  sed -n '/<!-- tabela-de-jobs:inicio -->/,/<!-- tabela-de-jobs:fim -->/p' docs/ci.md \
    | sed -nE 's/^\| `([A-Za-z0-9._-]+\.yml)` \| `([A-Za-z0-9._-]+)` \|.*/\1\t\2/p' | sort > "$tmp/tabela"
  sort "$tmp/jobs" > "$tmp/jobs-ordenados"
  if [ ! -s "$tmp/tabela" ]; then
    problem "docs/ci.md: não achei a tabela de jobs entre <!-- tabela-de-jobs:inicio --> e <!-- tabela-de-jobs:fim -->."
  else
    comm -23 "$tmp/jobs-ordenados" "$tmp/tabela" | while IFS=$'\t' read -r f j; do problem "docs/ci.md: o job $j de $f não está na tabela de jobs."; done
    comm -13 "$tmp/jobs-ordenados" "$tmp/tabela" | while IFS=$'\t' read -r f j; do problem "docs/ci.md: a tabela de jobs cita $j de $f, que não existe."; done
  fi
else
  problem "docs/ci.md não existe."
fi

if [ -s "$problems" ]; then
  sed 's/^/check-workflows: /' "$problems" >&2
  echo "check-workflows: $(wc -l < "$problems" | tr -d ' ') problema(s)." >&2
  exit 1
fi
echo "check-workflows: os workflows seguem as regras (${#workflows[@]} workflows, ${#actions[@]} actions compostas, $(wc -l < "$tmp/jobs" | tr -d ' ') jobs)."
