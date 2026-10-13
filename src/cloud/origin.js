// Service origins for optional network sharing. HTTPS everywhere except a
// development server on this computer; never a path, query or user name.
// soundroo-cloud applies the same rules (cloud-cli/internal/cloud/origin.go).

export const DEFAULT_SERVICE = 'https://soundroo.com';
export const SERVICE_ENV = 'SOUNDROO_URL';

export function isLoopback(host) {
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return name === 'localhost' || name === '::1' || /^127(?:\.\d{1,3}){3}$/.test(name);
}

export function parseOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new TypeError('The Soundroo service URL is empty.');
  let url;
  try { url = new URL(raw); } catch { throw new TypeError(`“${raw}” is not a service URL such as https://soundroo.com.`); }
  if (url.username || url.password) throw new TypeError('The service URL must not contain a user name or password.');
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) throw new TypeError('The service URL must not contain a query or fragment.');
  if (url.pathname !== '/' && url.pathname !== '') throw new TypeError('Use the service origin without a path, for example https://soundroo.com.');
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) throw new TypeError(`Plain http is allowed only for a local development server on 127.0.0.1, [::1] or localhost; use https for ${url.hostname}.`);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError(`Use an https service URL, not ${url.protocol.replace(':', '')}.`);
  // URL already lowercases the scheme and host and drops default ports.
  return url.origin;
}

// --service, then SOUNDROO_URL, then soundroo.com. The toolkit always passes
// its choice to soundroo-cloud explicitly, so both agree on one origin.
export function resolveService(flag, env = process.env) {
  return parseOrigin(flag ?? (env[SERVICE_ENV] || DEFAULT_SERVICE));
}

export function sameOrigin(origin, target) {
  try { return parseOrigin(new URL(target).origin) === origin; } catch { return false; }
}
