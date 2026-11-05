import { describe, expect, it } from "vitest";

import type { ConnectionSsh } from "@/app/connections/_lib/connections.schema";
import { connectionsCopy } from "@/app/connections/_lib/connections.copy";

import { askNetworkSecretFor, createCredentialsRequests, isNetworkSecretField } from "../_lib/credentials-missing";
import { networkSecretLabel } from "./network-secret-dialog";

const copy = connectionsCopy.networkSecret;
const ssh = (authMethod: ConnectionSsh["authMethod"]): ConnectionSsh => ({
  host: "bastion.exemplo.invalid",
  port: 22,
  userName: "ops",
  authMethod,
  privateKeyPath: authMethod === "privateKey" ? "~/.ssh/id_ed25519" : null,
  hasSecret: false,
  saveCredentials: false,
  ignoreHostVerification: false,
  keepAliveIntervalMs: 0,
  tunnelTimeoutMs: 0,
  localHost: null,
  localPort: 0,
  remoteHost: null,
  remotePort: 0,
  hostKeyFingerprint: null,
});

describe("o pedido do segredo ao conectar (RN-REDE-006)", () => {
  it("o túnel e o proxy vão ao pedido do segredo; o usuário e a senha do banco, ao Editar conexão", () => {
    expect(isNetworkSecretField("sshSecret")).toBe(true);
    expect(isNetworkSecretField("proxyPassword")).toBe(true);
    expect(isNetworkSecretField("userName")).toBe(false);
    expect(isNetworkSecretField("password")).toBe(false);
  });

  it("pede a frase secreta da chave, a senha do túnel por senha ou a senha do proxy", () => {
    expect(networkSecretLabel({ ssh: ssh("privateKey") }, "sshSecret")).toBe(copy.passphrase);
    expect(networkSecretLabel({ ssh: ssh("password") }, "sshSecret")).toBe(copy.sshPassword);
    expect(networkSecretLabel({ ssh: ssh("privateKey") }, "proxyPassword")).toBe(copy.proxyPassword);
    expect(copy.required(copy.passphrase)).toBe("Informe a frase secreta da chave SSH.");
  });

  it("a recusa de um assistente de dados pede o segredo da conexão que a API aponta, e só ele", () => {
    const requests = createCredentialsRequests();
    const refusal = (errors: Record<string, string[]>, extensions: Record<string, unknown>) => ({ status: 422, code: "CONNECTION_CREDENTIALS_MISSING", title: "", detail: null, errors, extensions }) as unknown as Parameters<typeof askNetworkSecretFor>[0];

    askNetworkSecretFor(refusal({ password: ["sem senha"] }, { connectionID: "c1" }), requests);
    expect(requests.pending()).toBeNull();
    askNetworkSecretFor(refusal({ sshSecret: ["sem frase"] }, {}), requests);
    expect(requests.pending()).toBeNull();
    askNetworkSecretFor(refusal({ sshSecret: ["sem frase"] }, { connectionID: "c2" }), requests);
    expect(requests.pending()).toMatchObject({ connectionId: "c2", field: "sshSecret" });
  });
});
