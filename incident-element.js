class IncidentElement extends HTMLElement {
  constructor() {
    super();
    this.expandedIds = new Set();
    this.currentPage = 0;
    this.pageSize = 5;
    this.allItems = [];
    this.searchQuery = "";
    this.searchDebounceTimer = null;
  }

connectedCallback() {
  this.innerHTML = `
      <style>
      .incident-entry {
        padding: 0.75em 0;
        border-bottom: 1px solid #ccc;
      }
      .incident-title {
        font-size: 1.25em;
        font-weight: bold;
        margin-bottom: 0.5em;
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
      .incident-comments .comment{
        margin-top: 0.25em;
        font-size: 0.9em;
      }
      .comments-separator {
        margin: 0.75em 0;
        border: 0;
        border-top: 1px solid #ccc;
      }
    </style>
    <h2>Incident List</h2>
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

  this.loadData();
}
  async loadData() {
  try {
    const res = await fetch("/o/c/incidents");
    const data = await res.json();
    this.allItems = data.items || [];
    this.renderList();
  } catch (e) {
    console.error("Error fetching incidents:", e);
    this.querySelector("#incident-list").innerHTML = "<p>Error loading incidents</p>";
  }
}

 async fetchComments(incidentId) {
  try {
    const res = await fetch(`/o/c/comments?filter=r_commentOnIncident_c_incidentId eq ${incidentId}&pageSize=200`);
    if (!res.ok) {
      console.error("Comments fetch failed:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    console.log("Comments API response for", incidentId, data);
    return data.items || [];
  } catch (e) {
    console.error("Error fetching comments:", e);
    return [];
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
  this.expandedIds.forEach(async (id) => {
    const container = this.querySelector(`#comments-${id}`);
    if (container) {
      const comments = await this.fetchComments(id);
      container.innerHTML = comments.length
        ? comments.map(c => `<div class="comment"><em>${c.creator?.name || "Anon"}:</em> ${c.comment}</div>`).join("")
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

  this.querySelector("#page-size").addEventListener("change", (e) => {
    this.pageSize = parseInt(e.target.value, 10);
    this.currentPage = 0;
    this.renderList();
  });

}
renderIncident(i) {
  const isExpanded = this.expandedIds.has(String(i.id));
  const editUrl = `/web/incident-reporting-tool/edit-incident?objectEntryId=${i.id}`;

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

  console.log("Incident ID:", i.id);
  console.log("createDate:", i.createDate);
  console.log("modifiedDate:", i.modifiedDate);
  console.log("updated:", i.updated);
  console.log("closed:", i.closed);

  // Derive updated/closed values based on status
  let updatedValue = i.updated;
  let closedValue = i.closed;
  const statusKey = i.statusOfIncident?.key?.toLowerCase();

  if (statusKey === "completed") {
    closedValue = i.modifiedDate;
  } else if (["open", "in progress", "inactive"].includes(statusKey)) {
    updatedValue = i.modifiedDate;
  }

  if (!isExpanded) {
    return `
      <div class="incident-entry">
        <div class="incident-title">
          <a href="#" class="toggle-link" data-id="${i.id}">
            ${capitalize(i.incident)}
          </a>
        </div>
        <div class="incident-description">${i.description || "—"}</div>
        <div><a href="#" class="toggle-link" data-id="${i.id}">Read more</a>
         &nbsp; |&nbsp;
        <a href="${editUrl}" class="edit-link">Edit</a>
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

      // Format dates early
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
  <div class="incident-entry">
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
    <div id="comments-${i.id}" class="incident-comments">Loading comments...</div>
    <div><a href="#" class="toggle-link" data-id="${i.id}">Collapse</a>
    &nbsp; |&nbsp;
    <a href="${editUrl}" class="edit-link">Edit</a>
    </div>
  </div>
`;


}
}

customElements.define("incident-element", IncidentElement);
