#!/usr/bin/env bash
# Testes do check-workflows.sh: uma cópia dos workflows, das actions compostas, dos roteiros e do docs/ci.md de VERDADE numa pasta
# temporária, que passa; e, em cada caso, uma sabotagem dessa cópia, que tem de reprovar com a regra certa.
# Rode com `bash scripts/ci/check-workflows.test.sh`; sai com 1 se algum caso falhar.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

total=0
failures=0
out=
code=0

# fresh: a cópia de verdade.
fresh() {
  rm -rf "$work/tree"
  mkdir -p "$work/tree/docs" "$work/tree/scripts"
  cp -R "$root/.github" "$work/tree/.github"
  cp -R "$root/scripts/ci" "$work/tree/scripts/ci"
  cp "$root/docs/ci.md" "$work/tree/docs/ci.md"
}

run() {
  out=$(bash "$here/check-workflows.sh" "$work/tree" 2>&1)
  code=$?
}

expect() {
  local description=$1 want=$2 has=${3:-} problem=
  total=$((total + 1))
  [ "$code" -eq "$want" ] || problem="saiu com $code, esperava $want"
  [ -z "$has" ] || [[ "$out" == *"$has"* ]] || problem="${problem:+$problem; }a saída não tem \"$has\""
  if [ -z "$problem" ]; then
    echo "ok   $total - $description"
  else
    failures=$((failures + 1))
    echo "FALHA $total - $description: $problem"
    printf '%s\n' "$out" | sed 's/^/       | /'
  fi
}

# sabotage <descrição> <trecho esperado na saída> <arquivo relativo> <expressão do sed>: muda a cópia e confere que reprova.
sabotage() {
  local description=$1 has=$2 file=$3 expression=$4
  fresh
  sed -i.bak "$expression" "$work/tree/$file" && rm -f "$work/tree/$file.bak"
  if cmp -s "$root/$file" "$work/tree/$file"; then
    total=$((total + 1)); failures=$((failures + 1)); echo "FALHA $total - $description: a sabotagem não mudou $file"
    return
  fi
  run
  expect "$description" 1 "$has"
}

# append <descrição> <trecho esperado> <arquivo relativo> <texto>: acrescenta o texto no fim do arquivo da cópia.
append() {
  local description=$1 has=$2 file=$3 text=$4
  fresh
  printf '%s\n' "$text" >> "$work/tree/$file"
  run
  expect "$description" 1 "$has"
}

fresh
run
expect "os workflows de verdade passam em todas as regras" 0 "os workflows seguem as regras"

# --- os gatilhos ---
sabotage "um pull_request no workflow de entrada reprova" "gatilho" .github/workflows/pipeline.yml 's/^  push:$/  pull_request:\n  push:/'
sabotage "pull_request_target reprova" "gatilho" .github/workflows/pipeline.yml 's/^  push:$/  pull_request_target:\n  push:/'
sabotage "workflow_run reprova" "gatilho" .github/workflows/pipeline.yml 's/^  push:$/  workflow_run:\n    workflows: [x]\n  push:/'
sabotage "schedule reprova" "gatilho" .github/workflows/pipeline.yml "s/^  push:\$/  schedule:\n    - cron: '0 0 * * *'\n  push:/"
sabotage "workflow_dispatch reprova" "gatilho" .github/workflows/pipeline.yml 's/^  push:$/  workflow_dispatch:\n  push:/'
sabotage "push num reutilizável reprova" "gatilho" .github/workflows/lancar.yml 's/^  workflow_call:$/  push:\n  workflow_call:/'
sabotage "push em outro ramo reprova" "develop e main" .github/workflows/pipeline.yml 's/^      - main$/      - main\n      - feat\/x/'
sabotage "push só na develop reprova" "develop e main" .github/workflows/pipeline.yml '/^      - main$/d'
sabotage "push com tags reprova" "develop e main" .github/workflows/pipeline.yml 's/^    branches:$/    tags: [v*]\n    branches:/'
sabotage "push com filtro de caminho reprova (um merge passaria sem pipeline)" "develop e main" .github/workflows/pipeline.yml 's/^    branches:$/    paths: [src\/**]\n    branches:/'
sabotage "o gatilho em forma de lista também é lido" "gatilho" .github/workflows/integrar.yml '/^on:$/{N;s/.*/on: [workflow_call, pull_request]/}'

