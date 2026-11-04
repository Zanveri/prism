import { useState } from "react";

import { ChevronIcon, CloseIcon, Field, FieldError, FieldLabel, InfoIcon, PlusIcon, Select, TextField } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import type { Connection, SslMode } from "../_lib/connections.schema";

const copy = connectionsCopy.form;
const monoClassName = "font-mono text-sm";

export type ConnectionTabId = "main" | "ssh" | "ssl" | "proxy";
export type NetworkTabId = "ssh" | "ssl" | "proxy";

const networkTabsOrder: readonly { id: NetworkTabId; label: string }[] = [
  { id: "ssh", label: copy.tabs.ssh },
  { id: "ssl", label: copy.tabs.ssl },
  { id: "proxy", label: copy.tabs.proxy },
];

const authMethodOptions = [
  { value: "password", label: copy.ssh.authPassword },
  { value: "privateKey", label: copy.ssh.authPrivateKey },
];

const sslModeOptions = [
  { value: "", label: copy.ssl.sslModeDefault },
  { value: "disable", label: "disable" },
  { value: "allow", label: "allow" },
  { value: "prefer", label: "prefer" },
  { value: "require", label: "require" },
  { value: "verify-ca", label: "verify-ca" },
  { value: "verify-full", label: "verify-full" },
];

/** Descobre em qual aba está o primeiro erro de validação para levá-la à frente automaticamente. */
export function tabForErrors(errors: FieldErrors): ConnectionTabId | null {
  for (const key of Object.keys(errors)) {
    if (errors[key] === undefined) continue;
    if (key === "ssh" || key.startsWith("ssh")) return "ssh";
    if (key === "ssl" || key.startsWith("ssl")) return "ssl";
    if (key === "proxy" || key.startsWith("proxy")) return "proxy";
    return "main";
  }
  return null;
}

type ConnectionTabBarProps = {
  activeTab: ConnectionTabId;
  onSelectTab: (tab: ConnectionTabId) => void;
  enabledTabs: Record<NetworkTabId, boolean>;
  onEnableTab: (tab: NetworkTabId) => void;
  onDisableTab: (tab: NetworkTabId) => void;
  errors: FieldErrors;
};

/**
 * A barra de abas no estilo do DBeaver no topo das configurações da conexão: "Principal" fixa à esquerda, as abas opcionais "SSH", "SSL" e "Proxy"
 * adicionadas com o botão de fechar (`×`), e à direita o menu "+ SSH, SSL, ..." com as abas que ainda não foram adicionadas.
 */
