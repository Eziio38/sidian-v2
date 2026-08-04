import Image from "next/image";
import Link from "next/link";

import { cx } from "@/design-system/utils";

import styles from "./brand-lockup.module.css";

/** Asset officiel unique — ne pas substituer par SVG / full / texte. */
export const SIDIAN_LOGO_SRC = "/brand/sidian-logo.png";

/** Dimensions intrinsèques du PNG officiel (fond transparent, ratio 1:1). */
export const SIDIAN_LOGO_INTRINSIC = { width: 156, height: 156 } as const;

export type BrandLockupProps = {
  size?: "sm" | "md" | "lg";
  /** Si défini, wrappe dans un lien (ex. auth → `/`). */
  href?: string | null;
  className?: string;
  /** Priorité LCP (auth / hero). */
  priority?: boolean;
};

/**
 * Logo officiel Sidian — `public/brand/sidian-logo.png` uniquement.
 * Pas de wordmark texte, pas de SVG, proportions préservées, fond transparent.
 */
export function BrandLockup({
  size = "md",
  href = null,
  className = "",
  priority = false,
}: BrandLockupProps) {
  const image = (
    <Image
      src={SIDIAN_LOGO_SRC}
      alt="Sidian"
      width={SIDIAN_LOGO_INTRINSIC.width}
      height={SIDIAN_LOGO_INTRINSIC.height}
      {...(priority ? { priority: true } : {})}
      className={cx(styles.image, size !== "md" && styles[size])}
      sizes="(min-width: 64rem) 40px, 32px"
    />
  );

  const layout = cx(styles.lockup, className);

  if (href) {
    return (
      <Link
        href={href}
        aria-label="Sidian"
        className={cx(layout, styles.link)}
      >
        {image}
      </Link>
    );
  }

  return <span className={layout}>{image}</span>;
}
