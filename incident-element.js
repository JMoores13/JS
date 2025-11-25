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

// Helper to remove the local storage variables
function clearAuthState() {
  localStorage.removeItem('oauth_access_token');
  localStorage.removeItem('pkce_verifier');
  localStorage.removeItem('pkce_state');
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
    const t = localStorage.getItem('oauth_access_token');
    if (!t) return null;
    const trimmed = String(t).trim();
    if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') return null;

    if (trimmed.includes('.') && trimmed.split('.').length === 3) return trimmed;
    if (trimmed.length > 20) return trimmed;
    return null;
  } catch (e) {
    console.warn('getAccessToken: failed to read token', e);
    return null;
  }
}

window.startPkceAuth = () => {
  const el = document.querySelector('incident-element');
  if (el && typeof el.startPkceAuth === 'function') {
    console.log('window.startPkceAuth: invoking element.startPkceAuth()');
    el.startPkceAuth();
  } else {
    console.warn('window.startPkceAuth: incident-element not found or method missing');
  }
}

async function apiFetch(url, opts = {}) {
  const token = getAccessToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');

  const res = await fetch(url, { ...opts, headers });

  if (!res.ok) {
    const www = res.headers.get('www-authenticate');
    console.warn(`apiFetch: ${url} returned ${res.status}`, { www, authHeader: `Bearer ${token && token.slice(0,8)}...` });
    // If unauthorized, clear token and trigger auth flow
    if (res.status === 401) {
      // clear stale token so next load triggers auth
      localStorage.removeItem('oauth_access_token');
      localStorage.removeItem('pkce_verifier');
      localStorage.removeItem('pkce_state');
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

    try {
      // If callback/authorize pages, skip
      const isCallbackPath = window.location.pathname.includes('/web/incident-reporting-tool/callback') ||
                            window.location.pathname.includes('/o/oauth2/authorize');

      // Clear only in-progress marker on normal loads; do NOT remove pkce_verifier/state
      const justCompleted = sessionStorage.getItem('oauth_completed');
      if (justCompleted) {
        sessionStorage.removeItem('oauth_completed');
      } else if (!isCallbackPath) {
        sessionStorage.removeItem('oauth_in_progress');
      }

      // If an auth flow is already in progress recently, defer further action
      const inProgress = sessionStorage.getItem('oauth_in_progress');
      if (inProgress && (Date.now() - Number(inProgress) < 30 * 1000)) {
        console.log('Auth already in progress; deferring PKCE start');
      } else {
        // Probe Liferay to see if the user already has a Liferay session
        // If they do, and we don't have a valid token for that user, start PKCE.
        (async () => {
          try {
            // Lightweight probe: will be 200 if user is signed in to Liferay
            const probe = await fetch('/o/headless-admin-user/v1.0/my-user-account', { credentials: 'same-origin', headers: { Accept: 'application/json' }});
            if (probe.status === 200) {
              const me = await probe.json();
              const currentUserId = String(me.id || me.userId || '');
              const token = getAccessToken();
              const owner = localStorage.getItem('oauth_owner');

              // If we have a token and owner matches, nothing to do
              if (token && owner === currentUserId) {
                console.log('Liferay session present and token owner matches; no PKCE start needed');
                return;
              }

              // If token exists but owner differs, clear it (do not auto-redirect)
              if (token && owner && owner !== currentUserId) {
                console.warn('Token owner mismatch; clearing token so this tab can re-auth for current Liferay user');
                try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
                try { localStorage.removeItem('oauth_owner'); } catch (e) {}
                // remain anonymous now; next step will start PKCE automatically for the signed-in Liferay user
              }

              // If no token (or we just cleared it), start PKCE to obtain a token for the current Liferay user
              if (!getAccessToken()) {
                // mark in-progress and start PKCE
                sessionStorage.setItem('oauth_in_progress', String(Date.now()));
                console.log('Liferay session detected; starting PKCE to obtain token for current user');
                // Use the global helper to ensure correct binding
                if (typeof window.startPkceAuth === 'function') window.startPkceAuth();
                else {
                  const el = document.querySelector('incident-element');
                  if (el && typeof el.startPkceAuth === 'function') el.startPkceAuth();
                }
              }
            } else {
              // Not signed in to Liferay — remain anonymous and do not redirect
              console.log('No Liferay session detected (probe returned', probe.status, '); staying anonymous');
            }
          } catch (e) {
            console.warn('Liferay session probe failed', e);
          }
        })();
      }
    } catch (e) {
      console.warn('Auto-start guard failed', e);
    }

    this.innerHTML = `
      <style>
      .incident-entry {
        padding: 0.75em 0;
        border-bottom: 1px solid #ccc;
      }
      .comment-body {
        margin-top: 0.25em;
        padding-left: 1em;
        font-size: 1em;
      }
      .comment-title {
        font-size: 1em;
        font-weight: bold;
      }
      .incident-title {
        font-size: 1.1em;
        font-weight: bold;
        margin-bottom: 0.5em;
      }
       h2.incident-title-header {
        background-color: rgb(45, 90, 171);
        color: white;
        padding: 0.31em;
        border-radius: 0.25em;
      }
      .incident-description {
        margin-top: 0.5em;
      }
      .incident-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5em 1em;
      }
      .incident-grid div {
        display: flex;
        flex-direction: column;
      }
      .toggle-link {
        cursor: pointer;
        color: #007bff;
        text-decoration: none;
      }
      .pagination {
        margin-top: 1em;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
      }
      .page-number {
        margin: 0 0.25em;
        padding: 0.4em 0.8em;
        background: #f0f0f0;
        border: 1px solid #ccc;
        cursor: pointer;
      }
      .active-page {
        background: #007bff;
        color: white;
        font-weight: bold;
      }
      .page-size-select {
        margin-left: 1em;
      }
      .search-bar {
        margin-bottom: 1em;
      }
      #search-input {
        width: 100%;
        padding: 0.5em;
        font-size: 1em;
        border: 1px solid #ccc;
        border-radius: 4px;
      }
      .incident-comments .comment {
        margin-top: 0.25em;
        font-size: 0.9em;
      }
      .comments-separator {
        margin: 0.75em 0;
        border: 0;
        border-top: 1px solid #ccc;
      }
      .comment-header{
        font-size: 1.1em;
        font-weight: bold;
        margin-bottom: 0.5em;
        text-decoration: underline;
      }
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

    // Debounced refresh to avoid UI flicker and repeated PKCE triggers
    if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
    this._uiUpdateTimer = setTimeout(() => {
      this._uiUpdateTimer = null;
      this.refreshAuthState();
    }, 250);

    if (!getAccessToken()) {
      this._cachedUserRoles = [];
    }

    try{
      const isCallbackPath= window.location.pathname.includes('/web/incident-reporting-tool/callback');
      const isAuthorizePath = window.location.pathname.includes('/o/oauth2/authorize');
      const tokenPresent = Boolean(getAccessToken());
      const inProgress = sessionStorage.getItem('oauth_in_progress');

      console.log('auto-auth check:', {isCallbackPath, isAuthorizePath, tokenPresent, inProgress});

      if(!tokenPresent && !isCallbackPath && !isAuthorizePath && !inProgress){
        sessionStorage.setItem('oauth_in_progress', String(Date.now()));
        if (typeof window.startPkceAuth === 'function') {
          window.startPkceAuth();
        }else{
          if(typeof this.startPkceAuth === 'function') {
            this.startPkceAuth();
          }else{
            console.warn('Auto PKCE: startpkceauth not found.')
          }
        }
      }
    } catch(err) {
      console.warn('Auto PKCE check failed', err);
    }

    // inside connectedCallback after this.refreshAuthState();
    window.addEventListener('oauth:token', () => {
      // Debounced refresh to avoid UI flicker and repeated PKCE triggers
      if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
      this._uiUpdateTimer = setTimeout(() => {
        this._uiUpdateTimer = null;
        this.refreshAuthState();
      }, 250);
    });

   // Cross-tab auth propagation: respond to token changes and broadcast events
    try {
      if ('BroadcastChannel' in window) {
        this._bc = new BroadcastChannel('incident-auth');
        this._bc.onmessage = (ev) => {
          if (ev.data === 'signed-in' || ev.data === 'signed-out') {
            console.log('BroadcastChannel auth event', ev.data);
            // Clear per-tab user id on sign-out so next refresh will re-auth
            if (ev.data === 'signed-out') {
              try { sessionStorage.removeItem('active_user_id'); } catch (e) {}
            }
            // Debounced refresh to avoid UI flicker and repeated PKCE triggers
            if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
            this._uiUpdateTimer = setTimeout(() => {
              this._uiUpdateTimer = null;
              this.refreshAuthState();
            }, 250);
          }
        };
      } else {
        window.addEventListener('storage', (e) => {
          if (e.key === 'oauth_access_token') {
            console.log('storage event oauth_access_token changed');
            // If token was removed by another tab, clear per-tab user id
            if (!localStorage.getItem('oauth_access_token')) {
              try { sessionStorage.removeItem('active_user_id'); } catch (e) {}
            }
            // Debounced refresh to avoid UI flicker and repeated PKCE triggers
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

    /*async function loadUserRoles() {
      const res = await apiFetch('/o/headless-admin-user/v1.0/my-user-account');
      if (!res.ok) return [];
      const me = await res.json();
      const raw = me.roleBriefs || me.roles || me.accountBriefs || [];
      return raw.map(r => ({
        id: Number(r.id || r.roleId || 0),
        name: String(r.name || r.roleName || r.label || '').toLowerCase().trim(),
        key: String(r.roleKey || r.key || r.name || '').toLowerCase().trim()
      }));
    }
        console.log('Access token:', getAccessToken());

    (async () => {
        if (!getAccessToken()) {
          this._cachedUserRoles = [];
          await this.loadDataAnonymous();
          return;
        }

        // token exists — try to load roles and incidents
        try {
          const roles = await loadUserRoles();
          this._cachedUserRoles = roles;
        } catch (e) {
          console.warn('role fetch failed', e);
          this._cachedUserRoles = [];
        }

        try {
          await this.loadData();
        } catch (e) {
          console.warn('Initial loadData failed:', e);
        }
    })();*/
      }

  async loadData() {
    const res = await apiFetch("/o/c/incidents?nestedFields=commentOnIncident");
    if (!res.ok) {
      console.warn('loadData: incidents fetch failed', res.status);
      // handle 401 by starting auth
      if (res.status === 401) {
        // avoid redirect loop: only start auth if no token and not already in progress
        if (!getAccessToken() && !sessionStorage.getItem('oauth_in_progress')) {
          sessionStorage.setItem('oauth_in_progress', String(Date.now()));
          console.log('No token and 401 received — initiating PKCE authorize');
          await this.startPkceAuth();
          return;
        }
        // if token existed but still 401, fall back to anonymous
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
    // Local token sanity check
    const token = getAccessToken();
    // Prevent immediate reauth storms: if an auth flow is already in progress, wait a bit
    const inProgress = sessionStorage.getItem('oauth_in_progress');
    if (inProgress) {
      const started = Number(inProgress) || 0;
      // if started less than 30s ago, avoid starting another PKCE flow
      if (Date.now() - started < 30 * 1000) {
        console.log('refreshAuthState: auth already in progress; deferring refresh');
        // show anonymous view while waiting
        this._cachedUserRoles = [];
        await this.loadDataAnonymous();
        return;
      } else {
        // stale flag — remove it and continue
        sessionStorage.removeItem('oauth_in_progress');
      }
    }
    console.log('refreshAuthState: token present?', Boolean(token));

    // If no token, go anonymous and attempt to load anonymous data
    if (!token) {
      this._cachedUserRoles = [];
      await this.loadDataAnonymous();
      return;
    }

    // Remote validation: call protected endpoint to get current user
    try {
      const res = await apiFetch('/o/headless-admin-user/v1.0/my-user-account');

      if (!res.ok) {
        console.warn('refreshAuthState: remote token validation failed', res.status);

        // If server rejects token, clear and reauth
        if (res.status === 401) {
          try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
          try {
            if ('BroadcastChannel' in window) new BroadcastChannel('incident-auth').postMessage('signed-out');
            else localStorage.setItem('oauth_access_token', localStorage.getItem('oauth_access_token'));
          } catch (e) {}
          this._cachedUserRoles = [];
          if (!sessionStorage.getItem('oauth_in_progress')) {
            sessionStorage.setItem('oauth_in_progress', String(Date.now()));
            if (typeof window.startPkceAuth === 'function') window.startPkceAuth();
          } else {
            await this.loadDataAnonymous();
          }
          return;
        }

        this._cachedUserRoles = [];
        await this.loadDataAnonymous();
        return;
      }

      // Token accepted; parse user
      const me = await res.json();
      const currentUserId = String(me.id || me.userId || me.id || '');

      // Compare to per-tab expected user id
      const tabUserId = sessionStorage.getItem('active_user_id');

      if (tabUserId && tabUserId !== currentUserId) {
        // Different user is signed in than this tab expects -> clear and reauth
        console.warn('refreshAuthState: different user detected (tab expects %s, server returned %s). Clearing token and restarting PKCE.', tabUserId, currentUserId);
        try { localStorage.removeItem('oauth_access_token'); } catch (e) {}
        try {
          if ('BroadcastChannel' in window) new BroadcastChannel('incident-auth').postMessage('signed-out');
          else localStorage.setItem('oauth_access_token', localStorage.getItem('oauth_access_token'));
        } catch (e) {}
        this._cachedUserRoles = [];
        if (!sessionStorage.getItem('oauth_in_progress')) {
          sessionStorage.setItem('oauth_in_progress', String(Date.now()));
          if (typeof window.startPkceAuth === 'function') window.startPkceAuth();
        } else {
          await this.loadDataAnonymous();
        }
        return;
      }

      // If we reach here, token is valid and either tab had no user id or it matches
      // Save the user id for this tab so future loads can detect changes
      try { sessionStorage.setItem('active_user_id', currentUserId); } catch (e) {}

      // Normalize roles and continue
      const raw = me.roleBriefs || me.roles || me.accountBriefs || [];
      this._cachedUserRoles = raw.map(r => ({
        id: Number(r.id || r.roleId || 0),
        name: String(r.name || r.roleName || r.label || '').toLowerCase().trim(),
        key: String(r.roleKey || r.key || r.name || '').toLowerCase().trim()
      }));

      // notify other tabs that we are signed in
      try {
        if ('BroadcastChannel' in window) new BroadcastChannel('incident-auth').postMessage('signed-in');
        else localStorage.setItem('oauth_access_token', localStorage.getItem('oauth_access_token'));
      } catch (e) {}

    } catch (e) {
      console.warn('refreshAuthState: remote validation error', e);
      this._cachedUserRoles = [];
      await this.loadDataAnonymous();
      return;
    }

    // Load incidents now that we have validated roles
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
    // Call without Authorization header
    const res = await apiFetch("/o/c/incidents?nestedFields=commentOnIncident");
    if (!res.ok) {
      console.warn('Anonymous incidents fetch failed', res.status);
      // Just show a neutral message
      this.querySelector("#incident-list").innerHTML = "<p>No incidents available.</p>";
      return;
    }
    const data = await res.json();
    this.allItems = data.items || [];
    this.renderList();
  }

  async startPkceAuth() {
    clearAuthState();
    console.log('startPkceAuth invoked');
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = crypto.randomUUID();

    // Save verifier and state
    localStorage.setItem('pkce_verifier', verifier);
    localStorage.setItem('pkce_state', state);

    // Build authorize URL parameters
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

    window.location.href = authorizeUrl;
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

    // Sort descending by closed/updated or opened
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

    // After rendering, hydrate comments for expanded incidents
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
        if (this.expandedIds.has(id)) {
          this.expandedIds.delete(id);
        } else {
          this.expandedIds.add(id);
        }
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

    const idNum = Number(i.id);

    // cached probe result
    const cached = this.editAccessCache.has(idNum) ? this.editAccessCache.get(idNum) : null;

    // Defensive normalization of cached roles 
    const normalizedRoles = Array.isArray(this._cachedUserRoles) ? (this._cachedUserRoles || []).map(r => ({
      id: Number(r?.id || r?.roleId || 0),
      key: String(r?.roleKey || r?.key || '').toLowerCase().trim(),
      name: String(r?.name || r?.roleName || r?.label || '').toLowerCase().trim()
    })) : [];

    // Allowed role names must be lowercase and trimmed
    const allowedRoleNames = new Set(['test team 2']);

    // Only evaluate role allowance if we actually have roles loaded
    const apiRoleAllow = normalizedRoles.length > 0 && normalizedRoles.some(r => {
      const nm = (r && r.name) ? r.name.toString().toLowerCase().trim() : '';
      return nm && allowedRoleNames.has(nm);
    });

    // Strict token presence check
    const rawToken = getAccessToken();
    const hasToken = typeof rawToken === 'string' && rawToken.length > 20;

    // Only allow edit when a valid token exists AND the API reports an allowed role
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