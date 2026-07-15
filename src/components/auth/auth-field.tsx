import type { InputHTMLAttributes, ReactNode } from "react";

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
  const describedBy = [
    hint ? `${id}-hint` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-nuit">
        {label}
      </label>
      {children ?? (
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-nuit shadow-sm transition-colors placeholder:text-gris-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:bg-gris-50 disabled:text-gris-500 ${
            error ? "border-red-500" : "border-gris-200"
          } ${className}`}
          {...inputProps}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-gris-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
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
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
