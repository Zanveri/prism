import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AlertIcon, Button, Dialog, Field, FieldLabel, FormMessage, Input, PackageIcon, RefreshIcon, Segmented, segmentedItem, StatusBadge, TrashIcon } from "@/components/ui";
import { ApiRequestError, unwrap } from "@/lib/api/prism-api";
import { type PluginItem, type PluginSourceKind } from "@/lib/plugins/plugins.schema";
import {
  installPlugin,
  pluginBundlesKey,
  pluginsKey,
  pluginsQuery,
  removePlugin,
  setPluginConsent,
  setPluginEnabled,
  updatePlugin,
} from "@/lib/plugins/plugins.service";

import { settingsCopy } from "../_lib/settings.copy";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.plugins;

function errorMessageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.error.detail || error.error.title || error.message;
  if (error instanceof Error) return error.message;
  return "Não foi possível concluir a operação.";
}

export function PluginsSection({ anchor }: { anchor: string }) {
  const queryClient = useQueryClient();
  const state = useQuery(pluginsQuery);

  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [sourceKind, setSourceKind] = useState<PluginSourceKind>("git");
  const [sourceInput, setSourceInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function invalidatePlugins() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pluginsKey }),
      queryClient.invalidateQueries({ queryKey: pluginBundlesKey }),
      queryClient.invalidateQueries({ queryKey: ["plugin-table-enrichment"] }),
    ]);
  }

  const consentMutation = useMutation({
    mutationFn: async (consented: boolean) => unwrap(await setPluginConsent(consented)),
    onSuccess: async (nextState) => {
      queryClient.setQueryData(pluginsKey, nextState);
      setDisclaimerOpen(false);
      setDisclaimerAccepted(false);
      setActionError(null);
      await invalidatePlugins();
    },
    onError: (err) => setActionError(errorMessageOf(err)),
  });

  const installMutation = useMutation({
    mutationFn: async () => unwrap(await installPlugin({ sourceKind, source: sourceInput.trim() })),
    onSuccess: async () => {
      setSourceInput("");
      setActionError(null);
      await invalidatePlugins();
    },
    onError: (err) => setActionError(errorMessageOf(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => unwrap(await setPluginEnabled(id, enabled)),
    onSuccess: async () => {
      setActionError(null);
      await invalidatePlugins();
    },
    onError: (err) => setActionError(errorMessageOf(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) => unwrap(await updatePlugin(id)),
    onSuccess: async () => {
      setActionError(null);
      await invalidatePlugins();
    },
    onError: (err) => setActionError(errorMessageOf(err)),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => unwrap(await removePlugin(id)),
    onSuccess: async () => {
      setActionError(null);
      await invalidatePlugins();
    },
    onError: (err) => setActionError(errorMessageOf(err)),
  });

  function onInstallSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sourceInput.trim() === "" || installMutation.isPending) return;
    installMutation.mutate();
  }

  const consented = state.data?.consented ?? false;
  const items: PluginItem[] = state.data?.items ?? [];

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <p className="max-w-[68ch] text-muted">{copy.subtitle}</p>

      {actionError ? <FormMessage tone="error">{actionError}</FormMessage> : null}

      {!consented ? (
        <div className="flex flex-col gap-3 rounded-md border border-border-strong bg-raised p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="warning">{copy.restrictedBadge}</StatusBadge>
          </div>
          <p className="max-w-[68ch] text-sm text-muted">{copy.restrictedNote}</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDisclaimerAccepted(false);
                setDisclaimerOpen(true);
              }}
            >
              {copy.enableButton}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-raised px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-body">
              <PackageIcon />
              <span>Plugins de terceiros liberados neste cofre.</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={consentMutation.isPending}
              onClick={() => consentMutation.mutate(false)}
            >
              {copy.disableButton}
            </Button>
          </div>

          <form onSubmit={onInstallSubmit} className="flex flex-col gap-3 rounded-md border border-border bg-raised p-4">
            <h3 className="text-sm font-semibold">{copy.installTitle}</h3>

            <Segmented aria-label={copy.installTitle}>
              <button
                type="button"
                aria-pressed={sourceKind === "git"}
                className={segmentedItem({ active: sourceKind === "git" })}
                onClick={() => setSourceKind("git")}
              >
                {copy.sourceKindGit}
              </button>
              <button
                type="button"
                aria-pressed={sourceKind === "local"}
                className={segmentedItem({ active: sourceKind === "local" })}
                onClick={() => setSourceKind("local")}
              >
                {copy.sourceKindLocal}
              </button>
            </Segmented>

            <Field>
              <FieldLabel htmlFor={`${anchor}-source`}>
                {sourceKind === "git" ? copy.sourceKindGit : copy.sourceKindLocal}
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={`${anchor}-source`}
                  value={sourceInput}
                  onChange={(event) => setSourceInput(event.target.value)}
                  placeholder={sourceKind === "git" ? copy.gitPlaceholder : copy.localPlaceholder}
                  className="min-w-[260px] flex-1 font-mono text-xs"
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={sourceInput.trim() === "" || installMutation.isPending}
                >
                  {installMutation.isPending ? copy.installingButton : copy.installButton}
                </Button>
              </div>
              <p className="text-xs text-muted">{sourceKind === "git" ? copy.gitHint : copy.localHint}</p>
            </Field>
          </form>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">{copy.installedTitle}</h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted">{copy.emptyList}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {items.map((plugin) => {
                  const updatingThis = updateMutation.isPending && updateMutation.variables === plugin.id;
                  const togglingThis = toggleMutation.isPending && toggleMutation.variables?.id === plugin.id;
                  const removingThis = removeMutation.isPending && removeMutation.variables === plugin.id;

                  return (
                    <li
                      key={plugin.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-raised p-3.5"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{plugin.name}</span>
                          <StatusBadge tone="neutral">v{plugin.version}</StatusBadge>
                          <StatusBadge tone={plugin.enabled ? "success" : "neutral"}>
                            {plugin.enabled ? copy.enabledLabel : copy.disabledLabel}
                          </StatusBadge>
                          <StatusBadge tone="neutral">{plugin.sourceKind === "git" ? "Git" : "Local"}</StatusBadge>
                        </div>
                        {plugin.description ? <p className="text-sm text-body">{plugin.description}</p> : null}
                        {!plugin.available && plugin.errorMessage ? (
                          <p className="text-xs text-danger">{plugin.errorMessage}</p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          <span className="font-mono">{plugin.id}</span>
                          {plugin.author ? <span>por {plugin.author}</span> : null}
                          <span className="truncate font-mono" title={plugin.source}>
                            {plugin.source}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={togglingThis}
                          onClick={() => toggleMutation.mutate({ id: plugin.id, enabled: !plugin.enabled })}
                        >
                          {plugin.enabled ? "Desativar" : "Ativar"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={updatingThis}
                          onClick={() => updateMutation.mutate(plugin.id)}
                          title={copy.updateButton}
                        >
                          <RefreshIcon />
                          <span>{updatingThis ? copy.updatingButton : copy.updateButton}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={removingThis}
                          onClick={() => removeMutation.mutate(plugin.id)}
                          title={copy.removeButton}
                        >
                          <TrashIcon />
                          <span>{copy.removeButton}</span>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={disclaimerOpen}
        title={copy.disclaimerTitle}
        icon={<AlertIcon />}
        size="md"
        pending={consentMutation.isPending}
        onClose={() => setDisclaimerOpen(false)}
        footer={
          <>
            <Button type="button" variant="ghost" disabled={consentMutation.isPending} onClick={() => setDisclaimerOpen(false)}>
              {copy.disclaimerCancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!disclaimerAccepted || consentMutation.isPending}
              onClick={() => consentMutation.mutate(true)}
            >
              {copy.disclaimerConfirm}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-body">
          <p>{copy.disclaimerParagraph1}</p>
          <p className="text-muted">{copy.disclaimerParagraph2}</p>
          <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-md border border-border-strong bg-panel p-3">
            <input
              type="checkbox"
              checked={disclaimerAccepted}
              onChange={(event) => setDisclaimerAccepted(event.target.checked)}
              className="mt-0.5 size-4 accent-accent"
            />
            <span className="font-medium text-ink">{copy.disclaimerCheckbox}</span>
          </label>
        </div>
      </Dialog>
    </SettingsCard>
  );
}
