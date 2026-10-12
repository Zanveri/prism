import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { fieldAria } from "@/lib/utils/form";

import { Field, FieldLabel, Input } from "./field";
import { FieldError } from "./form-message";

export type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  /** Liga o rótulo ao campo e a mensagem de erro (`<id>-error`) a ele. */
  id: string;
  label: ReactNode;
  /** A mensagem do campo recusado; ausente, o campo está bem. */
  error?: string;
  /** Um botão ao lado do campo, como o olho da senha. */
  action?: ReactNode;
};

/** Rótulo, campo e erro de um campo de texto, com a fiação de `aria-invalid` e `aria-describedby` feita num lugar só. */
export function TextField({ id, label, error, action, className, ...props }: TextFieldProps) {
  const input = <Input id={id} className={cn(action !== undefined && "min-w-0 flex-1", className)} {...fieldAria(id, error)} {...props} />;

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {action === undefined ? (
        input
      ) : (
        <div className="flex gap-2">
          {input}
          {action}
        </div>
      )}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
