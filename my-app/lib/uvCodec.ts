/**
 * Ultraviolet XOR URL codec (matches @titaniumnetwork-dev/ultraviolet default).
 */

const XOR_KEY = 3;

export function encodeUvUrl(input: string): string {
  const encoded = input
    .split("")
    .map((char) => String.fromCharCode(char.charCodeAt(0) ^ XOR_KEY))
    .join("");
  return encodeURIComponent(encoded);
}

export function decodeUvUrl(input: string): string {
  const decoded = decodeURIComponent(input)
    .split("")
    .map((char) => String.fromCharCode(char.charCodeAt(0) ^ XOR_KEY))
    .join("");
  return decoded;
}

export function normalizeTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL is required");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function buildProxiedPath(targetUrl: string): string {
  const encoded = encodeUvUrl(normalizeTargetUrl(targetUrl));
  return `/uv/service/${encoded}`;
}
