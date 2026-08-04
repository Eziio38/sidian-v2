"use client";

import { Search } from "lucide-react";
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cx } from "../utils";
import { Icon } from "./icon";
import styles from "./field.module.css";

type FieldMetaProps = {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  hideLabel?: boolean;
  errorTestId?: string;
};

function useFieldIds(id: string | undefined, hint?: string, error?: string) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return {
    controlId,
    hintId,
    errorId,
    describedBy: [hintId, errorId].filter(Boolean).join(" ") || undefined,
  };
}

function FieldFrame({
  label,
  required,
  controlId,
  hint,
  hintId,
  error,
  errorId,
  className,
  hideLabel,
  errorTestId,
  children,
}: FieldMetaProps & {
  controlId: string;
  hintId?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx(styles.field, className)}>
      <label
        className={cx(styles.label, hideLabel && styles.visuallyHidden)}
        htmlFor={controlId}
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          data-testid={errorTestId}
          className={styles.error}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = FieldMetaProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required"> & {
    startAdornment?: ReactNode;
  };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id,
    label,
    hint,
    error,
    required,
    className,
    startAdornment,
    hideLabel,
    errorTestId,
    ...props
  },
  ref,
) {
  const ids = useFieldIds(id, hint, error);
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      hideLabel={hideLabel}
      errorTestId={errorTestId}
      {...ids}
    >
      <div className={styles.controlShell}>
        {startAdornment ? (
          <span className={styles.adornmentStart}>{startAdornment}</span>
        ) : null}
        <input
          ref={ref}
          id={ids.controlId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cx(
            styles.control,
            Boolean(startAdornment) && styles.withStart,
            error && styles.invalid,
          )}
          {...props}
        />
      </div>
    </FieldFrame>
  );
});

export type TextareaProps = FieldMetaProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "required">;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      id,
      label,
      hint,
      error,
      required,
      className,
      hideLabel,
      errorTestId,
      ...props
    },
    ref,
  ) {
    const ids = useFieldIds(id, hint, error);
    return (
      <FieldFrame
        id={id}
        label={label}
        hint={hint}
        error={error}
        required={required}
        className={className}
        hideLabel={hideLabel}
        errorTestId={errorTestId}
        {...ids}
      >
        <textarea
          ref={ref}
          id={ids.controlId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cx(
            styles.control,
            styles.textarea,
            error && styles.invalid,
          )}
          {...props}
        />
      </FieldFrame>
    );
  },
);

export type SearchInputProps = Omit<InputProps, "type" | "startAdornment">;

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(props, ref) {
    return (
      <Input
        ref={ref}
        type="search"
        startAdornment={<Icon icon={Search} size="sm" />}
        {...props}
      />
    );
  },
);

export type SelectProps = FieldMetaProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "required">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      id,
      label,
      hint,
      error,
      required,
      className,
      hideLabel,
      errorTestId,
      children,
      ...props
    },
    ref,
  ) {
    const ids = useFieldIds(id, hint, error);
    return (
      <FieldFrame
        id={id}
        label={label}
        hint={hint}
        error={error}
        required={required}
        className={className}
        hideLabel={hideLabel}
        errorTestId={errorTestId}
        {...ids}
      >
        <select
          ref={ref}
          id={ids.controlId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cx(
            styles.control,
            styles.select,
            error && styles.invalid,
          )}
          {...props}
        >
          {children}
        </select>
      </FieldFrame>
    );
  },
);

export type ComboboxOption = {
  value: string;
  label: string;
};

export type ComboboxProps = Omit<InputProps, "list"> & {
  options: readonly ComboboxOption[];
};

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(
  function Combobox({ options, id, ...props }, ref) {
    const generatedId = useId();
    const listId = `${id ?? generatedId}-options`;
    return (
      <>
        <Input ref={ref} id={id} list={listId} role="combobox" {...props} />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
      </>
    );
  },
);

export type DateInputProps = Omit<InputProps, "type">;

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput(props, ref) {
    return <Input ref={ref} type="date" {...props} />;
  },
);

export type ComposerProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> & {
  id?: string;
  label?: string;
  error?: string;
  hint?: string;
  hideLabel?: boolean;
  errorTestId?: string;
  endAdornment?: ReactNode;
  controlClassName?: string;
};

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer(
    {
      id,
      label = "Demande à Sidian",
      error,
      hint,
      className,
      hideLabel = false,
      errorTestId,
      endAdornment,
      controlClassName,
      ...props
    },
    ref,
  ) {
    const ids = useFieldIds(id, hint, error);
    return (
      <FieldFrame
        id={id}
        label={label}
        hint={hint}
        error={error}
        className={className}
        hideLabel={hideLabel}
        errorTestId={errorTestId}
        {...ids}
      >
        <div className={styles.controlShell}>
          <textarea
            ref={ref}
            id={ids.controlId}
            aria-invalid={error ? true : undefined}
            aria-describedby={ids.describedBy}
            className={cx(
              styles.control,
              styles.composer,
              endAdornment ? styles.composerWithEnd : undefined,
              error && styles.invalid,
              controlClassName,
            )}
            {...props}
          />
          {endAdornment ? (
            <span className={styles.adornmentEnd}>{endAdornment}</span>
          ) : null}
        </div>
      </FieldFrame>
    );
  },
);
