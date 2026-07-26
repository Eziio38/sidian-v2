/**
 * Échappement HTML déterministe — injection-safe pour variables utilisateur.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Texte brut : retire contrôles / null bytes, normalise les sauts de ligne.
 */
export function sanitizePlainText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

const HTTPS_URL_RE =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[^\s]*)?$/i;

/**
 * URLs de paiement / actions uniquement en https, longueur bornée.
 */
export function assertSafeHttpsUrl(label: string, raw: string): string {
  const url = raw.trim();
  if (
    url.length < 12 ||
    url.length > 2048 ||
    !HTTPS_URL_RE.test(url) ||
    /[<>"']/.test(url) ||
    url.toLowerCase().includes("javascript:")
  ) {
    throw new Error(`email_url_rejected:${label}`);
  }
  return url;
}