# --- as actions ---
sabotage "action de fora do GitHub reprova" "uses" .github/workflows/verificar.yml '0,/uses: actions\/checkout@[0-9a-f]* # v7.0.1/s//uses: alguem\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1/'
sabotage "action do GitHub por tag (sem o SHA) reprova" "uses" .github/workflows/verificar.yml '0,/actions\/checkout@[0-9a-f]* # v7.0.1/s//actions\/checkout@v7 # v7/'
sabotage "action com SHA curto reprova" "uses" .github/workflows/verificar.yml '0,/actions\/checkout@3d3c42e5aac5/s//actions\/checkout@3d3c42e5/'
sabotage "action com SHA e sem o comentário da versão reprova" "comentário da versão" .github/workflows/verificar.yml '0,/ # v7.0.1$/s///'
sabotage "action de fora numa action composta reprova" "uses" .github/actions/preparar-node/action.yml 's/uses: actions\/setup-node@/uses: outro\/setup-node@/'
sabotage "imagem docker:// num passo reprova" "uses" .github/workflows/integrar.yml '0,/uses: actions\/checkout@[0-9a-f]* # v7.0.1/s//uses: docker:\/\/alpine:3 # v3/'
sabotage "workflow reutilizável de outro repositório reprova" "uses" .github/workflows/pipeline.yml 's/uses: .\/.github\/workflows\/integrar.yml/uses: Outro\/repo\/.github\/workflows\/integrar.yml@main/'
sabotage "workflow reutilizável que não existe reprova" "não existe" .github/workflows/pipeline.yml 's/integrar.yml/integrar-x.yml/'
sabotage "action composta que não existe reprova" "não existe" .github/workflows/verificar.yml '0,/preparar-node$/s//preparar-nada/'
sabotage "workflow chamado sem workflow_call reprova" "workflow_call" .github/workflows/integrar.yml 's/^  workflow_call:$/  workflow_call_x:/'

# --- o token ---
sabotage "workflow sem permissions: {} no topo reprova" "permissions: {}" .github/workflows/empacotar.yml 's/^permissions: {}$/permissions:\n  contents: read/'
sabotage "contents: write fora do job de lançamento reprova" "escrita" .github/workflows/empacotar.yml '0,/      contents: read/s//      contents: write/'
sabotage "write-all reprova" "escrita" .github/workflows/integrar.yml '/^      contents: read$/d;s/^    permissions:$/    permissions: write-all/'
sabotage "packages: write no job de lançamento reprova (só contents)" "escrita" .github/workflows/lancar.yml 's/^      contents: write$/      contents: write\n      packages: write/'
sabotage "security-events: write fora do CodeQL reprova" "escrita" .github/workflows/seguranca.yml '0,/      contents: read/s//      contents: read\n      security-events: write/'
sabotage "o job que chama um reutilizável sem permissions reprova" "permissions" .github/workflows/pipeline.yml '/^    uses: .\/.github\/workflows\/integrar.yml$/{n;N;d}'

# --- as páginas: pages: write e id-token: write só no job que publica o site (e no que o chama) ---
sabotage "pages: write num job que não publica as páginas reprova" "só no job que publica as páginas" .github/workflows/verificar.yml '0,/      contents: read/s//      contents: read\n      pages: write/'
sabotage "id-token: write num job que não publica as páginas reprova" "só no job que publica as páginas" .github/workflows/empacotar.yml '0,/      contents: read/s//      contents: read\n      id-token: write/'
sabotage "pages: write no job que monta o site reprova (só o que publica)" "só no job que publica as páginas" .github/workflows/paginas.yml 's/^      pages: read$/      pages: write/'
sabotage "id-token: write no job que monta o site reprova (só o que publica)" "só no job que publica as páginas" .github/workflows/paginas.yml 's/^      pages: read$/      pages: read\n      id-token: write/'
sabotage "pages: write em outro job do workflow de entrada reprova" "só no job que publica as páginas" .github/workflows/pipeline.yml '0,/      contents: read/s//      contents: read\n      pages: write/'
sabotage "id-token: write em outro job do workflow de entrada reprova" "só no job que publica as páginas" .github/workflows/pipeline.yml '0,/      contents: read/s//      contents: read\n      id-token: write/'
sabotage "contents: write no job que publica as páginas reprova (a escrita do conteúdo é só do lançamento)" "escrita" .github/workflows/paginas.yml 's/^      id-token: write$/      id-token: write\n      contents: write/'
sabotage "uma permissão de escrita a mais no job que publica as páginas reprova" "escrita" .github/workflows/paginas.yml 's/^      id-token: write$/      id-token: write\n      packages: write/'
sabotage "action de fora no workflow das páginas reprova" "uses" .github/workflows/paginas.yml 's/uses: actions\/deploy-pages@[0-9a-f]* # v5.0.1/uses: alguem\/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1/'
sabotage "action das páginas por tag (sem o SHA) reprova" "uses" .github/workflows/paginas.yml 's/uses: actions\/configure-pages@[0-9a-f]* # v6.0.0/uses: actions\/configure-pages@v6 # v6/'
sabotage "as páginas sem permissions: {} no topo reprovam" "permissions: {}" .github/workflows/paginas.yml 's/^permissions: {}$/permissions:\n  contents: read/'
sabotage "o job de páginas que não está na tabela do docs/ci.md reprova" "docs/ci.md" docs/ci.md '/^| `paginas.yml` | `publicar` |/d'

