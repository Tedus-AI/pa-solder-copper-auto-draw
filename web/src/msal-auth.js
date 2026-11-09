// Microsoft sign-in for the SharePoint sync (MSAL.js loaded on demand), as in
// Thermal-Test-Report-Builder. Same Azure app as the other thermal tools.
//
// Redirect page: Azure only accepts registered redirect URIs. On
// https://tedus-ai.github.io/ this reuses the TIM tool's registered blank page
// (same origin, so MSAL here can read the popup / silent-renewal result) and no
// Azure change is needed. Anywhere else (e.g. http://localhost) the auth.html next
// to this tool is used and must be registered as an SPA redirect URI.
import { SP_CONFIG } from './sp-sync.js';

const SHARED_REDIRECT_URI = 'https://tedus-ai.github.io/Project-TIM-management-tool/auth.html';
const MSAL = {
  integrity: 'sha384-hhkHFODse2T75wPL7oJ0RZ+0CgRa74LNPhgx6wO6DMNEhU3/fSbTZdVzxsgyUelp',
  urls: [
    'https://alcdn.msauth.net/browser/2.38.2/js/msal-browser.min.js',
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.2/lib/msal-browser.min.js',
  ],
};
const mkErr = (message, props) => Object.assign(new Error(message), props || {});

export function redirectUri(loc = globalThis.location) {
  if (loc.origin === new URL(SHARED_REDIRECT_URI).origin) return SHARED_REDIRECT_URI;
  return loc.origin + loc.pathname.replace(/[^/]*$/, '') + 'auth.html';
}

function loadScript(url, integrity, ms) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const t = setTimeout(() => {
      s.remove();
      reject(new Error('timeout'));
    }, ms);
    s.src = url;
    s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.onload = () => {
      clearTimeout(t);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(t);
      s.remove();
      reject(new Error('load failed'));
    };
    document.head.appendChild(s);
  });
}
async function loadMsal() {
  if (window.msal) return window.msal;
  for (const url of MSAL.urls) {
    try {
      await loadScript(url, MSAL.integrity, 20000);
      if (window.msal) return window.msal;
    } catch {
      /* next mirror */
    }
  }
  throw mkErr('無法載入 Microsoft 登入元件（請確認網路連線）');
}

export class MsalAuth {
  constructor(config = SP_CONFIG) {
    this.config = config;
    this.pca = null;
    this.initP = null;
    this.current = null;
  }
  init() {
    if (this.pca) return Promise.resolve(this.pca);
    if (this.initP) return this.initP;
    this.initP = (async () => {
      const msal = await loadMsal();
      const app = new msal.PublicClientApplication({
        auth: { clientId: this.config.clientId, authority: this.config.authority, redirectUri: redirectUri() },
        cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
      });
      if (typeof app.initialize === 'function') await app.initialize();
      try {
        const r = await app.handleRedirectPromise();
        if (r?.account) this.current = r.account;
      } catch {
        /* no redirect in progress */
      }
      if (!this.current) this.current = app.getAllAccounts()[0] ?? null;
      this.pca = app;
      return app;
    })();
    this.initP.catch(() => {
      this.initP = null;
    });
    return this.initP;
  }
  account() {
    const a = this.current;
    return a ? { name: a.name || a.username || '', email: a.username || '' } : null;
  }
  async token(interactive) {
    await this.init();
    if (!this.current) throw mkErr('尚未登入 Microsoft 帳號', { auth: true });
    try {
      return (await this.pca.acquireTokenSilent({ scopes: this.config.scopes, account: this.current })).accessToken;
    } catch {
      if (!interactive) throw mkErr('Microsoft 登入已過期，請重新登入', { auth: true });
      const r = await this.pca.acquireTokenPopup({ scopes: this.config.scopes, account: this.current });
      if (r.account) this.current = r.account;
      return r.accessToken;
    }
  }
  /** Click handler. opts.select: always let the user choose the account. */
  async signIn(opts) {
    try {
      await this.init();
    } catch (error) {
      return { ok: false, reason: 'error', error: error.message };
    }
    if (this.current && !opts?.select) {
      try {
        await this.token(true);
        return { ok: true };
      } catch {
        /* popup below */
      }
    }
    try {
      const r = await this.pca.loginPopup({ scopes: this.config.scopes, prompt: 'select_account' });
      this.current = r.account;
      return { ok: true };
    } catch (error) {
      const code = error?.errorCode || '';
      if (['user_cancelled', 'popup_window_error', 'interaction_in_progress'].includes(code))
        return { ok: false, reason: code === 'popup_window_error' ? 'popup' : 'cancelled' };
      return { ok: false, reason: 'error', error: error?.message || String(error) };
    }
  }
}
