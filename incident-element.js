// OAUTH2 vars to be used later
const OAUTH2 = {
  clientId: 'id-ccd397bf-6b1b-23d5-d6dd-63dc49c2c96a',
  authorizeUrl: 'http://localhost:8080/o/oauth2/authorize',
  tokenUrl: 'http://localhost:8080/o/oauth2/token',
  redirectUri: new URL('/web/incident-reporting-tool/callback', window.location.origin).toString(),
  scopes: [
    'Liferay.Headless.Admin.User.everything',
    'Liferay.Headless.Admin.User.everything.write',
    'Liferay.Headless.Admin.User.everything.read',
    'c_incident.everything'
  ].join(' ')
};

// Generate a random PKCE code verifier
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Helper to remove the local storage variables (used for explicit sign-out)
function clearAuthState() {
    try {

      for(let i = localStorage.length - 1; i>= 0; i--){
        const key = localStorage.key(i);
        if (key && key.startsWith('oauth_access_token_')){
          localStorage.removeItem(key);
        }
      }

      localStorage.removeItem('oauth_access_token');
      localStorage.removeItem('oauth_owner');
      localStorage.removeItem('pkce_verifier');
      localStorage.removeItem('pkce_state');

      sessionStorage.removeItem('oauth_in_progress');
      sessionStorage.removeItem('oauth_completed_at');

      if('BroadcastChannel' in window) new BroadcastChannel('incident-auth').postMessage('signed-out');
      else localStorage.setItem('incident-auth-signal', `signed-out:${Date.now()}`);
    } catch (e) { console.warn('clearAuthState failed', e);}
}

// Generate a code challenge from the verifier
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(digest));
  const base64 = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return base64;
}

function getAccessToken() {
  try {
    const owner = localStorage.getItem('oauth_owner');
    
    if (owner) {
      const t = localStorage.getItem(`oauth_access_token_${owner}`);
      return t ? t.trim() : null;
    }

    const generic = local.getItem('oauth_access_token');
    if (generic) return generic.trim();

    return null;
  } catch (e) {
    console.warn('getAccessToken error', e);
    return null;
  }
}

// Global helper to call element.startPkceAuth safely
window.startPkceAuth = () => {
  const el = document.querySelector('incident-element');
  if (el && typeof el.startPkceAuth === 'function') {
    console.log('window.startPkceAuth: invoking element.startPkceAuth()');
    el.startPkceAuth();
  } else {
    console.warn('window.startPkceAuth: incident-element not found or method missing');
  }
};

async function apiFetch(url, opts = {}) {
  const token = getAccessToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');

  const res = await fetch(url, { ...opts, headers });

  if (!res.ok) {
    const www = res.headers.get('www-authenticate');
    console.warn(`apiFetch: ${url} returned ${res.status}`, { www, authHeader: token ? `Bearer ${token.slice(0,8)}...` : '<none>' });
    // If unauthorized, clear token and PKCE artifacts so UI can't rely on a bad value
    if (res.status === 401) {
      try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
      try { localStorage.removeItem('oauth_owner'); } catch (e) {}
      // Do not remove pkce_verifier/state here — callback must be able to read them if in progress
    }
  }
  return res;
}

class IncidentElement extends HTMLElement {
  constructor() {
    super();
    this.expandedIds = new Set();
    this.currentPage = 0;
    this.pageSize = 5;
    this.allItems = [];
    this.searchQuery = "";
    this.searchDebounceTimer = null;
    this.editAccessCache = new Map();
    this._uiUpdateTimer = null;
  }

  _isActionsEditable(actions = {}) {
    const editKeys = ['update','edit','modify','patch','put','UPDATE','EDIT','update_entry','edit_entry'];
    return editKeys.some(k => Object.prototype.hasOwnProperty.call(actions, k));
  }

  async handleCallback(){
      try {
        const completedAt = Number(sessionStorage.getItem('oauth_completed_at') || 0);
        if (Date.now() - completedAt < 5000){
          history.replaceState(null, '', '/web/incident-reporting-tool/');
          return;
        }
        const url = new URL(location.href);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const verifier = localStorage.getItem('pkce_verifier');
        const savedState = localStorage.getItem('pkce_state')
        
        
        if (!code || !state || !verifier || !savedState || state !== savedState) {
          // invalid callback: cleanup and return to app
          try { localStorage.removeItem('pkce_verifier'); localStorage.removeItem('pkce_state'); } catch (e) {}
          try { sessionStorage.removeItem('oauth_in_progress'); } catch (e) {}
          history.replaceState(null, '', '/web/incident-reporting-tool/');
          return;
        }

        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: OAUTH2.redirectUri,
          client_id: OAUTH2.clientId,
          code_verifier: verifier
        }).toString();

