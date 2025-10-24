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
      this.querySelector("#search-input").value = this.searchQuery;
   
  this.querySelectorAll(".toggle-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const id = el.dataset.id;
      if (this.expandedIds.has(id)) {
        this.expandedIds.delete(id);
      } else {
        this.expandedIds.add(id);
      }
      this.render();
    });
  });

  this.querySelectorAll(".page-number").forEach((btn) => {
    btn.addEventListener("click", () => {
      this.currentPage = parseInt(btn.dataset.page, 10);
      this.render();
    });
  });

  this.querySelector("#search-input").addEventListener("input", (e) => {
    clearTimeout(this.searchDebounceTimer);
    const value = e.target.value;
    this.searchDebounceTimer = setTimeout(() => {
      this.searchQuery = value;
      this.currentPage = 0;
      this.render();
    }, 250);
  });

  this.querySelector("#page-size").addEventListener("change", (e) => {
    this.pageSize = parseInt(e.target.value, 10);
    this.currentPage = 0;
    this.render();
  });

}
  renderIncident(i) {
    const isExpanded = this.expandedIds.has(String(i.id));
    const capitalize = (str) =>
      typeof str === "string" ? str.charAt(0).toUpperCase() + str.slice(1) : str;

    if (!isExpanded) {
      return `
        <div class="incident-entry">
          <div class="incident-title">
            <a href="#" class="toggle-link" data-id="${i.id}">
              ${capitalize(i.incident)}
            </a>
          </div>
          <div class="incident-description">${i.description || "—"}</div>
          <div><a href="#" class="toggle-link" data-id="${i.id}">Read more</a></div>
        </div>
      `;
    }

    const fields = [
      { key: "type", label: "Type" },
      { key: "classification", label: "Classification" },
      { key: "location", label: "Location" },
      { key: "countries", label: "Countries" },
      { key: "opened", label: "Opened" },
      { key: "updated", label: "Updated" },
      { key: "closed", label: "Closed" },
      { key: "mGRS", label: "MGRS" },
      { key: "latitudeDMS", label: "Latitude" },
      { key: "longitudeDMS", label: "Longitude" },
      { key: "statusOfIncident", label: "Status" },
      { key: "creator", label: "Author" }
    ];

    const rows = fields
      .map(({ key, label }) => {
        if (!i[key]) return "";

        let value = i[key];

        if (key === "creator" && typeof value === "object") {
          value = value.name || value.givenName || value.alternateName || "Unknown";
        }
        if (key === "statusOfIncident" && i[key]?.key === "") {
          return "";
        }
        if (typeof value === "object") {
          value = JSON.stringify(value);
        }

        return `<div><strong>${label}:</strong> ${capitalize(value)}</div>`;
      })
      .join("");

    return `
      <div class="incident-entry">
        <div class="incident-title">
          <a href="#" class="toggle-link" data-id="${i.id}">
            ${capitalize(i.incident)}
          </a>
        </div>
        <div class="incident-grid">
          ${rows}
        </div>
        <div class="incident-description">${i.description || "—"}</div>
        <div><a href="#" class="toggle-link" data-id="${i.id}">Collapse</a></div>
      </div>
    `;
  }
}

customElements.define("incident-element", IncidentElement);
