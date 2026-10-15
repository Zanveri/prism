import type { Confirmation, Folder, Protections } from "./connections.schema";

/** RN-PROT-001: as três escolhas de "Confirmar antes de executar", como os campos do formulário as escrevem: `none` é "Não". */
export type ConfirmationChoice = "none" | Confirmation;

/** As escolhas na ordem da tela, da mais fraca para a mais forte. */
export const confirmationChoices: readonly ConfirmationChoice[] = ["none", "irreversible", "all"];

/** A escolha do formulário para a confirmação gravada (nula é "Não"). */
export function confirmationChoiceOf(confirmation: Confirmation | null): ConfirmationChoice {
  return confirmation ?? "none";
}

/** RN-PROT-004: a força de cada escolha: "Todos os comandos", depois "Só comandos irreversíveis", depois "Não". */
export function confirmationRank(confirmation: Confirmation | ConfirmationChoice | null): number {
  return confirmation === "all" ? 2 : confirmation === "irreversible" ? 1 : 0;
}

/** A mais forte das duas confirmações (nula é "Não"). */
export function strongerConfirmation(a: Confirmation | null, b: Confirmation | null): Confirmation | null {
  return confirmationRank(b) > confirmationRank(a) ? b : a;
}

/** O que uma conexão ou uma subpasta herda dentro de uma pasta: o somente leitura e a confirmação que valem nela, cada um com a pasta que o impõe. */
export type InheritedProtections = { readOnly: Folder | null; confirm: { level: Confirmation; folder: Folder } | null };

const nothingInherited: InheritedProtections = { readOnly: null, confirm: null };

/**
 * RN-PROT-004: o que uma conexão ou uma subpasta herda dentro de `folderID` (nula: a raiz, que não impõe nada). As proteções da pasta valem para tudo o que
 * está dentro dela, a qualquer profundidade, e a API já diz, de cada pasta, as que valem (`protections`, as dela e as de cima) e qual pasta impõe cada uma
 * (nula: a própria). Aqui só se acha a pasta de onde vem cada uma, para a tela dizer "Herdado da pasta X". É o que o formulário mostra para a pasta
 * escolhida no campo, antes de gravar; a pasta que a lista não tem não passa nada adiante.
 */
export function inheritedProtections(folders: readonly Folder[], folderID: string | null): InheritedProtections {
  const folder = folderID === null ? undefined : folders.find((candidate) => candidate.id === folderID);
  if (folder === undefined) return nothingInherited;

  const byID = (id: string | null) => (id === null ? folder : (folders.find((candidate) => candidate.id === id) ?? folder));
  const { readOnly, readOnlyFolderID, confirmCommands, confirmCommandsFolderID } = folder.protections;
  return { readOnly: readOnly ? byID(readOnlyFolderID) : null, confirm: confirmCommands === null ? null : { level: confirmCommands, folder: byID(confirmCommandsFolderID) } };
}

/** As proteções que valem para uma conexão ou uma pasta, com a pasta de onde vem cada uma (`from` nula: a própria). Sem a proteção, nula. */
export type ShownProtections = { readOnly: { from: Folder | null } | null; confirm: { level: Confirmation; from: Folder | null } | null };

/**
 * RN-PROT-004: as proteções que valem (`protections` da API), com a pasta que impõe cada uma, para a tela dizer de onde vêm: o cadeado e a dica dele
 * (RN-PROT-002) e o porquê do aviso de confirmação (RN-PROT-001). A pasta acima que a lista não tem fica como nula, e a proteção continua valendo.
 */
export function shownProtections(protections: Protections, folders: readonly Folder[]): ShownProtections {
  const folderOf = (id: string | null) => (id === null ? null : (folders.find((folder) => folder.id === id) ?? null));
  return {
    readOnly: protections.readOnly ? { from: folderOf(protections.readOnlyFolderID) } : null,
    confirm: protections.confirmCommands === null ? null : { level: protections.confirmCommands, from: folderOf(protections.confirmCommandsFolderID) },
  };
}