        const tokenRes = await fetch(OAUTH2.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body,
          mode: 'cors'
        });

        if (!tokenRes.ok) {
          try { sessionStorage.removeItem('oauth_in_progress'); } catch (e) {}
          history.replaceState(null, '', '/web/incident-reporting-tool/');
          return;
        }

        const tokenJson = await tokenRes.json();
        const token = tokenJson && tokenJson.access_token;
        if (!token) {
          try { sessionStorage.removeItem('oauth_in_progress'); } catch (e) {}
          history.replaceState(null, '', '/web/incident-reporting-tool/');
          return;
        }

        // Try to resolve owner id with the new token
        let uid = null;
        try {
          const meRes = await fetch('/o/headless-admin-user/v1.0/my-user-account', {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            credentials: 'same-origin'
          });
          if (meRes.ok) {
            const me = await meRes.json();
            uid = String(me.id || me.userId || '') || null;
          }
        } catch (e) { /* ignore */ }

      // Persist token keyed by owner when possible, and clean up others
      try {
        // Remove any generic token and any other owner tokens to avoid stale tokens
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('oauth_access_token_')) {
            localStorage.removeItem(k);
          }
        }
        localStorage.removeItem('oauth_access_token');

        if (uid) {
          localStorage.setItem(`oauth_access_token_${uid}`, token);
          localStorage.setItem('oauth_owner', uid);
        } else {
          // If we couldn't resolve owner, store as generic but do NOT set oauth_owner
          localStorage.setItem('oauth_access_token', token);
          localStorage.removeItem('oauth_owner');
        }
      } catch (e) {
        console.warn('persist token failed', e);
      }
    } catch (e) {}
  }
  

  async connectedCallback() {
    // in connectedCallback: replace the probe block with this simple guard
    const callbackPath = new URL(OAUTH2.redirectUri).pathname;
    const urlParams = new URL(window.location.href).searchParams;
    const hasCode = urlParams.has('code');

    if (location.pathname === callbackPath && hasCode) {
      // run the callback handler and stop further startup logic for this run
      await this.handleCallback();
      return;
    }

    this.innerHTML = `
      <style>
      .incident-entry { padding: 0.75em 0; border-bottom: 1px solid #ccc; }
      .comment-body { margin-top: 0.25em; padding-left: 1em; font-size: 1em; }
      .comment-title { font-size: 1em; font-weight: bold; }
      .incident-title { font-size: 1.1em; font-weight: bold; margin-bottom: 0.5em; }
      h2.incident-title-header { background-color: rgb(45, 90, 171); color: white; padding: 0.31em; border-radius: 0.25em; }
      .incident-description { margin-top: 0.5em; }
      .incident-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5em 1em; }
      .incident-grid div { display: flex; flex-direction: column; }
      .toggle-link { cursor: pointer; color: #007bff; text-decoration: none; }
      .pagination { margin-top: 1em; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
      .page-number { margin: 0 0.25em; padding: 0.4em 0.8em; background: #f0f0f0; border: 1px solid #ccc; cursor: pointer; }
      .active-page { background: #007bff; color: white; font-weight: bold; }
      .page-size-select { margin-left: 1em; }
      .search-bar { margin-bottom: 1em; }
      #search-input { width: 100%; padding: 0.5em; font-size: 1em; border: 1px solid #ccc; border-radius: 4px; }
      .incident-comments .comment { margin-top: 0.25em; font-size: 0.9em; }
      .comments-separator { margin: 0.75em 0; border: 0; border-top: 1px solid #ccc; }
      .comment-header{ font-size: 1.1em; font-weight: bold; margin-bottom: 0.5em; text-decoration: underline; }
      </style>
      <h2 class="incident-title-header">Incident List</h2>
      <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search"/>
      </div>
      <div id="incident-list"></div>
    `;

  
    this.querySelector("#search-input").addEventListener("input", (e) => {
      this.searchQuery = e.target.value;
      this.currentPage = 0;
      this.renderList();
    });

    // Debounced initial refresh
    if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
    this._uiUpdateTimer = setTimeout(() => {
      this._uiUpdateTimer = null;
      this.refreshAuthState();
    }, 250);

    if (!getAccessToken()) {
      this._cachedUserRoles = [];
    }

    // Listen for oauth token events (callback will dispatch)
    window.addEventListener('oauth:token', () => {
      if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
      this._uiUpdateTimer = setTimeout(() => {
        this._uiUpdateTimer = null;
        this.refreshAuthState();
      }, 250);
    });

    window.addEventListener('focus', () => {
      // small debounce
      if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
      this._uiUpdateTimer = setTimeout(() => {
        this._uiUpdateTimer = null;
        console.log('Window focused — rechecking auth state');
        this.refreshAuthState();
      }, 200);
    });
  

    // Cross-tab propagation
    try {
      if ('BroadcastChannel' in window) {
        this._bc = new BroadcastChannel('incident-auth');
        this._bc.onmessage = (ev) => {
          if (ev.data === 'signed-in' || ev.data === 'signed-out') {
            console.log('BroadcastChannel auth event', ev.data);
            if (ev.data === 'signed-out') {
              try { sessionStorage.removeItem('active_user_id'); } catch (e) {}
            }
            if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
            this._uiUpdateTimer = setTimeout(() => {
              this._uiUpdateTimer = null;
              this.refreshAuthState();
            }, 250);
          }
        };
      } else {
        window.addEventListener('storage', (e) => {
        if (!e) return;
        if (e.key === 'incident-auth-signal') {
          // signal format: "signed-in:ts" or "signed-out:ts"
          console.log('incident-auth-signal', e.newValue);
          if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
          this._uiUpdateTimer = setTimeout(() => { this._uiUpdateTimer = null; this.refreshAuthState(); }, 250);
          return;
        }
        if (e.key === 'oauth_access_token' || (e.key && e.key.startsWith('oauth_access_token_')) || e.key === 'oauth_owner') {
          if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
          this._uiUpdateTimer = setTimeout(() => { this._uiUpdateTimer = null; this.refreshAuthState(); }, 250);
        }
      });
      }
    } catch (e) {
      console.warn('Cross-tab auth propagation setup failed', e);
    }
  }

  async loadData() {
    const res = await apiFetch("/o/c/incidents?nestedFields=commentOnIncident");
    if (!res.ok) {
      console.warn('loadData: incidents fetch failed', res.status);
      if (res.status === 401) {
        if (!getAccessToken() && !sessionStorage.getItem('oauth_in_progress')) {
          sessionStorage.setItem('oauth_in_progress', String(Date.now()));
          console.log('No token and 401 received — initiating PKCE authorize');
          await this.startPkceAuth();
          return;
        }
        await this.loadDataAnonymous();
        return;
      }
      this.querySelector("#incident-list").innerHTML = "<p>Error loading incidents</p>";
      return;
    }

    const data = await res.json();
    this.allItems = data.items || [];
    this.renderList();
  }

  async refreshAuthState() {
    const token = getAccessToken();

      const storedOwner = localStorage.getItem('oauth_owner');

      if (storedOwner && storedOwner !== currentUserId) {
        console.warn('refreshAuthState: token owner mismatch; clearing tokens for other owners', storedOwner, currentUserId);

        // Remove any oauth_access_token_<other> entries to avoid stale tokens
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('oauth_access_token_') && k !== `oauth_access_token_${currentUserId}`) {
            try { localStorage.removeItem(k); } catch (e) {}
          }
        }

        // Remove generic token to avoid ambiguity
        try { localStorage.removeItem('oauth_access_token'); } catch (e) {}

        // Ensure owner is set to the current user
        try { localStorage.setItem('oauth_owner', currentUserId); } catch (e) {}

        // Show anonymous view while we re-evaluate
        this._cachedUserRoles = [];
        await this.loadDataAnonymous();
        return;
      }

      // Ensure owner is set to the current user (idempotent)
      try { localStorage.setItem('oauth_owner', currentUserId); } catch (e) {}

    // Respect in-progress flows
    const inProgress = Number(sessionStorage.getItem('oauth_in_progress') || '0');
    if (inProgress) {
      const started = Number(inProgress) || 0;
      if (Date.now() - started < 30 * 1000) {
        console.log('refreshAuthState: auth in progress elsewhere; showing anonymous view');
        this._cachedUserRoles = [];
        await this.loadDataAnonymous();
        return;
      } else {
        sessionStorage.removeItem('oauth_in_progress');
      }
    }

    if (!token) {
      const completedAt = Number(sessionStorage.getItem('oauth_completed_at') || '0');
      const now = Date.now();
      const COMPLETED_GRACE_MS = 10 * 1000; // short grace window

      if (now - completedAt < COMPLETED_GRACE_MS) {
        console.log('refreshAuthState: recent completion detected; showing anonymous view for now');
        this._cachedUserRoles = [];
        await this.loadDataAnonymous();
        return;
      }

      // Not completed recently and no token — start PKCE (but avoid storms)
      if (!sessionStorage.getItem('oauth_in_progress')) {
        console.log('refreshAuthState: no token and no recent completion — initiating PKCE');
        try { sessionStorage.setItem('oauth_in_progress', String(Date.now())); } catch (e) {}
        await this.startPkceAuth();
        return;
      }

      // If in_progress exists but stale, clear and start
      const inProgTs = Number(sessionStorage.getItem('oauth_in_progress') || '0');
      if (Date.now() - inProgTs > 60 * 1000) {
        console.log('refreshAuthState: stale oauth_in_progress detected; clearing and initiating PKCE');
        sessionStorage.removeItem('oauth_in_progress');
        try { sessionStorage.setItem('oauth_in_progress', String(Date.now())); } catch (e) {}
        await this.startPkceAuth();
        return;
      }

      // otherwise show anonymous
      this._cachedUserRoles = [];
      await this.loadDataAnonymous();
      return;
    }



    try {
      const res = await apiFetch('/o/headless-admin-user/v1.0/my-user-account');

      if (!res.ok) {
        console.warn('refreshAuthState: token rejected by server', res.status);
        try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
        try { localStorage.removeItem('oauth_owner'); } catch (e) {}
        this._cachedUserRoles = [];
        await this.loadDataAnonymous();
        return;
      }

      const me = await res.json();
      const currentUserId = String(me.id || me.userId || '');
      
      // Ensure localStorage token keys match the validated current user
      try {
        // If there is a stored owner that doesn't match, remove other owner tokens
        const storedOwner = localStorage.getItem('oauth_owner');
        if (storedOwner && storedOwner !== currentUserId) {
          // Remove any oauth_access_token_<other> entries
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('oauth_access_token_') && k !== `oauth_access_token_${currentUserId}`) {
              try { localStorage.removeItem(k); } catch (e) {}
            }
          }
          // Remove generic token to avoid ambiguity
          try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
        }

        // If we have a token for currentUserId, set oauth_owner to it.
        const tokenForCurrent = localStorage.getItem(`oauth_access_token_${currentUserId}`);
        if (tokenForCurrent) {
          localStorage.setItem('oauth_owner', currentUserId);
        } else {
          // If no owner-keyed token exists but a generic token exists, keep generic but clear owner
          const generic = localStorage.getItem('oauth_access_token');
          if (generic) {
            localStorage.removeItem('oauth_owner');
          } else {
            // No token at all: ensure owner is cleared so getAccessToken returns null
            localStorage.removeItem('oauth_owner');
          }
        }
      } catch (e) {
        console.warn('owner sync failed', e);
      }

    await this.loadData();
  }

  parseDate(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  getSortDate(incident) {
    const closed = this.parseDate(incident.closed);
    const updated = this.parseDate(incident.updated);
    const opened = this.parseDate(incident.opened);
    return closed || updated || opened || new Date(0);
  }

  async loadDataAnonymous() {
    const res = await apiFetch("/o/c/incidents?nestedFields=commentOnIncident");
    if (!res.ok) {
      console.warn('Anonymous incidents fetch failed', res.status);
      this.querySelector("#incident-list").innerHTML = "<p>No incidents available.</p>";
      return;
    }
    const data = await res.json();
    this.allItems = data.items || [];
    this.renderList();
  }

  async startPkceAuth() {
    // Do not clear pkce_verifier here; preserve until callback completes
    console.log('startPkceAuth invoked - generating PKCE values');

    try {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      const state = crypto.randomUUID();

      localStorage.setItem('pkce_verifier', verifier);
      localStorage.setItem('pkce_state', state);
      console.log('Saved pkce_verifier and pkce_state to localStorage');

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: OAUTH2.clientId,
        redirect_uri: OAUTH2.redirectUri,
        scope: OAUTH2.scopes,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state
      });

      const authorizeUrl = `${OAUTH2.authorizeUrl}?${params.toString()}`;
      console.log('Authorize URL:', authorizeUrl);
      // mark in-progress with timestamp

      console.log('PKCE saved before redirect', {
        origin: location.origin,
        pkce_verifier: !!localStorage.getItem('pkce_verifier'),
        pkce_state: !!localStorage.getItem('pkce_state'),
        authorizeUrl
      });

      sessionStorage.setItem('oauth_in_progress', String(Date.now()));

      window.location.href = authorizeUrl;

    } catch (e) {
      console.error('Failed to save PKCE verifier/state to localStorage', e);
      try { sessionStorage.removeItem('oauth_in_progress'); } catch (e) {}
      throw err;
    }
  }

  renderList() {
    const start = this.currentPage * this.pageSize;
    const end = start + this.pageSize;

    const filteredItems = this.allItems.filter((i) => {
      const q = this.searchQuery.toLowerCase();
      return (
        i.incident?.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) ||
        i.location?.toLowerCase().includes(q) ||
        i.countries?.toLowerCase().includes(q) ||
        i.statusOfIncident?.key?.toLowerCase().includes(q) ||
        i.creator?.name?.toLowerCase().includes(q)
      );
    });

    filteredItems.sort((a, b) => {
      const dateA = this.getSortDate(a);
      const dateB = this.getSortDate(b);
      return dateB - dateA;
    });

    const totalPages = Math.ceil(filteredItems.length / this.pageSize);
    const visibleItems = filteredItems.slice(start, end);

    const pageNumbers = Array.from({ length: totalPages }, (_, i) => {
      const activeClass = i === this.currentPage ? "active-page" : "";
      return `<button class="page-number ${activeClass}" data-page="${i}">${i + 1}</button>`;
    }).join("");

    const listHTML = `
      ${visibleItems.length === 0 ? "<p>No incidents found.</p>" : visibleItems.map((i) => this.renderIncident(i)).join("")}
      <div class="pagination">
        <div>${pageNumbers}</div>
        <div>
          <label for="page-size">Items per page:</label>
          <select id="page-size" class="page-size-select">
            <option value="5" ${this.pageSize === 5 ? "selected" : ""}>5</option>
            <option value="10" ${this.pageSize === 10 ? "selected" : ""}>10</option>
            <option value="15" ${this.pageSize === 15 ? "selected" : ""}>15</option>
          </select>
        </div>
      </div>
    `;

    this.querySelector("#incident-list").innerHTML = listHTML;

    this.expandedIds.forEach((id) => {
      const incident = this.allItems.find(i => String(i.id) === id);
      if (!incident) return;
      const container = this.querySelector(`#comments-${id}`);
      if (container) {
        const comments = incident.commentOnIncident || [];
        container.innerHTML = comments.length
          ? comments.map(c => {
              const date = c.dateFiled ? new Date(c.dateFiled) : null;
              const formatted = date
                ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
                : "";
              return `<div class="comment">
                        <div class="comment-title"><em>${c.creator?.name || "Anon"}</em>
                        ${formatted ? ` (${formatted})` : ""}: </div>
                       <div class="comment-body">${c.comment}</div>
                      </div>`;
            }).join("")
          : "<div>No comments yet.</div>";
      }
    });

    this.querySelectorAll(".toggle-link").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = el.dataset.id;
        if (this.expandedIds.has(id)) this.expandedIds.delete(id);
        else this.expandedIds.add(id);
        this.renderList();
      });
    });

    this.querySelectorAll(".page-number").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.currentPage = parseInt(btn.dataset.page, 10);
        this.renderList();
      });
    });

    const pageSizeEl = this.querySelector("#page-size");
    if (pageSizeEl) {
      pageSizeEl.addEventListener("change", (e) => {
        this.pageSize = parseInt(e.target.value, 10);
        this.currentPage = 0;
        this.renderList();
      });
    }
  }

  renderIncident(i) {
    const isExpanded = this.expandedIds.has(String(i.id));
    const editUrl = `/web/incident-reporting-tool/edit-incident?objectEntryId=${i.id}`;

    const normalizedRoles = Array.isArray(this._cachedUserRoles) ? (this._cachedUserRoles || []).map(r => ({
      id: Number(r?.id || r?.roleId || 0),
      key: String(r?.roleKey || r?.key || '').toLowerCase().trim(),
      name: String(r?.name || r?.roleName || r?.label || '').toLowerCase().trim()
    })) : [];

      // allowed set: include role keys and normalized names
    const allowedRoleKeys = new Set(['test-team-2', 'test_team_2', 'testteam2']);
    const allowedRoleNames = new Set(['test team 2', 'testteam2']);

    const apiRoleAllow = normalizedRoles.some(r => {
      const key = (r.key || '').toString().toLowerCase().trim();
      const name = (r.name || '').toString().toLowerCase().trim();
      return (key && allowedRoleKeys.has(key)) || (name && allowedRoleNames.has(name));
    });

    const rawToken = getAccessToken();
    const hasToken = typeof rawToken === 'string' && rawToken.length > 20;

    const canEdit = Boolean(hasToken && apiRoleAllow);

    const editChunk = canEdit
      ? `&nbsp; | &nbsp;<a href="${editUrl}" class="edit-link">Edit</a>`
      : "";

    const capitalize = (str) =>
      typeof str === "string" ? str.charAt(0).toUpperCase() + str.slice(1) : str;

    const formatDate = (val) => {
      if (!val) return "";
      try {
        const d = new Date(val);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      } catch {
        return val;
      }
    };

    let updatedValue = i.updated;
    let closedValue = i.closed;

    if (!isExpanded) {
      return `
        <div class="incident-entry" data-id="${i.id}">
          <div class="incident-title">
            <a href="#" class="toggle-link" data-id="${i.id}">
              ${capitalize(i.incident)}
            </a>
          </div>
          <div class="incident-description">${i.description || "—"}</div>
          <div>
            <a href="#" class="toggle-link" data-id="${i.id}">Read more</a>${editChunk}
          </div>
        </div>
      `;
    }

    const fields = [
      { key: "type", label: "Type" },
      { key: "classification", label: "Classification" },
      { key: "location", label: "Location" },
      { key: "countries", label: "Countries" },
      { key: "opened", label: "Opened" },
      { key: "modifiedDate", label: "Modified" },
      { key: "mGRS", label: "MGRS" },
      { key: "latitudeDMS", label: "Latitude" },
      { key: "longitudeDMS", label: "Longitude" },
      { key: "statusOfIncident", label: "Status" },
      { key: "creator", label: "Author" }
    ];

    const rows = fields
      .map(({ key, label }) => {
        let value = i[key];

        if (["opened", "modifiedDate"].includes(key)) {
          value = formatDate(value);
        }

        if (key === "creator" && typeof value === "object") {
          value = value.name || value.givenName || value.alternateName || "Unknown";
        }

        if (key === "statusOfIncident") {
          const status = i.statusOfIncident;
          if (!status || (!status.name && !status.key)) return "";
          value = status.name || status.key;
        }

        if (!value) return "";
        return `<div><strong>${label}:</strong> ${value}</div>`;
      })
      .join("");

    const extraRows = `
      ${updatedValue ? `<div><strong>Updated:</strong> ${formatDate(updatedValue)}</div>` : ""}
      ${closedValue ? `<div><strong>Closed:</strong> ${formatDate(closedValue)}</div>` : ""}
    `;

    return `
      <div class="incident-entry" data-id="${i.id}">
        <div class="incident-title">
          <a href="#" class="toggle-link" data-id="${i.id}">
            ${capitalize(i.incident)}
          </a>
        </div>
        <div class="incident-grid">
          ${rows}
          ${extraRows}
        </div>
        <div class="incident-description">${i.description || "—"}</div>
        <hr class="comments-separator"/>
        <div class="comment-header"> Updates: </div>
        <div id="comments-${i.id}" class="incident-comments">Loading comments...</div>
        <div>
          <a href="#" class="toggle-link" data-id="${i.id}">Collapse</a>${editChunk}
        </div>
      </div>
    `;
  }
}

customElements.define("incident-element", IncidentElement);