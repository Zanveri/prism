#!/usr/bin/env bash
# Para ser lido com `source`: o aviso que não se perde. No GitHub Actions não existe job "laranja": um job passa ou falha. O que
# não lança, ou lança com ressalva, tem de aparecer À VISTA mesmo com o job verde, e por isso sai de dois jeitos:
#  - uma anotação de aviso (o comando de workflow `::warning`), que o GitHub mostra no topo da execução e no job;
#  - uma seção no resumo do job (o arquivo do `GITHUB_STEP_SUMMARY`), que aparece na página da execução.
# Fora do GitHub Actions (na sua máquina), o aviso vai para a saída de erro com a palavra AVISO, e o resumo não existe.
#
# O texto de um aviso passa pela codificação que a documentação dos comandos de workflow pede (%, \r e \n), para uma mensagem
# não terminar o comando no meio nem abrir outro. Quem escreve TEXTO DE FORA no log (notas de release, mensagens de commit) usa
# `ci_quiet_begin`/`ci_quiet_end`, que desligam a leitura de comandos de workflow com uma senha sorteada na hora: assim uma linha
# que comece com "::" vinda de uma mensagem de commit não vira um comando.
# (Sem nada do bash 4: este arquivo é lido também pelo package-desktop.sh, que roda no bash 3.2 do macOS.)

ci_in_actions() {
  [ "${GITHUB_ACTIONS:-}" = true ]
}

# ci_escape <texto>: o texto como dado de um comando de workflow.
ci_escape() {
  local text=$1
  text=${text//'%'/%25}
  text=${text//$'\r'/%0D}
  text=${text//$'\n'/%0A}
  printf '%s' "$text"
}

# ci_escape_property <texto>: o mesmo, para uma propriedade (title=…), que também não pode ter ":" nem ",".
ci_escape_property() {
  local text
  text=$(ci_escape "$1")
  text=${text//:/%3A}
  text=${text//,/%2C}
  printf '%s' "$text"
}

# ci_summary <markdown>: acrescenta o texto ao resumo do job, se houver um.
ci_summary() {
  if ci_in_actions && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$1" >> "$GITHUB_STEP_SUMMARY"; fi
  return 0
}

# ci_warning <título> <mensagem>: o aviso à vista (anotação e resumo, no GitHub; AVISO na saída de erro, fora dele).
ci_warning() {
  if ci_in_actions; then
    printf '::warning title=%s::%s\n' "$(ci_escape_property "$1")" "$(ci_escape "$2")"
    ci_summary "> [!WARNING]
> **$1.** $2"
  else
    printf 'AVISO (%s): %s\n' "$1" "$2" >&2
  fi
}

# ci_quiet_begin / ci_quiet_end: desliga e religa a leitura de comandos de workflow em volta de texto que veio de fora.
ci_quiet_begin() {
  ci_in_actions || return 0
  ci_quiet_token="prism-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  printf '::stop-commands::%s\n' "$ci_quiet_token"
}

ci_quiet_end() {
  ci_in_actions || return 0
  [ -n "${ci_quiet_token:-}" ] || return 0
  printf '::%s::\n' "$ci_quiet_token"
  ci_quiet_token=
}
