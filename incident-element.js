const OAUTH2 = {
  clientId: 'id-ccd397bf-6b1b-23d5-d6dd-63dc49c2c96a',
  authorizeUrl: '/o/oauth2/authorize',
  tokenUrl: '/o/oauth2/token',
  redirectUri: 'http://localhost:8080/web/incident-reporting-tool/callback',
  scopes: ['my-user-account.read','user-accounts.read','teams.read','incidents.read'].join(' ')
};

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

    function getAccessToken() {
      return localStorage.getItem('oauth_access_token');
    }

    async function apiFetch(url, opts = {}) {
      const token = getAccessToken();
      if (!token) throw new Error('Missing access token');
      const headers = new Headers(opts.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('Accept', 'application/json');
      return fetch(url, { ...opts, headers });
    }

    async function loadUserRoles() {
      const me = await apiFetch('/o/headless-admin-user/v1.0/my-user-account');
      const rolesRes = await apiFetch(`/o/headless-admin-user/v1.0/user-accounts/${me.id}/account-roles`);
      const roles = Array.isArray(rolesRes) ? rolesRes : (rolesRes.items || []);
      return roles.map(r => ({
        id: Number(r.id || r.roleId || 0),
        key: String(r.roleKey || r.key || '').toLowerCase(),
        name: String(r.name || r.roleName || r.label || '').toLowerCase().trim()
      }));
    }
    console.log('Access token:', getAccessToken());

    (async () => {
      if (!getAccessToken()) {
        if (!localStorage.getItem('pkce_verifier')) {
          await this.startPkceAuth();
        }
        return;
      }
      try {
        const roles = await loadUserRoles();
        this._cachedUserRoles = roles;
      } catch (e) {
        console.warn('PKCE role fetch failed', e);
        this._cachedUserRoles = [];
      }

      await this.loadData();
    })();
  }

  async loadData() {
    try {
      const res = await apiFetch("/o/c/incidents?nestedFields=commentOnIncident");
      
      const data = await res.json();
      this.allItems = data.items || [];
      console.log('incidentElement: loaded items=', this.allItems.length, 'sampleId=', this.allItems[0]?.id);
      this.renderList();
    } catch (e) {
      console.error("Error fetching incidents:", e);
      this.querySelector("#incident-list").innerHTML = "<p>Error loading incidents</p>";
    }
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

  async startPkceAuth() {
    console.log('Authorize URL:', `${OAUTH2.authorizeUrl}?${params.toString()}`);
    const verifier = [...crypto.getRandomValues(new Uint8Array(64))]
      .map(b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'[b % 66])
      .join('');
    const enc = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+/g, '');
    const state = crypto.randomUUID();

    localStorage.setItem('pkce_verifier', verifier);
    localStorage.setItem('pkce_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH2.clientId,
      redirect_uri: OAUTH2.redirectUri,
      scope: OAUTH2.scopes,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state
    });

    window.location.href = `${OAUTH2.authorizeUrl}?${params.toString()}`;
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

    const permissionProbes = visibleItems.map(async (item) => {
      const idNum = Number(item.id);

      if (this.editAccessCache.has(idNum) && this.editAccessCache.get(idNum) !== null) return;

      if (!this.editAccessCache.has(idNum)) this.editAccessCache.set(idNum, null);

      try {
        const res = await fetch(`/o/c/incidents/${idNum}`, {
          headers: { Accept: 'application/json' },
       
          credentials: 'same-origin'
        });

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
    });

    // Wait for all permission checks to finish
    Promise.all(permissionProbes).then(() => {
      
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
    });

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

    const serverDeclared = !!(i.actions && Object.keys(i.actions).length && this._isActionsEditable(i.actions));
    const cached = this.editAccessCache.has(idNum) ? this.editAccessCache.get(idNum) === true : null;

   // robust role check (replace existing apiRoleAllow line)
    const roles = this._cachedUserRoles || [];
    if (!this._roleShapeLogged) { console.log('cachedUserRoles sample', roles[0]); this._roleShapeLogged = true; }

    // Configure allowed roles here (prefer id or key if you have them)
    const allowedRoleIds = new Set([]); 
    const allowedRoleKeys = new Set(['testteam2']); 
    const allowedRoleNames = new Set(['test team 2']); 

    const apiRoleAllow = roles.some(r => {
      const id = Number(r?.id || r?.roleId || 0);
      if (id && allowedRoleIds.has(id)) return true;

      const key = (r?.roleKey || r?.key || '').toString().toLowerCase();
      if (key && allowedRoleKeys.has(key)) return true;

      const name = (r?.name || r?.roleName || r?.label || '').toString().toLowerCase().trim();
      if (name && allowedRoleNames.has(name)) return true;

      return false;
    }); 

    const apiTeamAllow = false;
    const canEdit = serverDeclared || (cached === true) || apiRoleAllow || apiTeamAllow;



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