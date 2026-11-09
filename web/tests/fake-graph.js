// In-memory Microsoft Graph drive for the SharePoint sync tests: path-addressed
// files with eTag / cTag versions, If-Match (412), conflictBehavior=fail (409),
// folder listings and deletes — the subset sp-sync.js uses.
export function fakeGraph({ siteId = 'site-1', user = '同事' } = {}) {
  const files = new Map(); // path → { id, text, version, contentVersion, modified, by }
  let nextId = 1;
  const calls = [];
  const meta = (path, f) => ({
    id: f.id,
    name: path.split('/').pop(),
    eTag: `"${f.id},${f.version}"`,
    cTag: `"c:${f.id},${f.contentVersion}"`,
    size: f.text.length,
    lastModifiedDateTime: f.modified,
    lastModifiedBy: { user: { displayName: f.by } },
    file: {},
  });
  const json = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  function write(path, text, by = user) {
    const f = files.get(path);
    if (f) {
      f.version++;
      if (f.text !== text) f.contentVersion++;
      f.text = text;
      f.modified = new Date().toISOString();
      f.by = by;
      return f;
    }
    const created = {
      id: `item${nextId++}`,
      text,
      version: 1,
      contentVersion: 1,
      modified: new Date().toISOString(),
      by,
    };
    files.set(path, created);
    return created;
  }
  async function fetchImpl(url, opts = {}) {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url}`);
    const u = new URL(url);
    if (/\/sites\/[^/]+:\/sites\//.test(u.pathname)) return json(200, { id: siteId });
    const m = /\/drive\/root:\/(.*)$/.exec(u.pathname);
    if (!m) return json(400, { error: { message: `unexpected ${url}` } });
    let rest = m[1];
    let action = '';
    const colon = rest.lastIndexOf(':/');
    if (colon >= 0) {
      action = rest.slice(colon + 2);
      rest = rest.slice(0, colon);
    }
    const path = rest.split('/').map(decodeURIComponent).join('/');
    const ifMatch = opts.headers?.['If-Match'];
    if (action === 'children') {
      const prefix = `${path}/`;
      const value = [...files.entries()]
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([p, f]) => meta(p, f));
      return value.length || [...files.keys()].some(p => p.startsWith(prefix))
        ? json(200, { value })
        : json(404, { error: { code: 'itemNotFound' } });
    }
    const f = files.get(path);
    if (action === 'content' && method === 'GET') return f ? new Response(f.text, { status: 200 }) : json(404, {});
    if (action === 'content' && method === 'PUT') {
      if (u.searchParams.get('@microsoft.graph.conflictBehavior') === 'fail' && f)
        return json(409, { error: { code: 'nameAlreadyExists' } });
      if (ifMatch && (!f || meta(path, f).eTag !== ifMatch)) return json(412, { error: { code: 'resourceModified' } });
      return json(200, meta(path, write(path, opts.body, 'Me')));
    }
    if (method === 'DELETE') {
      if (!f) return json(404, {});
      if (ifMatch && meta(path, f).eTag !== ifMatch) return json(412, {});
      files.delete(path);
      return new Response(null, { status: 204 });
    }
    if (method === 'GET') {
      if (path === 'PA_Copper_CAD' && files.size)
        return json(200, { webUrl: 'https://example.sharepoint.com/PA_Copper_CAD' });
      return f ? json(200, meta(path, f)) : json(404, { error: { code: 'itemNotFound' } });
    }
    return json(400, {});
  }
  return { fetchImpl, files, write, calls, read: path => files.get(path)?.text ?? null };
}

export const fakeAuth = () => ({
  signedIn: true,
  init: async () => {},
  account() {
    return this.signedIn ? { name: 'Me', email: 'me@example.com' } : null;
  },
  async token() {
    if (!this.signedIn) throw Object.assign(new Error('尚未登入 Microsoft 帳號'), { auth: true });
    return 'token';
  },
  async signIn() {
    this.signedIn = true;
    return { ok: true };
  },
});

export function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}
