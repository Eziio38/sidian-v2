import type { InputHTMLAttributes, ReactNode } from "react";

import { Input } from "@/design-system";

type AuthFieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>;

export function AuthField({
  id,
  label,
  error,
  hint,
  children,
  className = "",
  ...inputProps
}: AuthFieldProps) {
  if (children) return <>{children}</>;

  return (
    <Input
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={className}
      {...inputProps}
    />
  );
}

type AuthCheckboxFieldProps = {
  id: string;
  label: ReactNode;
  error?: string;
  defaultChecked?: boolean;
  name: string;
  value?: string;
};

export function AuthCheckboxField({
  id,
  label,
  error,
  defaultChecked,
  name,
  value = "on",
}: AuthCheckboxFieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          value={value}
          defaultChecked={defaultChecked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1 h-4 w-4 rounded border-gris-200 text-sidian-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        />
        <label htmlFor={id} className="text-sm leading-relaxed text-gris-500">
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
