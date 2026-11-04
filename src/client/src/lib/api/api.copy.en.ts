import type { ApiCopy } from "./api.copy";

export const apiCopyEn: ApiCopy = {
  noResponse: "No response from the API.",
  invalidResponse: "The API responded in an unexpected format.",
  unexpectedError: "Unexpected error.",
  vaultLocked: "Vault locked. Sign in again.",
  outsideElectron: {
    export: "Export only works in the Prism app.",
    import: "Import only works in the Prism app.",
    dbeaver: "Import from DBeaver only works in the Prism app.",
  },
};
