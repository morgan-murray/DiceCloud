export function normalizeBasePath(value = '') {
  if (typeof value !== 'string') throw new Error('Base path must be a string');
  if (!value || value === '/') return '/';
  if (!value.startsWith('/') || value.includes('//') || /[?#\\\s%]/.test(value)) {
    throw new Error('Base path must be an absolute URL path without query, fragment or escaped separators');
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || !/^[a-zA-Z0-9._~-]+$/.test(part))) {
    throw new Error('Base path contains an invalid segment');
  }
  return '/' + parts.join('/') + '/';
}

export function rootConfiguration(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('ROOT_URL must be an absolute HTTP(S) URL'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('ROOT_URL must use HTTP(S), with no credentials, query or fragment');
  }
  const rawPath = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(value)?.[1] || '/';
  const basePath = normalizeBasePath(rawPath);
  return { rootUrl: url.origin + basePath, basePath, prefix: basePath.slice(0, -1) };
}

export function withBasePath(path = '', base = '/') {
  if (typeof path !== 'string') throw new Error('URL path must be a string');
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) return path;
  const normalized = normalizeBasePath(base);
  const prefix = normalized.slice(0, -1);
  if (prefix && (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'))) return path;
  return normalized + path.replace(/^\//, '');
}

export function accountLink(rootUrl, kind, token) {
  const routes = { resetPassword: 'reset-password', enrollAccount: 'reset-password', verifyEmail: 'verify-email' };
  if (!routes[kind]) throw new Error('Unknown account link type');
  return rootConfiguration(rootUrl).rootUrl + routes[kind] + '/' + encodeURIComponent(token);
}

export function characterApiUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Invalid character URL');
  const match = /^(.*?)\/character\/([^/]+)(?:\/[^/]*)?\/?$/.exec(url.pathname);
  if (!match) throw new Error('Not a character URL');
  url.pathname = match[1] + '/api/creature/' + match[2];
  url.search = ''; url.hash = '';
  return url.href;
}
