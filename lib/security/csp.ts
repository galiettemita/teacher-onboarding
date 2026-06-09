/**
 * Content-Security-Policy with a per-request nonce.
 *
 * Next.js's App Router emits inline `<script>self.__next_f.push(…)</script>`
 * tags as part of its RSC streaming/hydration protocol. Under
 * `script-src 'self'` (no inline) the browser refuses to execute them and
 * the app loads but never hydrates — forms dead, navigation dead.
 *
 * Solution: generate a fresh nonce per request, pass it to the renderer
 * via the `x-nonce` request header (Next.js reads this and adds
 * `nonce="…"` to every inline script it emits), and include the same
 * nonce in the response CSP. `'strict-dynamic'` extends trust from the
 * nonced inline loader to the chunks it loads, so we don't need to
 * enumerate every chunk URL.
 *
 * See: https://nextjs.org/docs/app/guides/content-security-policy
 */

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Static CSP fallback used by the static `headers()` block in
 * next.config.ts for routes that never run through middleware (e.g.
 * /_next/static asset responses). Asset responses don't render HTML, so
 * inline-script directives are moot — but a CSP is still emitted.
 */
export const STATIC_FALLBACK_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * Generate a base64 nonce using Web Crypto. Available on Node, Edge, and
 * the browser. 16 bytes = 128 bits of entropy, plenty for CSP nonces
 * (which only need to be unguessable for the lifetime of one response).
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64 encode without depending on Buffer (Edge runtime).
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
