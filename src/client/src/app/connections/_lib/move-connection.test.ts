import { describe, expect, it } from "vitest";

import { editConnectionSchema, type Connection } from "./connections.schema";
import { movedConnectionInput } from "./move-connection";

const now = "2026-10-12T12:00:00Z";
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", createdAt: now, updatedAt: now };

describe("movedConnectionInput: mover uma conexão de pasta pelo navegador (RN-NAV-003)", () => {
  it("leva a conexão como está, só com a pasta nova, e a senha nula (a API mantém a gravada, RN-CONN-004)", () => {
    expect(movedConnectionInput(mes, "f2")).toEqual({ name: "MES Produção", folderID: "f2", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", password: null, environmentName: "Produção", environmentColor: "#FF8A7A" });
  });

  it("para a raiz, a pasta é nula", () => {
    expect(movedConnectionInput(mes, null).folderID).toBeNull();
  });

  it("é o mesmo pedido que o formulário mandaria sem mexer em nada além da pasta (o mesmo PATCH, que leva tudo por inteiro)", () => {
    const fromForm = editConnectionSchema.parse({ engine: "3", name: mes.name, folderID: "f2", host: mes.host, port: String(mes.port), database: mes.database, userName: mes.userName, password: "", environmentName: "Produção", environmentColor: "#FF8A7A" });

    expect(movedConnectionInput(mes, "f2")).toEqual(fromForm);
  });
});