export function ConnectionTabBar({ activeTab, onSelectTab, enabledTabs, onEnableTab, onDisableTab, errors }: ConnectionTabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const availableToAdd = networkTabsOrder.filter((tab) => !enabledTabs[tab.id]);
  const addButtonLabel =
    availableToAdd.length === 3
      ? `${copy.tabs.ssh}, ${copy.tabs.ssl}, ...`
      : availableToAdd.map((tab) => tab.label).join(", ");

  const hasTabError = (prefix: NetworkTabId) =>
    Object.keys(errors).some((key) => errors[key] !== undefined && (key === prefix || key.startsWith(prefix)));

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
      <div role="tablist" aria-label={copy.newTitle} className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "main"}
          onClick={() => onSelectTab("main")}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            activeTab === "main" ? "bg-selected text-ink" : "text-muted hover:bg-hover hover:text-ink",
          )}
        >
          {copy.tabs.main}
        </button>

        {networkTabsOrder.map((tab) => {
          if (!enabledTabs[tab.id]) return null;
          const isSelected = activeTab === tab.id;
          const hasError = hasTabError(tab.id);

          return (
            <div
              key={tab.id}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                isSelected ? "bg-selected text-ink" : "text-muted hover:bg-hover hover:text-ink",
                hasError && "ring-1 ring-danger/60",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelectTab(tab.id)}
                className={cn("cursor-pointer py-1.5 pl-3 pr-1.5", hasError && "text-danger")}
              >
                {tab.label}
              </button>
              <button
                type="button"
                aria-label={copy.tabs.removeTab(tab.label)}
                title={copy.tabs.removeTab(tab.label)}
                onClick={() => onDisableTab(tab.id)}
                className="mr-1 flex size-5 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-panel hover:text-ink"
              >
                <CloseIcon className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {availableToAdd.length > 0 ? (
        <div className="relative">
          <button
            type="button"
            aria-label={copy.tabs.addMenuLabel}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-hover"
          >
            <PlusIcon className="size-3.5 text-success" />
            <span>{addButtonLabel}</span>
            <ChevronIcon direction="down" className="size-3 text-muted" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 flex min-w-36 flex-col rounded-md border border-border-strong bg-elevated p-1 shadow-lg"
            >
              {availableToAdd.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onEnableTab(tab.id);
                  }}
                  className=" flex cursor-pointer items-center rounded px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-selected"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type ConnectionNetworkPanelsProps = {
  connection: Connection | null;
  activeTab: ConnectionTabId;
  enabledTabs: Record<NetworkTabId, boolean>;
  errors: FieldErrors;
};

/**
 * Os painéis das abas SSH, SSL e Proxy do diálogo de conexão. Ficam montados dentro do `<form>` (escondidos com `hidden` quando outra aba está ativa) para
 * que o `FormData` entregue todos os campos no salvamento, no teste de conexão e na conferência de alterações não salvas (`hasChanges`).
 */
export function ConnectionNetworkPanels({ connection, activeTab, enabledTabs, errors }: ConnectionNetworkPanelsProps) {
  const savedSsh = connection?.ssh ?? null;
  const savedSsl = connection?.ssl ?? null;
  const savedProxy = connection?.proxy ?? null;

  const [sshAuthMethod, setSshAuthMethod] = useState<"password" | "privateKey">(savedSsh?.authMethod ?? "password");
  const [sshSaveCredentials, setSshSaveCredentials] = useState(savedSsh?.saveCredentials ?? true);
  const [sshIgnoreHostVerification, setSshIgnoreHostVerification] = useState(savedSsh?.ignoreHostVerification ?? false);
  const [sslMode, setSslMode] = useState<SslMode>(savedSsl?.sslMode ?? "");
  const [proxySavePassword, setProxySavePassword] = useState(savedProxy?.saveCredentials ?? true);

  return (
    <>
      <input type="hidden" name="sshEnabled" value={String(enabledTabs.ssh)} />
      <input type="hidden" name="sslEnabled" value={String(enabledTabs.ssl)} />
      <input type="hidden" name="proxyEnabled" value={String(enabledTabs.proxy)} />

      {/* Aba SSH */}
      <div hidden={activeTab !== "ssh"} className={activeTab === "ssh" ? "flex flex-col gap-5" : undefined}>
        <FieldError id="cx-ssh-error">{errors.ssh}</FieldError>

        <section aria-labelledby="cx-ssh-settings-title" className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
          <h3 id="cx-ssh-settings-title" className="text-base leading-5 font-semibold">
            {copy.ssh.settingsTitle}
          </h3>

          <div className="grid grid-cols-[1fr_120px] gap-4">
            <TextField
              id="cx-ssh-host"
              name="sshHost"
              label={copy.ssh.host}
              defaultValue={savedSsh?.host ?? ""}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.sshHost}
              className={monoClassName}
            />
            <TextField
              id="cx-ssh-port"
              name="sshPort"
              label={copy.ssh.port}
              defaultValue={String(savedSsh?.port ?? 22)}
              inputMode="numeric"
              autoComplete="off"
              error={errors.sshPort}
              className={monoClassName}
            />
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
            <TextField
              id="cx-ssh-user-name"
              name="sshUserName"
              label={copy.ssh.userName}
              defaultValue={savedSsh?.userName ?? ""}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.sshUserName}
              className={monoClassName}
            />

            <Field>
              <FieldLabel htmlFor="cx-ssh-auth-method">{copy.ssh.authMethod}</FieldLabel>
              <Select
                id="cx-ssh-auth-method"
                name="sshAuthMethod"
                value={sshAuthMethod}
                onChange={(value) => setSshAuthMethod(value as "password" | "privateKey")}
                options={authMethodOptions}
                invalid={Boolean(errors.sshAuthMethod)}
              />
              <FieldError id="cx-ssh-auth-method-error">{errors.sshAuthMethod}</FieldError>
            </Field>
          </div>

          <div hidden={sshAuthMethod !== "privateKey"}>
            <TextField
              id="cx-ssh-private-key-path"
              name="sshPrivateKeyPath"
              label={copy.ssh.privateKeyPath}
              defaultValue={savedSsh?.privateKeyPath ?? ""}
              placeholder={copy.ssh.privateKeyPlaceholder}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.sshPrivateKeyPath}
              className={monoClassName}
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-4">
            <TextField
              id="cx-ssh-secret"
              name="sshSecret"
              type="password"
              label={sshAuthMethod === "privateKey" ? copy.ssh.passphrase : copy.ssh.password}
              defaultValue=""
              placeholder={savedSsh?.hasSecret ? copy.passwordKept : undefined}
              autoComplete="off"
              spellCheck={false}
              error={errors.sshSecret}
            />

            <input type="hidden" name="sshSaveCredentials" value={String(sshSaveCredentials)} />
            <label htmlFor="cx-ssh-save-credentials" className="mb-2.5 flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                id="cx-ssh-save-credentials"
                type="checkbox"
                checked={sshSaveCredentials}
                onChange={(event) => setSshSaveCredentials(event.target.checked)}
                className="m-0 size-[18px] flex-none cursor-pointer accent-accent"
              />
              <span>{copy.ssh.saveCredentials}</span>
            </label>
          </div>
        </section>

        <section aria-labelledby="cx-ssh-advanced-title" className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
          <h3 id="cx-ssh-advanced-title" className="text-base leading-5 font-semibold">
            {copy.ssh.advancedTitle}
          </h3>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{copy.ssh.generalTitle}</span>
              <input type="hidden" name="sshIgnoreHostVerification" value={String(sshIgnoreHostVerification)} />
              <label htmlFor="cx-ssh-ignore-host" className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  id="cx-ssh-ignore-host"
                  type="checkbox"
                  checked={sshIgnoreHostVerification}
                  onChange={(event) => setSshIgnoreHostVerification(event.target.checked)}
                  className="m-0 size-[18px] flex-none cursor-pointer accent-accent"
                />
                <span>{copy.ssh.ignoreHostVerification}</span>
              </label>
              <TextField
                id="cx-ssh-host-key-fingerprint"
                name="sshHostKeyFingerprint"
                label={copy.ssh.hostKeyFingerprint}
                defaultValue={savedSsh?.hostKeyFingerprint ?? ""}
                placeholder={copy.ssh.hostKeyFingerprintPlaceholder}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                error={errors.sshHostKeyFingerprint}
                className={monoClassName}
              />
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{copy.ssh.timeoutsTitle}</span>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  id="cx-ssh-keep-alive"
                  name="sshKeepAliveIntervalMs"
                  label={copy.ssh.keepAliveIntervalMs}
                  defaultValue={String(savedSsh?.keepAliveIntervalMs ?? 0)}
                  inputMode="numeric"
                  autoComplete="off"
                  error={errors.sshKeepAliveIntervalMs}
                  className={monoClassName}
                />
                <TextField
                  id="cx-ssh-tunnel-timeout"
                  name="sshTunnelTimeoutMs"
                  label={copy.ssh.tunnelTimeoutMs}
                  defaultValue={String(savedSsh?.tunnelTimeoutMs ?? 0)}
                  inputMode="numeric"
                  autoComplete="off"
                  error={errors.sshTunnelTimeoutMs}
                  className={monoClassName}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{copy.ssh.portForwardingTitle}</span>
            <div className="grid grid-cols-[1fr_120px] gap-4">
              <TextField
                id="cx-ssh-local-host"
                name="sshLocalHost"
                label={copy.ssh.localHost}
                defaultValue={savedSsh?.localHost ?? ""}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                error={errors.sshLocalHost}
                className={monoClassName}
              />
              <TextField
                id="cx-ssh-local-port"
                name="sshLocalPort"
                label={copy.ssh.localPort}
                defaultValue={String(savedSsh?.localPort ?? 0)}
                inputMode="numeric"
                autoComplete="off"
                error={errors.sshLocalPort}
                className={monoClassName}
              />
              <TextField
                id="cx-ssh-remote-host"
                name="sshRemoteHost"
                label={copy.ssh.remoteHost}
                defaultValue={savedSsh?.remoteHost ?? ""}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                error={errors.sshRemoteHost}
                className={monoClassName}
              />
              <TextField
                id="cx-ssh-remote-port"
                name="sshRemotePort"
                label={copy.ssh.remotePort}
                defaultValue={String(savedSsh?.remotePort ?? 0)}
                inputMode="numeric"
                autoComplete="off"
                error={errors.sshRemotePort}
                className={monoClassName}
              />
            </div>
          </div>
        </section>
      </div>

      {/* Aba SSL */}
      <div hidden={activeTab !== "ssl"} className={activeTab === "ssl" ? "flex flex-col gap-5" : undefined}>
        <FieldError id="cx-ssl-error">{errors.ssl}</FieldError>

        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-panel p-3.5 text-xs leading-[18px] text-muted">
          <InfoIcon className="mt-0.5 flex-none text-accent" />
          <span>{copy.ssl.notice}</span>
        </div>

        <section aria-labelledby="cx-ssl-parameters-title" className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
          <h3 id="cx-ssl-parameters-title" className="text-base leading-5 font-semibold">
            {copy.ssl.parametersTitle}
          </h3>

          <TextField
            id="cx-ssl-ca-cert"
            name="sslCaCertificatePath"
            label={copy.ssl.caCertificatePath}
            defaultValue={savedSsl?.caCertificatePath ?? ""}
            placeholder={copy.ssl.certificatePlaceholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            error={errors.sslCaCertificatePath}
            className={monoClassName}
          />

          <TextField
            id="cx-ssl-client-cert"
            name="sslClientCertificatePath"
            label={copy.ssl.clientCertificatePath}
            defaultValue={savedSsl?.clientCertificatePath ?? ""}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            error={errors.sslClientCertificatePath}
            className={monoClassName}
          />

          <TextField
            id="cx-ssl-client-key"
            name="sslClientPrivateKeyPath"
            label={copy.ssl.clientPrivateKeyPath}
            defaultValue={savedSsl?.clientKeyPath ?? ""}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            error={errors.sslClientPrivateKeyPath}
            className={monoClassName}
          />
        </section>

        <section aria-labelledby="cx-ssl-advanced-title" className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
          <h3 id="cx-ssl-advanced-title" className="text-base leading-5 font-semibold">
            {copy.ssl.advancedTitle}
          </h3>

          <div className="max-w-xs">
            <Field>
              <FieldLabel htmlFor="cx-ssl-mode">{copy.ssl.sslMode}</FieldLabel>
              <Select
                id="cx-ssl-mode"
                name="sslMode"
                value={sslMode}
                onChange={(value) => setSslMode(value as SslMode)}
                options={sslModeOptions}
                invalid={Boolean(errors.sslMode)}
              />
              <FieldError id="cx-ssl-mode-error">{errors.sslMode}</FieldError>
            </Field>
          </div>
        </section>
      </div>

      {/* Aba Proxy */}
      <div hidden={activeTab !== "proxy"} className={activeTab === "proxy" ? "flex flex-col gap-5" : undefined}>
        <FieldError id="cx-proxy-error">{errors.proxy}</FieldError>

        <section aria-labelledby="cx-proxy-socks-title" className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
          <h3 id="cx-proxy-socks-title" className="text-base leading-5 font-semibold">
            {copy.proxy.socksTitle}
          </h3>

          <div className="grid grid-cols-[1fr_120px] gap-4">
            <TextField
              id="cx-proxy-host"
              name="proxyHost"
              label={copy.proxy.host}
              defaultValue={savedProxy?.host ?? ""}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.proxyHost}
              className={monoClassName}
            />
            <TextField
              id="cx-proxy-port"
              name="proxyPort"
              label={copy.proxy.port}
              defaultValue={String(savedProxy?.port ?? 1080)}
              inputMode="numeric"
              autoComplete="off"
              error={errors.proxyPort}
              className={monoClassName}
            />
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
            <TextField
              id="cx-proxy-user-name"
              name="proxyUserName"
              label={copy.proxy.userName}
              defaultValue={savedProxy?.userName ?? ""}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.proxyUserName}
              className={monoClassName}
            />
            <TextField
              id="cx-proxy-password"
              name="proxyPassword"
              type="password"
              label={copy.proxy.password}
              defaultValue=""
              placeholder={savedProxy?.hasPassword ? copy.passwordKept : undefined}
              autoComplete="off"
              spellCheck={false}
              error={errors.proxyPassword}
            />
          </div>

          <input type="hidden" name="proxySavePassword" value={String(proxySavePassword)} />
          <label htmlFor="cx-proxy-save-password" className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              id="cx-proxy-save-password"
              type="checkbox"
              checked={proxySavePassword}
              onChange={(event) => setProxySavePassword(event.target.checked)}
              className="m-0 size-[18px] flex-none cursor-pointer accent-accent"
            />
            <span>{copy.proxy.savePassword}</span>
          </label>
        </section>
      </div>
    </>
  );
}
