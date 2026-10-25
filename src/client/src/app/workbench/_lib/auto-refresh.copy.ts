/**
 * Os textos da atualização automática do resultado (RN-GRADE-014, issue #11): o submenu da grade, o controle da barra do resultado, a nota de quando ela
 * para sozinha e o diálogo do "Personalizado…", num lugar só. O intervalo vem escrito por `intervalLabel` ("5 s", "1 min").
 */
export const autoRefreshCopy = {
  menu: {
    /** O item do menu da célula que abre o submenu, logo depois de "Atualizar" (F5); é também o nome do submenu e do menu da barra. */
    label: "Atualizar automaticamente",
    every: (interval: string) => `A cada ${interval}`,
    custom: "Personalizado…",
    /** O "Personalizado…" com o intervalo em uso, quando ele não é um dos do menu. */
    customChosen: (interval: string) => `Personalizado (${interval})…`,
    off: "Desligar",
  },

  /** Por que ela não liga agora (completam o "Não se aplica: …" do menu). */
  reasons: {
    busy: "há um comando em andamento na aba",
    writes: "o comando grava no banco, e só uma leitura se atualiza sozinha",
    noRows: "não há linhas de uma leitura na tela",
    disconnected: "a aba não está conectada; use Atualizar (F5) para conectar",
  },

  bar: {
    /** O botão da barra, desligada; o nome e a dica. */
    button: "Atualizar automaticamente",
    unavailable: (reason: string) => `Atualizar automaticamente. Não se aplica: ${reason}.`,
    /** O grupo da barra, ligada, para o leitor de tela. */
    group: "Atualização automática",
    every: (interval: string) => `Atualiza a cada ${interval}`,
    last: (time: string) => `última às ${time}`,
    running: "atualizando…",
    /** A pausa da grade: alteração não salva, célula em edição, o menu da célula, "Filtrar por valor…" ou o "Personalizado" abertos. */
    paused: "em pausa enquanto a grade está em uso",
    /** O texto ligado é um botão: abre os intervalos. */
    change: "Trocar o intervalo da atualização automática",
    off: "Desligar a atualização automática",
  },

  /** A nota curta na barra quando ela para sozinha; fica até a próxima execução ou até a pessoa ligar de novo. */
  stopped: {
    failed: "A atualização automática parou: o comando deu erro.",
    cancelled: "A atualização automática parou: o comando foi cancelado.",
    notRun: "A atualização automática parou: o comando não pôde ser executado.",
    writes: "A atualização automática parou: o comando gravou no banco.",
    disconnected: "A atualização automática parou: a sessão com o banco caiu.",
  },

  dialog: {
    title: "Atualizar automaticamente",
    description: "O comando do resultado é executado de novo a cada intervalo, enquanto o resultado está à vista. O intervalo vai de 1 a 3.600 segundos (1 hora).",
    seconds: "Intervalo em segundos",
    invalid: "Use um número inteiro de segundos, de 1 a 3.600.",
    submit: "Ligar",
    cancel: "Cancelar",
  },
};
