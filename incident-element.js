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
    localStorage.removeItem('oauth_access_token');
    localStorage.removeItem('oauth_owner');
  } catch (e) { /* ignore */ }
  try {
    localStorage.removeItem('pkce_verifier');
    localStorage.removeItem('pkce_state');
  } catch (e) { /* ignore */ }
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

// Strict token read: return null for garbage values
function getAccessToken() {
  try {
    const t = localStorage.getItem('oauth_access_token');
    if (!t) return null;
    const trimmed = String(t).trim();
    if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') return null;
    // If tokens are JWTs, require dot-separated structure; otherwise require reasonable length
    if (trimmed.includes('.') && trimmed.split('.').length === 3) return trimmed;
    if (trimmed.length > 20) return trimmed;
    return null;
  } catch (e) {
    console.warn('getAccessToken: failed to read token', e);
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

  connectedCallback() {
    console.log("incidentElement connected");

    console.log('callback entry', {
      href: location.href,
      origin: location.origin,
      code: !!(new URL(location.href).searchParams.get('code')),
      state: !!(new URL(location.href).searchParams.get('state')),
      pkce_verifier: !!localStorage.getItem('pkce_verifier'),
      pkce_state: !!localStorage.getItem('pkce_state')
    });

    // Only run callback exchange when we are actually on the callback URL with a code
  
      const callbackPath = new URL(OAUTH2.redirectUri).pathname;
      const isCallbackPath = location.pathname === callbackPath;
      const urlParams = new URL(window.location.href).searchParams;
      const hasCode = urlParams.has('code');

     // Probe with safe fallback
     if (isCallbackPath && hasCode){
      console.log('On callback page with code; skipping probe/fallback start');
      // After storing tokenJson.access_token and oauth_owner
      localStorage.setItem('oauth_access_token', tokenJson.access_token);
      sessionStorage.setItem('oauth_completed', '1');

      try {
        // Remove PKCE artifacts
        localStorage.removeItem('pkce_verifier');
        localStorage.removeItem('pkce_state');
      } catch (e) {}

      try {
        // Clear in-progress and mark completed so fallback won't restart immediately
        sessionStorage.removeItem('oauth_in_progress');
        sessionStorage.setItem('oauth_completed_at', String(Date.now()));
      } catch (e) {}

      // Remove code/state from address bar so reloads or other logic don't re-trigger callback
      try {
        history.replaceState(null, '', '/web/incident-reporting-tool/');
      } catch (e) {}

      // Notify other tabs
      if ('BroadcastChannel' in window) new BroadcastChannel('incident-auth').postMessage('signed-in');
      else localStorage.setItem('oauth_access_token', localStorage.getItem('oauth_access_token'));

      // Finally navigate back to app 
      window.location.href = '/web/incident-reporting-tool/';
      
     }else{
      (async () => {
        try {
          const probeRes = await fetch('/o/headless-admin-user/v1.0/my-user-account', {
            credentials: 'include',
            headers: { Accept: 'application/json' }
          });

          console.log('Liferay probe status', probeRes.status);

          if (probeRes.status === 200) {
            const me = await probeRes.json();
            const currentUserId = String(me.id || me.userId || '');
            const token = getAccessToken();
            const owner = localStorage.getItem('oauth_owner');

            if (token && owner === currentUserId) {
              console.log('Liferay session present and token owner matches; no PKCE start needed');
              return;
            }

            if (token && owner && owner !== currentUserId) {
              console.warn('Token owner mismatch; clearing token for re-auth');
              try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
              try { localStorage.removeItem('oauth_owner'); } catch (e) {}
            }

            console.log('Liferay session detected; starting PKCE');
            sessionStorage.setItem('oauth_in_progress', String(Date.now()));
            if (typeof window.startPkceAuth === 'function') window.startPkceAuth();
            return;
          }

          // Non-200 probe: fallback to PKCE start after safety checks
          console.log('Probe returned', probeRes.status, '- falling back to client-initiated PKCE start');

          // Safety: avoid starting PKCE repeatedly in a short window
          const inProgress = Number(sessionStorage.getItem('oauth_in_progress') || '0');
          const now = Date.now();
          const IN_PROGRESS_TIMEOUT = 30 * 1000; // 30s

          if (now - inProgress < IN_PROGRESS_TIMEOUT) {
            console.log('PKCE already in progress recently; skipping fallback start');
            return;
          }

          // Clear stale PKCE artifacts to avoid mismatches
          try {
            localStorage.removeItem('pkce_verifier');
            localStorage.removeItem('pkce_state');
          } catch (e) {}

          sessionStorage.setItem('oauth_in_progress', String(now));
          console.log('Fallback: initiating PKCE from client');
          if (typeof window.startPkceAuth === 'function') window.startPkceAuth();
        } catch (e) {
          console.warn('Liferay session probe failed; falling back to client-initiated PKCE', e);

          // On fetch error, same safe fallback behavior
          const inProgress = Number(sessionStorage.getItem('oauth_in_progress') || '0');
          const now = Date.now();
          const IN_PROGRESS_TIMEOUT = 30 * 1000;
          if (now - inProgress < IN_PROGRESS_TIMEOUT) return;

          try {
            localStorage.removeItem('pkce_verifier');
            localStorage.removeItem('pkce_state');
          } catch (err) {}

          sessionStorage.setItem('oauth_in_progress', String(now));
          if (typeof window.startPkceAuth === 'function') window.startPkceAuth();
        }
      })();
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
          if (e.key === 'oauth_access_token' || e.key === 'oauth_owner') {
            console.log('storage event oauth_access_token/oauth_owner changed');
            if (!localStorage.getItem('oauth_access_token')) {
              try { sessionStorage.removeItem('active_user_id'); } catch (e) {}
            }
            if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
            this._uiUpdateTimer = setTimeout(() => {
              this._uiUpdateTimer = null;
              this.refreshAuthState();
            }, 250);
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

    // Respect in-progress flows
    const inProgress = sessionStorage.getItem('oauth_in_progress');
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

      const storedOwner = localStorage.getItem('oauth_owner');
      if (storedOwner && storedOwner !== currentUserId) {
        console.warn('refreshAuthState: token owner mismatch; clearing token and staying anonymous', storedOwner, currentUserId);
        try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
        try { localStorage.removeItem('oauth_owner'); } catch (e) {}
        this._cachedUserRoles = [];
        await this.loadDataAnonymous();
        return;
      }

      try { localStorage.setItem('oauth_owner', currentUserId); } catch (e) {}

      const raw = me.roleBriefs || me.roles || me.accountBriefs || [];
      this._cachedUserRoles = raw.map(r => ({
        id: Number(r.id || r.roleId || 0),
        name: String(r.name || r.roleName || r.label || '').toLowerCase().trim(),
        key: String(r.roleKey || r.key || r.name || '').toLowerCase().trim()
      }));

    } catch (e) {
      console.warn('refreshAuthState: validation error', e);
      this._cachedUserRoles = [];
      await this.loadDataAnonymous();
      return;
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
      sessionStorage.setItem('oauth_in_progress', '1');
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

    const allowedRoleNames = new Set(['test team 2']);

    const apiRoleAllow = normalizedRoles.length > 0 && normalizedRoles.some(r => {
      const nm = (r && r.name) ? r.name.toString().toLowerCase().trim() : '';
      return nm && allowedRoleNames.has(nm);
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