# --- o lançamento que roda com um pacote em falha, sem always() ---
sabotage "always() no if do lançamento reprova (ele rodaria o lançamento até numa execução cancelada)" "always()" .github/workflows/pipeline.yml 's/!cancelled()/always()/'
sabotage "always() com espaço e maiúscula também reprova" "always()" .github/workflows/pipeline.yml 's/!cancelled()/Always ()/'
append "always() no if de um passo de um reutilizável reprova" "always()" .github/workflows/integrar.yml '      - name: Sempre
        if: always()
        run: bash scripts/ci/integration-api.sh'
sabotage "always() numa action composta reprova" "always()" .github/actions/preparar-node/action.yml '0,/^    - name:/s//    - if: always()\n      shell: bash\n      run: echo oi\n    - name:/'

# --- o macOS só na estável ---
sabotage "o job de macOS sem o if pelo ramo reprova (ele rodaria também nos betas)" "macOS" .github/workflows/empacotar.yml "/^    if: github.ref_name == 'main'\$/d"
sabotage "o job de macOS que roda também na develop reprova" "macOS" .github/workflows/empacotar.yml "s/^    if: github.ref_name == 'main'\$/    if: github.ref_name == 'develop'/"
sabotage "o job de macOS com outra condição reprova" "macOS" .github/workflows/empacotar.yml "s/^    if: github.ref_name == 'main'\$/    if: github.ref_name != 'x'/"
# O runner por expressão (matriz) não escapa da regra do macOS: o runs-on só pode ser um dos rótulos fixos, então um job de macOS sempre aparece como literal.
sabotage "o job de macOS com o runner vindo da matriz e sem o if reprova (o runner tem de ser um rótulo fixo)" "runs-on" .github/workflows/empacotar.yml "/^    if: github.ref_name == 'main'\$/d;s/^    runs-on: macos-15\$/    runs-on: \${{ matrix.runner }}/;s/^        arquitetura: \[arm64, x64\]\$/        arquitetura: [arm64, x64]\n        runner: [macos-15]/"
fresh
sed -i.bak "s/^    if: github.ref_name == 'main'\$/    if: \${{ github.ref_name == 'main' }}/" "$work/tree/.github/workflows/empacotar.yml" && rm -f "$work/tree/.github/workflows/empacotar.yml.bak"
run
expect "o mesmo if escrito com \${{ }} também passa" 0 "os workflows seguem as regras"

# --- os segredos ---
sabotage "secrets: inherit reprova" "segredo" .github/workflows/pipeline.yml 's/^    secrets:$/    secrets: inherit\n    x-segredos:/'
append "um segredo usado fora do passo do leak-guard reprova" "segredo" .github/workflows/integrar.yml '      - name: Vazar
        env:
          X: ${{ secrets.LEAK_GUARD_EXTRA }}
        run: bash scripts/ci/integration-api.sh'

# --- os passos e os runners ---
append "um passo que não chama um roteiro de scripts/ci reprova" "roteiro" .github/workflows/integrar.yml '      - name: Inline
        run: echo oi'
append "uma expressão dentro de um run reprova (injeção)" "expressão" .github/workflows/integrar.yml '      - name: Injeção
        run: bash scripts/ci/integration-api.sh ${{ github.event.head_commit.message }}'
append "um roteiro chamado que não existe reprova" "não existe" .github/workflows/integrar.yml '      - name: Fantasma
        run: bash scripts/ci/nao-existe.sh'
sabotage "runner -latest reprova" "runs-on" .github/workflows/integrar.yml 's/runs-on: ubuntu-24.04/runs-on: ubuntu-latest/'
sabotage "runner de rótulo desconhecido (próprio) reprova" "runs-on" .github/workflows/integrar.yml 's/runs-on: ubuntu-24.04/runs-on: [self-hosted, linux]/'
sabotage "contêiner sem digest reprova" "digest" .github/workflows/empacotar.yml 's/image: electronuserland\/builder:24-05.26@sha256:[0-9a-f]*/image: electronuserland\/builder:24-05.26/'
sabotage "checkout sem persist-credentials: false reprova" "persist-credentials" .github/workflows/integrar.yml 's/persist-credentials: false/persist-credentials: true/'
sabotage "job sem timeout-minutes reprova" "timeout-minutes" .github/workflows/integrar.yml '/timeout-minutes: 60/d'
sabotage "concorrência que cancela o que está rodando reprova" "cancel-in-progress" .github/workflows/pipeline.yml 's/cancel-in-progress: false/cancel-in-progress: true/'

# --- a tabela do docs/ci.md ---
sabotage "um job que não está na tabela do docs/ci.md reprova" "docs/ci.md" .github/workflows/integrar.yml 's/^  api:$/  api-nova:/'
sabotage "uma linha da tabela que não é job reprova" "docs/ci.md" docs/ci.md 's/^| `integrar.yml` | `api` |/| `integrar.yml` | `api-velha` |/'

echo
echo "$((total - failures)) de $total casos passaram."
[ "$failures" -eq 0 ]
