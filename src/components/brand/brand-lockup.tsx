import Link from "next/link";

export type BrandLockupProps = {
  /** Fond sombre / clair : mark bleu DS par défaut ; white si fond chargé. */
  variant?: "blue" | "white";
  /** Taille du mark en px (min DS = 20). */
  size?: number;
  compact?: boolean;
  /** Si défini, wrappe dans un lien (ex. auth → `/`). */
  href?: string | null;
  /** Classe du wordmark. Si omise : Outfit ExtraBold 14px (DS). */
  wordmarkClassName?: string;
  className?: string;
};

const MARK_SRC = {
  blue: "/brand/sidian-mark-blue.svg",
  white: "/brand/sidian-mark-white.svg",
} as const;

/**
 * Lockup officiel : mark interim SVG (`public/brand/`) + « Sidian » Outfit ExtraBold.
 * Wordmark = texte rendu, jamais une image. Remplacer les SVG par PNG DS quand dispo.
 */
export function BrandLockup({
  variant = "blue",
  size = 18,
  compact = false,
  href = null,
  wordmarkClassName,
  className = "",
}: BrandLockupProps) {
  const defaultWordmark = compact
    ? "text-[14px] font-semibold tracking-tight text-inherit"
    : "text-[14px] font-extrabold tracking-[-0.02em] text-inherit";
  const wordmarkClass = wordmarkClassName ?? defaultWordmark;

  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG interim brand ; PNG DS à venir */}
      <img
        src={MARK_SRC[variant]}
        alt=""
        width={size}
        height={size}
        className="shrink-0"
        aria-hidden
      />
      <span className={wordmarkClass}>Sidian</span>
    </>
  );

  const layout = `inline-flex items-center gap-2 ${className}`;

  if (href) {
    return (
      <Link
        href={href}
        className={`${layout} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue`}
      >
        {inner}
      </Link>
    );
  }

  return <span className={layout}>{inner}</span>;
}
