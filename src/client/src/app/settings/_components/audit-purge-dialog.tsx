import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { Button, Dialog, LockIcon, TextField, useToast } from "@/components/ui";

import { auditCopy } from "../_lib/audit.copy";
import { purgeAuditOrRefuse } from "../_lib/audit.service";

const copy = auditCopy.purge;

function defaultBeforeDateString(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function AuditPurgeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const userName = useQuery({ ...sessionQuery, staleTime: Infinity }).data?.userName ?? "";
  const passwordRef = useRef<HTMLInputElement>(null);

  const [beforeDate, setBeforeDate] = useState(() => defaultBeforeDateString());
  const [beforeError, setBeforeError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();

  const mutation = useMutation({
    gcTime: 0,
    mutationFn: purgeAuditOrRefuse,
    onSuccess: (result) => {
      if (passwordRef.current) passwordRef.current.value = "";
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: ["user-journal"] });
        toast.success(copy.successToast(result.data.deleted));
        onClose();
        return;
      }
      if (result.error.code === "INVALID_PASSWORD") {
        setPasswordError(copy.invalidPassword);
        passwordRef.current?.focus();
      } else if (result.error.code === "VAULT_LOCKED") {
        onClose();
      }
    },
    onError: () => {
      if (passwordRef.current) passwordRef.current.value = "";
      toast.error(copy.errorToast);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;

    const trimmedBefore = beforeDate.trim();
    const password = passwordRef.current?.value ?? "";

    let hasError = false;
    if (!trimmedBefore) {
      setBeforeError(copy.beforeRequired);
      hasError = true;
    } else {
      setBeforeError(undefined);
    }

    if (!password) {
      setPasswordError(copy.passwordRequired);
      hasError = true;
    } else {
      setPasswordError(undefined);
    }

    if (hasError) return;

    const localMidnight = new Date(`${trimmedBefore}T00:00:00`);
    const isoBefore = Number.isNaN(localMidnight.getTime())
      ? new Date(trimmedBefore).toISOString()
      : localMidnight.toISOString();

    mutation.mutate({ before: isoBefore, password });
  }

  return (
    <Dialog
      open={open}
      title={copy.title}
      description={copy.description}
      icon={<LockIcon />}
      size="sm"
      pending={mutation.isPending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" form="audit-purge-form" variant="danger" disabled={mutation.isPending}>
            {mutation.isPending ? copy.confirming : copy.confirm}
          </Button>
        </>
      }
    >
      <form id="audit-purge-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <input type="text" name="userName" autoComplete="username" value={userName} readOnly hidden />

        <TextField
          id="audit-purge-before"
          label={copy.beforeLabel}
          type="date"
          value={beforeDate}
          error={beforeError}
          onChange={(event) => {
            setBeforeDate(event.target.value);
            setBeforeError(undefined);
          }}
          disabled={mutation.isPending}
        />

        <TextField
          ref={passwordRef}
          id="audit-purge-password"
          label={copy.passwordLabel}
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          error={passwordError}
          onChange={() => setPasswordError(undefined)}
          disabled={mutation.isPending}
        />
      </form>
    </Dialog>
  );
}
