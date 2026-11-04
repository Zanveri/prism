import { describe, expect, it } from "vitest";

import { editConnectionSchema, newVerification, unprotected, type Connection } from "./connections.schema";
import { movedConnectionInput } from "./move-connection";

const now = "2026-10-12T12:00:00Z";
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };

// RN-PROT-001, 002 e RN-VERIF-001: a conexão com as proteções próprias e a verificação fora do padrão.
const protegida: Connection = { ...mes, confirmCommands: "irreversible", readOnly: true, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1", protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: "f1" } };

describe("movedConnectionInput: mover uma conexão de pasta pelo navegador (RN-NAV-003)", () => {
  it("leva a conexão como está, só com a pasta nova, e a senha nula (a API mantém a gravada, RN-CONN-004)", () => {
    expect(movedConnectionInput(mes, "f2")).toEqual({ name: "MES Produção", folderID: "f2", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", password: null, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, ...newVerification });
  });

  it("leva as proteções próprias e a verificação como estão (RN-PROT-003, RN-VERIF-001): o PATCH grava por inteiro, e sem elas voltariam ao padrão", () => {
    expect(movedConnectionInput(protegida, "f2")).toMatchObject({ folderID: "f2", confirmCommands: "irreversible", readOnly: true, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1" });
  });

  it("a confirmação herdada da pasta (`protections`) não vai como própria: ela muda com a pasta de destino (RN-PROT-004)", () => {
    expect(movedConnectionInput(protegida, null).confirmCommands).toBe("irreversible");
    expect(movedConnectionInput(protegida, null)).not.toHaveProperty("protections");
  });

  it("para a raiz, a pasta é nula", () => {
    expect(movedConnectionInput(mes, null).folderID).toBeNull();
  });

  it("é o mesmo pedido que o formulário mandaria sem mexer em nada além da pasta (o mesmo PATCH, que leva tudo por inteiro)", () => {
    // O formulário manda as proteções próprias pelos campos escondidos, e a sessão da conexão (RN-VERIF-001) pelo painel dela, que nasce com a gravada.
    const sessionFields = { verificationEnabled: String(protegida.verificationEnabled), verificationInterval: String(protegida.verificationInterval), verificationQuery: protegida.verificationQuery ?? "" };
    const fromForm = { ...editConnectionSchema.parse({ engine: "3", name: protegida.name, folderID: "f2", host: protegida.host, port: String(protegida.port), database: protegida.database, userName: protegida.userName, password: "", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "irreversible", readOnly: "true", ...sessionFields }) };

    expect(movedConnectionInput(protegida, "f2")).toEqual(fromForm);
  });

  it("preserva SSH, SSL e Proxy quando presentes na conexão, mantendo o segredo SSH e a senha do proxy como nulos", () => {
    const comRede: Connection = {
      ...mes,
      ssh: {
        host: "bastion.exemplo.local",
        port: 22,
        userName: "pedro",
        authMethod: "password",
        privateKeyPath: null,
        hasSecret: true,
        saveCredentials: true,
        ignoreHostVerification: false,
        keepAliveIntervalMs: 0,
        tunnelTimeoutMs: 0,
        localHost: null,
        localPort: 0,
        remoteHost: null,
        remotePort: 0,
        hostKeyFingerprint: "SHA256:ohD8VZEXGWo6Ez8GSEJQ9WpafgLFsOfLOtGGQCQo6Og",
      },
      ssl: {
        caCertificatePath: "/certs/ca.pem",
        clientCertificatePath: "/certs/client.crt",
        clientKeyPath: "/certs/client.key",
        sslMode: "require",
      },
      proxy: {
        host: "socks.exemplo.local",
        port: 1080,
        userName: "proxy_user",
        hasPassword: true,
        saveCredentials: false,
      },
    };

    const moved = movedConnectionInput(comRede, "f2");
    expect(moved.ssh).toMatchObject({ host: "bastion.exemplo.local", port: 22, userName: "pedro", secret: null, hostKeyFingerprint: "SHA256:ohD8VZEXGWo6Ez8GSEJQ9WpafgLFsOfLOtGGQCQo6Og" });
    // A chave do cliente e o "não salvar a senha" voltam à API com os nomes dela: com outro nome, mover a conexão os perderia.
    expect(moved.ssl).toEqual({ caCertificatePath: "/certs/ca.pem", clientCertificatePath: "/certs/client.crt", clientKeyPath: "/certs/client.key", sslMode: "require" });
    expect(moved.proxy).toEqual({ host: "socks.exemplo.local", port: 1080, userName: "proxy_user", password: null, saveCredentials: false });
  });
});
