"use client";

import { LoaderCircle, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
} from "react";

import { cx } from "../utils";
import { Icon } from "./icon";
import styles from "./button.module.css";
import loadingStyles from "./loading.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link"
  | "floating";
export type ButtonSize = "sm" | "md" | "lg";

type SharedButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: "start" | "end";
  loading?: boolean;
  loadingLabel?: string;
};

export type ButtonProps = SharedButtonProps &
  ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      variant = "primary",
      size = "md",
      icon,
      iconPosition = "start",
      loading,
      loadingLabel = "Chargement…",
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) {
    const isLoading = loading === true;
    /*
      Une région live n'est montée que pour les boutons qui pilotent réellement
      un état de chargement (ceux dont l'appelant passe `loading`, fût-il
      `false`). Sans ce filtrage, chaque bouton de l'écran ajoutait une région
      `role="status"` vide à l'arbre d'accessibilité — une dizaine par page.
    */
    const announcesLoading = loading !== undefined;

    const leadingIcon =
      icon && iconPosition === "start" ? <Icon icon={icon} size="sm" /> : null;
    const trailingIcon =
      icon && iconPosition === "end" ? <Icon icon={icon} size="sm" /> : null;

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={cx(
          styles.base,
          styles[variant],
          size !== "md" && styles[size],
          isLoading && styles.loading,
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <Icon
            icon={LoaderCircle}
            size="sm"
            className={loadingStyles.spinnerIcon}
          />
        ) : (
          leadingIcon
        )}
        {/*
          `aria-busy` n'est restitué par aucun lecteur d'écran courant : sans
          région live, tous les états de chargement du produit sont muets. Le
          libellé visible est masqué de l'arbre d'accessibilité pendant le
          chargement pour ne pas doubler l'annonce, et c'est la région live —
          montée dès le premier rendu du bouton concerné, car un `role="status"`
          ajouté au moment de la mutation n'est pas annoncé — qui porte le
          libellé.
        */}
        <span
          aria-hidden={isLoading || undefined}
          className={isLoading ? styles.loadingLabel : undefined}
        >
          {isLoading ? loadingLabel : children}
        </span>
        {announcesLoading ? (
          <span role="status" className={styles.status}>
            {isLoading ? loadingLabel : ""}
          </span>
        ) : null}
        {isLoading ? null : trailingIcon}
      </button>
    );
  },
);

export type ButtonLinkProps = SharedButtonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    loading?: never;
    loadingLabel?: never;
  };

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    {
      children,
      className,
      variant = "primary",
      size = "md",
      icon,
      iconPosition = "start",
      "aria-disabled": ariaDisabled,
      onClick,
      ...props
    },
    ref,
  ) {
    const isDisabled = ariaDisabled === true || ariaDisabled === "true";
    return (
      <a
        ref={ref}
        aria-disabled={isDisabled || undefined}
        tabIndex={isDisabled ? -1 : props.tabIndex}
        className={cx(
          styles.base,
          styles[variant],
          size !== "md" && styles[size],
          className,
        )}
        onClick={(event) => {
          if (isDisabled) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        {...props}
      >
        {icon && iconPosition === "start" ? (
          <Icon icon={icon} size="sm" />
        ) : null}
        {children}
        {icon && iconPosition === "end" ? (
          <Icon icon={icon} size="sm" />
        ) : null}
      </a>
    );
  },
);

export type IconButtonProps = Omit<ButtonProps, "children" | "icon"> & {
  icon: LucideIcon;
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, className, size = "md", variant = "ghost", ...props },
    ref,
  ) {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        aria-label={label}
        className={cx(
          styles.icon,
          size === "sm" && styles.iconSm,
          size === "lg" && styles.iconLg,
          variant === "floating" && styles.floating,
          className,
        )}
        {...props}
      >
        <Icon icon={icon} size={size === "lg" ? "md" : "sm"} />
      </Button>
    );
  },
);
