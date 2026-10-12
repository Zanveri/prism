import { knownEngines, progressPercent } from "@/app/drivers/_lib/drivers.model";
import type { Driver } from "@/app/drivers/_lib/drivers.schema";
import type { Engine } from "@/components/ui";

import { connectionsCopy } from "./connections.copy";
import { engineOptions } from "./connections.schema";

const copy = connectionsCopy.form.engines;

/**
 * O estado de um banco na lista do formulário, pelo driver que o atende: `missing` é o driver que se pode baixar e ainda não está
 * instalado (`available` no catálogo); `unknown` é o banco sem informação de driver (a lista ainda não chegou, falhou, ou o catálogo não
 * tem driver para ele).
 */
export type EngineChoiceState = "bundled" | "installed" | "missing" | "installing" | "failed" | "unavailable" | "comingSoon" | "unknown";

/** Uma entrada da lista de bancos: um banco que o Prism conecta (`engine`), ou um "em breve" do catálogo (`engine` nulo). */
export type EngineChoice = {
  /** A chave da entrada na lista (`engine:2`, `driver:sqlite`). */
  key: string;
  engine: Engine | null;
  label: string;
  state: EngineChoiceState;
  /** O estado em palavras, embaixo do nome; vazio quando não se sabe. */
  stateLabel: string;
  /** Não pode ser escolhido: o fabricante não publica o driver para esta plataforma, ou o Prism ainda não conecta nesse banco. */
  disabled: boolean;
  /** Por que está desabilitado. */
  reason: string | null;
  /** O driver que atende o banco, se o catálogo o tem. */
  driver: Driver | null;
  /** O driver espera o reinício do serviço (RN-DRIVER-005). */
  restartPending: boolean;
};

const states: Record<Driver["state"], EngineChoiceState> = {
  bundled: "bundled",
  installed: "installed",
  available: "missing",
  installing: "installing",
  failed: "failed",
  unavailable: "unavailable",
  comingSoon: "comingSoon",
};

function stateLabelOf(state: EngineChoiceState, driver: Driver | null): string {
  if (state !== "installing" || driver === null) return copy.states[state];

  const percent = progressPercent(driver.progress);
  return percent === null ? copy.states.installing : copy.states.installingPercent(percent);
}

function reasonOf(state: EngineChoiceState, driver: Driver | null): string | null {
  if (state === "unavailable") return driver?.platformNote ?? copy.unavailableReason;
  return state === "comingSoon" ? copy.comingSoonReason : null;
}

function choice(key: string, engine: Engine | null, label: string, driver: Driver | null): EngineChoice {
  const state = driver === null ? "unknown" : states[driver.state];
  const disabled = state === "unavailable" || state === "comingSoon";

  return { key, engine, label, state, stateLabel: stateLabelOf(state, driver), disabled, reason: reasonOf(state, driver), driver, restartPending: driver?.restartRequired ?? false };
}

/**
 * A lista de bancos do formulário de conexão (RN-NAV-005), como a escolha do DBeaver: os bancos que o Prism conecta, na ordem de sempre,
 * cada um com o estado do driver que o atende no catálogo (`GET api/user/drivers`, `engines`: 1 PostgreSQL, 2 Db2, 3 Informix), e depois os
 * "em breve" do catálogo. O embutido, o instalado, o que falta (e pode ser baixado ali mesmo), o que baixa e o que falhou podem ser
 * escolhidos: uma conexão pode ser salva sem o driver instalado. O sem driver para a plataforma e o "em breve" aparecem desabilitados, com o
 * motivo.
 *
 * Sem a lista (a caminho, ou falhou) os três bancos continuam escolhíveis, sem estado. Um driver de um banco que a tela não conhece (a API
 * mais nova que a tela) entra como "em breve": a tela não sabe criar a conexão dele.
 */
export function engineChoices(drivers: readonly Driver[] | undefined): EngineChoice[] {
  const list = drivers ?? [];
  const engines = engineOptions.map((option) => choice(`engine:${option.value}`, option.value, option.label, list.find((driver) => driver.engines.includes(option.value)) ?? null));
  const others = list.filter((driver) => knownEngines(driver).length === 0).map((driver) => ({ ...choice(`driver:${driver.id}`, null, driver.name, driver), state: "comingSoon" as const, stateLabel: copy.states.comingSoon, disabled: true, reason: copy.comingSoonReason }));

  return [...engines, ...others];
}

/** O banco escolhido, pelo número. */
export function choiceOf(choices: readonly EngineChoice[], engine: Engine): EngineChoice | undefined {
  return choices.find((candidate) => candidate.engine === engine);
}
