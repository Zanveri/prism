import { describe, expect, it, vi } from "vitest";

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import { newVerification } from "../_lib/connections.schema";
import { SessionSection, type SessionSectionProps } from "./session-section";

const copy = connectionsCopy.session;

const base: SessionSectionProps = { idPrefix: "cx", engine: 1, saved: newVerification, verifying: true, onVerifyingChange: () => {}, errors: {} };

/** O que o painel monta: o campo escondido da caixa, a caixa, o intervalo, a consulta e os textos. */
function drawn(props: Partial<SessionSectionProps> = {}) {
  const all = elementsOf(SessionSection({ ...base, ...props }));
  const hidden = all.find((element) => element.type === "input" && element.props.type === "hidden")?.props;
  const checkbox = all.find((element) => element.type === "input" && element.props.type === "checkbox") as Found;
  const interval = all.find((element) => element.type === "input" && element.props.name === "verificationInterval") as Found;
  const query = all.find((element) => element.type === "textarea") as Found;
  const texts = all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));
  return { all, hidden, checkbox, interval, query, texts };
}

describe("o painel Sessão da conexão (RN-VERIF-001)", () => {
  it("tem “Verificar a cada [N] segundos”, ligada, com 30, e a consulta de verificação vazia, com a do banco como dica", () => {
    const { hidden, checkbox, interval, query, texts } = drawn();

    expect(texts).toEqual(expect.arrayContaining([copy.title, copy.verify, copy.seconds, copy.hint, copy.query, copy.queryHint]));
    expect(hidden).toMatchObject({ name: "verificationEnabled", value: "true" });
    expect(checkbox.props.checked).toBe(true);
    expect(interval.props).toMatchObject({ defaultValue: "30", "aria-label": copy.interval, inputMode: "numeric" });
    expect(query.props).toMatchObject({ name: "verificationQuery", defaultValue: "", placeholder: "SELECT 1" });
  });

  it.each([
    [1, "SELECT 1"],
    [2, "SELECT 1 FROM SYSIBM.SYSDUMMY1"],
    [3, "SELECT 1 FROM systables WHERE tabid = 1"],
  ] as const)("no banco %i, a dica é a consulta que a API usa sem uma própria: %s", (engine, placeholder) => {
    expect(drawn({ engine }).query.props.placeholder).toBe(placeholder);
  });

  it("sem banco escolhido ainda, a consulta fica sem dica", () => {
    expect(drawn({ engine: null }).query.props.placeholder).toBeUndefined();
  });

  it("a verificação gravada é a de que os campos partem; desligada, o campo escondido diz false", () => {
    const { hidden, checkbox, interval, query } = drawn({ saved: { verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1" }, verifying: false });

    expect(hidden?.value).toBe("false");
    expect(checkbox.props.checked).toBe(false);
    expect(interval.props.defaultValue).toBe("120");
    expect(query.props.defaultValue).toBe("SELECT 1 FROM SYSIBM.SYSDUMMY1");
  });

  it("marcar e desmarcar avisam quem abriu o painel", () => {
    const onVerifyingChange = vi.fn();
    (drawn({ onVerifyingChange }).checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });

    expect(onVerifyingChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("as recusas da API aparecem embaixo de cada campo, ligadas a ele (o motivo da consulta que não é uma leitura só inclusive)", () => {
    const refusal = "A consulta de verificação tem de ser uma leitura só: um UPDATE não é leitura.";
    const { all, interval, query } = drawn({ errors: { verificationInterval: "A verificação deve ser feita a cada 5 a 3.600 segundos.", verificationQuery: refusal } });
    const errorText = (id: string) => all.find((element) => element.props.id === id)?.props.children;

    expect(interval.props).toMatchObject({ "aria-invalid": true, "aria-describedby": "cx-verification-interval-error" });
    expect(query.props).toMatchObject({ "aria-invalid": true, "aria-describedby": "cx-verification-query-error cx-verification-query-hint" });
    expect(errorText("cx-verification-interval-error")).toBe("A verificação deve ser feita a cada 5 a 3.600 segundos.");
    expect(errorText("cx-verification-query-error")).toBe(refusal);
  });

  it("não desenha o “Encerrar a conexão após N minutos sem uso” do canvas: o encerramento por ociosidade continua fora (seção 13)", () => {
    const { all, texts } = drawn();

    expect(texts.some((text) => /Encerrar|minutos sem uso/.test(text))).toBe(false);
    expect(all.filter((element) => element.type === "input" && element.props.type === "checkbox")).toHaveLength(1);
  });

  it("o indicador da última verificação vai à direita da linha, quando há", () => {
    const { all } = drawn({ indicator: "Respondeu na última verificação" });

    expect(all.some((element) => element.props.children === "Respondeu na última verificação")).toBe(true);
  });
});
