import type { ReactNode } from "react";

import { EyeIcon, EyeOffIcon, Field, FieldError, FieldLabel, LockIcon, Select, TextField, type Engine } from "@/components/ui";
import type { FieldErrors } from "@/lib/utils/form";

import { buildConnectionTree, folderOptions } from "../_lib/connection-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import { newVerification, verificationOf, type Connection, type Folder } from "../_lib/connections.schema";
import { environmentLookup } from "../_lib/environment";
import { inheritedInternalDescriptionsFolder } from "../_lib/internal-descriptions";
import { inheritedProtections, type ConfirmationChoice } from "../_lib/protections";
import type { UserEnvironment } from "../_lib/user-environments";
import { EnvironmentPicker } from "./environment-picker";
import { InternalDescriptionsSection } from "./internal-descriptions-section";
import { ProtectionsSection } from "./protections-section";
import { SessionSection } from "./session-section";

const copy = connectionsCopy.form;
const monoClassName = "font-mono text-sm";

type ConnectionFieldsProps = {
  /** A conexão gravada (os campos nascem com os valores dela), ou `null` para uma nova. */
  connection: Connection | null;
  folders: Folder[];
  errors: FieldErrors;
  folderID: string;
  onFolderChange: (folderID: string) => void;
  port: string;
  onPortChange: (port: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  passwordShown: boolean;
  /** O olho da senha: mostra ou esconde a digitada, ou, numa conexão gravada sem nada no campo, pede a senha do usuário (RN-CONN-002). */
  onPasswordEye: () => void;
  color: string | null;
  onColorChange: (color: string | null) => void;
  /** Os ambientes do usuário (RN-AMB-001), que a seção Ambiente oferece para reaproveitar. */
  environments?: readonly UserEnvironment[];
  /** RN-PROT-001 e 002: as proteções PRÓPRIAS da conexão, estado do diálogo (o somente leitura que muda pede a senha ao salvar, RN-PROT-003). */
  confirm: ConfirmationChoice;
  onConfirmChange: (confirm: ConfirmationChoice) => void;
  readOnly: boolean;
  onReadOnlyChange: (readOnly: boolean) => void;
  /** RN-VERIF-001: o banco escolhido (a consulta dele é a dica da consulta de verificação) e "Verificar a cada", estado do diálogo. */
  engine: Engine | null;
  verifying: boolean;
  onVerifyingChange: (verifying: boolean) => void;
  useInternalDescriptions?: boolean | null;
  onUseInternalDescriptionsChange?: (value: boolean | null) => void;
  /** RN-VERIF-003: o indicador da última verificação da conexão gravada e conectada, no painel "Sessão da conexão". */
  checkIndicator?: ReactNode;
};

/**
 * Os campos da conexão (RN-CONN-010), os mesmos da tela de Conexões de antes, no passo das configurações do diálogo: nome, pasta, host,
 * porta, banco, usuário, senha (com o olho e o aviso de que ela fica cifrada), a sessão da conexão (RN-VERIF-001), o ambiente e as proteções, na ordem de
 * leitura do canvas (a coluna da esquerda, com a sessão embaixo dos campos, e depois a da direita). O que é texto livre vai pelo `FormData` (campos não
 * controlados); a pasta, a porta (que acompanha o banco, RN-CONN-012), a senha, a cor, as proteções e a caixa da verificação são do diálogo.
 */
export function ConnectionFields({ connection, folders, errors, folderID, onFolderChange, port, onPortChange, password, onPasswordChange, passwordShown, onPasswordEye, color, onColorChange, environments = [], confirm, onConfirmChange, readOnly, onReadOnlyChange, engine, verifying, onVerifyingChange, useInternalDescriptions = null, onUseInternalDescriptionsChange, checkIndicator }: ConnectionFieldsProps) {
  const folder = folderID === "" ? null : folderID;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
        <TextField id="cx-name" name="name" label={copy.name} defaultValue={connection?.name ?? ""} autoComplete="off" error={errors.name} />

        <Field>
          <FieldLabel htmlFor="cx-folder">{copy.folder}</FieldLabel>
          <Select id="cx-folder" name="folderID" value={folderID} onChange={onFolderChange} options={folderOptions(buildConnectionTree(folders, []))} placeholder={copy.noFolder} invalid={Boolean(errors.folderID)} />
          <FieldError id="cx-folder-error">{errors.folderID}</FieldError>
        </Field>

        <TextField id="cx-host" name="host" label={copy.host} defaultValue={connection?.host ?? ""} autoComplete="off" autoCapitalize="none" spellCheck={false} error={errors.host} className={monoClassName} />

        <TextField id="cx-port" name="port" label={copy.port} value={port} onChange={(event) => onPortChange(event.target.value)} inputMode="numeric" autoComplete="off" error={errors.port} className={monoClassName} />

        <TextField id="cx-database" name="database" label={copy.database} defaultValue={connection?.database ?? ""} autoComplete="off" autoCapitalize="none" spellCheck={false} error={errors.database} className={monoClassName} />

        <TextField id="cx-user-name" name="userName" label={copy.userName} defaultValue={connection?.userName ?? ""} autoComplete="off" autoCapitalize="none" spellCheck={false} error={errors.userName} className={monoClassName} />

        <TextField
          id="cx-password"
          name="password"
          label={copy.password}
          type={passwordShown ? "text" : "password"}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder={connection?.hasPassword ? copy.passwordKept : undefined}
          autoComplete="off"
          spellCheck={false}
          error={errors.password}
          action={
            <button
              type="button"
              aria-label={passwordShown ? copy.hidePassword : copy.showPassword}
              title={passwordShown ? copy.hidePassword : copy.showPassword}
              onClick={onPasswordEye}
              className="flex size-10 flex-none cursor-pointer items-center justify-center rounded-md border border-border-strong text-ink transition-colors hover:bg-selected"
            >
              {passwordShown ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
        />

        <p className="col-span-full flex gap-2 text-xs text-muted">
          <LockIcon className="mt-px" />
          <span>{copy.passwordNotice}</span>
        </p>
      </div>

      {/* RN-VERIF-001: na conexão nova, a verificação padrão (ligada, a cada 30 segundos, com a consulta do banco). */}
      <SessionSection idPrefix="cx" engine={engine} saved={connection === null ? newVerification : verificationOf(connection)} verifying={verifying} onVerifyingChange={onVerifyingChange} indicator={checkIndicator} errors={errors} />

      {/* RN-PASTA-005: sem ambiente próprio, a conexão herda o da pasta escolhida aqui (a do campo, que pode ainda não estar gravada). */}
      <EnvironmentPicker
        idPrefix="cx"
        defaultName={connection?.environmentName ?? ""}
        color={color}
        onColorChange={onColorChange}
        errors={errors}
        hint={copy.environment.connectionHint}
        inherited={environmentLookup(folders).inheritedIn(folder)}
        environments={environments}
      />

      {/* RN-PROT-004: o que a pasta escolhida no campo impõe (antes de gravar, como o ambiente herdado), marcado e desabilitado. */}
      <ProtectionsSection idPrefix="cx" subject="connection" confirm={confirm} onConfirmChange={onConfirmChange} readOnly={readOnly} onReadOnlyChange={onReadOnlyChange} inherited={inheritedProtections(folders, folder)} errors={errors} />

      <InternalDescriptionsSection
        idPrefix="cx"
        subject="connection"
        value={useInternalDescriptions}
        onChange={(next) => onUseInternalDescriptionsChange?.(next)}
        inheritedFolder={inheritedInternalDescriptionsFolder(folders, folder)}
      />
    </div>
  );
}
