import { describe, expect, it } from "vitest";

import type { Transfer } from "../data-export/transfers.schema";
import { canceledAheadNote, connectionDeleteNote, countsOf, exitQuestion } from "./transfer-exits";

const counts = (exports: number, imports: number, copies: number) => ({ exports, imports, copies });

describe("a conta por tipo da lista da API", () => {
  it("o tipo que a tela não conhece, ou nenhum, é exportação", () => {
    const listed = [{ kind: "export" }, { kind: "import" }, { kind: "copy" }, { kind: "copy" }, { kind: null }, { kind: "outro" }] as Pick<Transfer, "kind">[];
    expect(countsOf(listed)).toEqual(counts(3, 1, 2));
  });
});

describe("as saídas com importações ou cópias (RN-IMPORT-021)", () => {
  it("só importações: a conta, o que a saída faz e os botões, no singular e no plural", () => {
    expect(exitQuestion(counts(0, 1, 0), "signOut")).toEqual({
      title: "Sair com importações em andamento?",
      description: "Há 1 importação em andamento. Sair cancela a importação: as linhas que ela já confirmou ficam na tabela, e as da transação em andamento são desfeitas.",
      confirm: "Sair e cancelar a importação",
      keep: "Continuar importando",
      pending: "Cancelando a importação…",
    });
    expect(exitQuestion(counts(0, 2, 0), "signOut")).toMatchObject({
      description: "Há 2 importações em andamento. Sair cancela as importações: as linhas que elas já confirmaram ficam nas tabelas, e as das transações em andamento são desfeitas.",
      confirm: "Sair e cancelar as importações",
    });
  });

  it("só cópias: \"cópia para outro banco\" na conta, e \"Continuar copiando\"", () => {
    expect(exitQuestion(counts(0, 0, 2), "signOut")).toMatchObject({
      title: "Sair com cópias em andamento?",
      description: "Há 2 cópias para outro banco em andamento. Sair cancela as cópias: as linhas que elas já confirmaram ficam nas tabelas, e as das transações em andamento são desfeitas.",
      confirm: "Sair e cancelar as cópias",
      keep: "Continuar copiando",
    });
  });

  it("importações e cópias, sem exportação: \"cancela todas\", e os botões das transferências", () => {
    expect(exitQuestion(counts(0, 1, 1), "signOut")).toMatchObject({
      title: "Sair com transferências em andamento?",
      description: "Há 2 transferências em andamento: 1 importação e 1 cópia para outro banco. Sair cancela todas: as linhas que elas já confirmaram ficam nas tabelas, e as das transações em andamento são desfeitas.",
      confirm: "Sair e cancelar as transferências",
      keep: "Continuar transferindo",
    });
  });

  it("com exportações no meio: os arquivos não são gravados, e as tabelas ficam só com o que foi confirmado", () => {
    expect(exitQuestion(counts(1, 1, 1), "signOut").description).toBe(
      "Há 3 transferências em andamento: 1 exportação, 1 importação e 1 cópia para outro banco. Sair cancela todas: o arquivo da exportação não é gravado, e as importações e as cópias deixam nas tabelas só as linhas que já confirmaram.",
    );
    expect(exitQuestion(counts(2, 1, 0), "signOut").description).toBe(
      "Há 3 transferências em andamento: 2 exportações e 1 importação. Sair cancela todas: os arquivos das exportações não são gravados, e a importação deixa na tabela só as linhas que já confirmou.",
    );
  });

  it("fechar a janela e fechar o Prism: o verbo da frase e o do botão", () => {
    expect(exitQuestion(counts(0, 1, 0), "window")).toMatchObject({
      title: "Fechar com importações em andamento?",
      description: "Há 1 importação em andamento. Fechar a janela cancela a importação: as linhas que ela já confirmou ficam na tabela, e as da transação em andamento são desfeitas.",
      confirm: "Fechar e cancelar a importação",
    });
    expect(exitQuestion(counts(1, 0, 1), "app")).toMatchObject({
      description: "Há 2 transferências em andamento: 1 exportação e 1 cópia para outro banco. Fechar o Prism cancela todas: o arquivo da exportação não é gravado, e a cópia deixa na tabela só as linhas que já confirmou.",
      confirm: "Fechar o Prism e cancelar as transferências",
    });
  });

  it("só exportações: os textos da RN-EXPORT-023, como antes", () => {
    expect(exitQuestion(counts(2, 0, 0), "signOut")).toEqual({
      title: "Sair com exportações em andamento?",
      description: "Há 2 exportações em andamento. Sair cancela as exportações, e os arquivos delas não são gravados.",
      confirm: "Sair e cancelar as exportações",
      keep: "Continuar exportando",
      pending: "Cancelando as exportações…",
    });
    expect(exitQuestion(counts(1, 0, 0), "window").description).toBe("1 exportação começada nesta janela ainda não terminou. Fechar a janela cancela a exportação.");
    expect(exitQuestion(counts(2, 0, 0), "app").confirm).toBe("Fechar o Prism e cancelar as exportações");
  });
});

describe("o aviso do reinício e da atualização, e o diálogo de excluir a conexão", () => {
  it("o reinício e a atualização (RN-DRIVER-005 e RN-ATUALIZA-006)", () => {
    expect(canceledAheadNote(counts(0, 0, 0))).toBeNull();
    expect(canceledAheadNote(counts(2, 0, 0))).toBe("As 2 exportações em andamento serão canceladas.");
    expect(canceledAheadNote(counts(0, 1, 0))).toBe("A importação em andamento será cancelada, e ficam na tabela só as linhas que ela já confirmou.");
    expect(canceledAheadNote(counts(0, 0, 1))).toBe("A cópia para outro banco em andamento será cancelada, e ficam na tabela só as linhas que ela já confirmou.");
    expect(canceledAheadNote(counts(0, 2, 0))).toBe("As 2 importações em andamento serão canceladas, e ficam nas tabelas só as linhas que elas já confirmaram.");
    expect(canceledAheadNote(counts(1, 1, 1))).toBe("As 3 transferências em andamento serão canceladas: ficam nas tabelas só as linhas que as importações e as cópias já confirmaram.");
  });

  it("excluir a conexão (RN-CONN-014)", () => {
    expect(connectionDeleteNote(counts(0, 0, 0))).toBeNull();
    expect(connectionDeleteNote(counts(2, 0, 0))).toBe("As 2 exportações em andamento desta conexão serão canceladas.");
    expect(connectionDeleteNote(counts(0, 1, 0))).toBe("A importação em andamento desta conexão será cancelada, e fica na tabela só o que ela já confirmou.");
    expect(connectionDeleteNote(counts(1, 1, 1))).toBe("As 3 transferências em andamento desta conexão serão canceladas. As importações e as cópias deixam nas tabelas só as linhas que já confirmaram.");
    expect(connectionDeleteNote(counts(0, 0, 2))).toBe("As 2 cópias para outro banco em andamento desta conexão serão canceladas. As cópias deixam nas tabelas só as linhas que já confirmaram.");
  });
});
