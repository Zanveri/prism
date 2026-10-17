import { dataExportCopy } from "../data-export/data-export.copy";
import { kindOf, type Transfer } from "../data-export/transfers.schema";
import { dataImportCopy } from "./data-import.copy";

/**
 * Os textos das saídas que perguntam pelas transferências em andamento (RN-EXPORT-023 e RN-IMPORT-021), do aviso de antes do reinício do serviço e da
 * instalação (RN-DRIVER-005 e RN-ATUALIZA-006) e do diálogo de excluir a conexão (RN-CONN-014), pela conta de cada tipo. Com só exportações valem os textos
 * da RN-EXPORT-023, como antes da seção 36; com alguma importação ou cópia, os da RN-IMPORT-021.
 */

export type TransferCounts = { exports: number; imports: number; copies: number };

export const noTransfers: TransferCounts = { exports: 0, imports: 0, copies: 0 };

/** A conta por tipo das transferências da lista da API (`kindOf`: o tipo que a tela não conhece é exportação). */
export function countsOf(transfers: readonly Pick<Transfer, "kind">[]): TransferCounts {
  const counts = { ...noTransfers };
  for (const transfer of transfers) {
    const kind = kindOf(transfer);
    if (kind === "import") counts.imports += 1;
    else if (kind === "copy") counts.copies += 1;
    else counts.exports += 1;
  }
  return counts;
}

export const totalOf = (counts: TransferCounts) => counts.exports + counts.imports + counts.copies;

/** A saída: o "Sair", fechar a janela, fechar o Prism (a última janela). O "Bloquear" do menu do usuário ainda não existe (RN-NAV-001). */
export type TransferExit = "signOut" | "window" | "app";

export type ExitQuestion = { title: string; description: string; confirm: string; keep: string; pending: string };

const ex = dataExportCopy.exits;
const im = dataImportCopy.exits;

type KindKey = "export" | "import" | "copy" | "mixed";

/** O tipo das transferências contadas: o único que aparece, ou `mixed`. */
function kindKeyOf(counts: TransferCounts): KindKey {
  const kinds = [counts.exports > 0 ? "export" : null, counts.imports > 0 ? "import" : null, counts.copies > 0 ? "copy" : null].filter((kind) => kind !== null);
  return kinds.length === 1 ? (kinds[0] as KindKey) : "mixed";
}

/** O que a saída cancela, como objeto do verbo: "a importação", "as cópias", "as transferências". */
function whatOf(counts: TransferCounts): string {
  const [one, many] = im.nouns[kindKeyOf(counts)];
  return totalOf(counts) === 1 ? `a ${one}` : `as ${many}`;
}

/** As importações e as cópias, juntas, são uma só (a frase vai no singular). */
const singleLoad = (counts: TransferCounts) => counts.imports + counts.copies === 1;

/**
 * A pergunta da saída: o título, a frase (a conta e o que a saída faz), o botão que confirma, o que continua (com o foco e o Esc) e o texto do botão
 * enquanto cancela. Com só exportações, os textos da RN-EXPORT-023.
 */
export function exitQuestion(counts: TransferCounts, exit: TransferExit): ExitQuestion {
  const total = totalOf(counts);
  const kind = kindKeyOf(counts);
  const verb = im.verbs[exit];
  const buttonVerb = im.buttonVerbs[exit];
  if (kind === "export") {
    const description = exit === "signOut" ? ex.signOut(total) : exit === "window" ? ex.window(total) : ex.app(total);
    const confirm = exit === "signOut" ? ex.signOutConfirm(total) : exit === "window" ? ex.windowConfirm(total) : ex.appConfirm(total);
    return { title: exit === "signOut" ? ex.signOutTitle : ex.windowTitle, description, confirm, keep: ex.keepExporting, pending: ex.cancelling };
  }
  const what = whatOf(counts);
  let does: string;
  if (counts.exports > 0) does = im.cancelsMixed(verb, counts.exports, im.loads(counts.imports, counts.copies), singleLoad(counts));
  else if (kind === "mixed") does = im.cancelsLoads(verb);
  else does = im.cancelsOne(verb, what, total === 1);
  return {
    title: im.title(exit === "signOut" ? "Sair" : "Fechar", im.nouns[kind][1]),
    description: `${im.count(counts.exports, counts.imports, counts.copies)} ${does}`,
    confirm: im.confirm(buttonVerb, what),
    keep: im.keep[kind],
    pending: im.pending(what),
  };
}

/** O aviso de antes do reinício do serviço e da instalação de uma atualização: as transferências que serão canceladas (nulo sem nenhuma). */
export function canceledAheadNote(counts: TransferCounts): string | null {
  const total = totalOf(counts);
  if (total === 0) return null;
  const kind = kindKeyOf(counts);
  if (kind === "export") return ex.canceledAhead(total);
  if (total === 1) return im.aheadOne(kind === "copy" ? im.copyNoun : im.nouns.import[0]);
  if (kind !== "mixed") return im.aheadKind(total, kind === "copy" ? "cópias para outro banco" : im.nouns.import[1]);
  return im.aheadMixed(total, im.loads(counts.imports, counts.copies), singleLoad(counts));
}

/** O diálogo de excluir a conexão: as transferências dela (a da origem ou a do destino) que serão canceladas (nulo sem nenhuma). */
export function connectionDeleteNote(counts: TransferCounts): string | null {
  const total = totalOf(counts);
  if (total === 0) return null;
  const kind = kindKeyOf(counts);
  if (kind === "export") return ex.connectionDelete(total);
  if (total === 1) return im.connectionOne(kind === "copy" ? im.copyNoun : im.nouns.import[0]);
  const plural = kind === "copy" ? "cópias para outro banco" : im.nouns[kind][1];
  return im.connectionMany(total, plural, im.loads(counts.imports, counts.copies), singleLoad(counts));
}
