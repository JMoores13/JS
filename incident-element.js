// OAUTH2 vars to be used later
const OAUTH2 = {
  clientId: 'id-ccd397bf-6b1b-23d5-d6dd-63dc49c2c96a',
  authorizeUrl: '/o/oauth2/authorize',
  tokenUrl: '/o/oauth2/token',
  redirectUri: 'http://localhost:8080/web/incident-reporting-tool/callback',
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
  return localStorage.getItem('oauth_access_token');
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

  }

  _isActionsEditable(actions = {}) {
    const editKeys = ['update','edit','modify','patch','put','UPDATE','EDIT','update_entry','edit_entry'];
    return editKeys.some(k => Object.prototype.hasOwnProperty.call(actions, k));
  }

  connectedCallback() {
    console.log("incidentElement connected");
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

    async function loadUserRoles() {
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
    })();
      }

  async loadData() {
    const res = await apiFetch("/o/c/incidents?nestedFields=commentOnIncident");
    if (!res.ok) {
      console.warn('loadData: incidents fetch failed', res.status);
      // handle 401 by starting auth
      if (res.status === 401) {
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

    /*const permissionProbes = visibleItems.map(async (item) => {
      const idNum = Number(item.id);

      if (this.editAccessCache.has(idNum) && this.editAccessCache.get(idNum) !== null) return;

      if (!this.editAccessCache.has(idNum)) this.editAccessCache.set(idNum, null);

      try {
        const res = await apiFetch(`/o/c/incidents/${idNum}`);

        if (!res.ok) {
          if (!this.editAccessCache.has(idNum)) this.editAccessCache.set(idNum, null); 
          console.warn('incidentElement: Permission fetch failed for', idNum, 'Status:', res.status);
          return;
        }

        const entry = await res.json();
        const actions = entry.actions || {};

        // check common edit-like action keys
        const editKeys = ['update','edit','modify','patch','put','UPDATE','EDIT','update_entry','edit_entry'];

        const canEdit = editKeys.some(k => Object.prototype.hasOwnProperty.call(actions, k));
        this.editAccessCache.set(idNum, !!canEdit);

        console.log(`incidentElement: PermissionProbe id=${idNum} -> canEdit=${canEdit} actions=${Object.keys(actions).join(',')}`);
                
    
      } catch (err) {
        console.warn('incidentElement: per-item probe failed for', idNum, err);
        this.editAccessCache.set(idNum, false); 
      }
    });*/

    // Wait for all permission checks to finish
    /*Promise.all(permissionProbes).then(() => {
      
      let needsReRender = false;
      visibleItems.forEach(item => {
         const idNum = Number(item.id);
         const canEdit = this.editAccessCache.get(idNum) === true;
         if (canEdit) {
            // Check if the link is missing because of the initial render
            if (!this.querySelector(`.incident-entry[data-id="${idNum}"] .edit-link`)) {
              needsReRender = true;
            }
         }
      });

      if (needsReRender) {
         this.renderList();
      }
    });*/

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

    // roles fetched and normalized earlier
    const roles = (this._cachedUserRoles || []).map(r => ({
      id: Number(r?.id || r?.roleId || 0),
      key: (r?.roleKey || r?.key || '').toString().toLowerCase(),
      name: (r?.name || r?.roleName || r?.label || '').toString().toLowerCase().trim()
    }));

    const allowedRoleNames = new Set(['test team 2']);
    const apiRoleAllow = (this._cachedUserRoles || []).some(r => allowedRoleNames.has(r.name));
    const canEdit = apiRoleAllow; 

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