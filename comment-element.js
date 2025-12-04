class CommentElement extends HTMLElement {
  constructor() {
    super();
    this.currentPage = 0;
    this.pageSize = 5;
    this.allItems = [];
    this.searchQuery = "";
  }

  async connectedCallback() {
    this.innerHTML = `
      <style>
      .incident-entry { padding: 0.75em 0; border-bottom: 1px solid #ccc; }
      .incident-title { font-size: 1.1em; font-weight: bold; margin-bottom: 0.25em; }
      .comment-count { font-weight: normal; color: #555; margin-left: 0.5em; }
      h2.incident-title-header { background-color: rgb(45, 90, 171); color: white; padding: 0.31em; border-radius: 0.25em; }
      .incident-description { margin-top: 0.5em; }
      .pagination { margin-top: 1em; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
      .page-number { margin: 0 0.25em; padding: 0.4em 0.8em; background: #f0f0f0; border: 1px solid #ccc; cursor: pointer; }
      .active-page { background: #007bff; color: white; font-weight: bold; }
      .page-size-select { margin-left: 1em; }
      .search-bar { margin-bottom: 1em; }
      #search-input { width: 100%; padding: 0.5em; font-size: 1em; border: 1px solid #ccc; border-radius: 4px; }
      .incident-comments .comment { margin-top: 0.25em; font-size: 0.9em; }
      .comment-title { font-weight: bold; }
      .comment-body { margin-left: 1em; }
      </style>
      <h2 class="incident-title-header">Incident Comments</h2>
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

    await this.loadData();
  }

  async loadData() {
    const res = await fetch("/o/c/incidents?nestedFields=commentOnIncident");
    if (!res.ok) {
      this.querySelector("#incident-list").innerHTML = "<p>Error loading incidents</p>";
      return;
    }
    const data = await res.json();
    this.allItems = data.items || [];
    this.renderList();
  }

  renderList() {
    const start = this.currentPage * this.pageSize;
    const end = start + this.pageSize;

    const filteredItems = this.allItems.filter((i) => {
      const q = this.searchQuery.toLowerCase();
      return (
        i.incident?.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) ||
        i.creator?.name?.toLowerCase().includes(q)
      );
    });

    filteredItems.sort((a, b) => {
      const dateA = new Date(a.updated || a.opened || 0);
      const dateB = new Date(b.updated || b.opened || 0);
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
    const count = i.commentOnIncident?.length || 0;
    const commentsHTML = (i.commentOnIncident || []).map(c => {
      const date = c.dateFiled ? new Date(c.dateFiled) : null;
      const formatted = date
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
        : "";
      return `<div class="comment">
                <div class="comment-title"><em>${c.creator?.name || "Anon"}</em> ${formatted ? `(${formatted})` : ""}</div>
                <div class="comment-body">${c.comment}</div>
              </div>`;
    }).join("");

    return `
      <div class="incident-entry" data-id="${i.id}">
        <div class="incident-title">${i.incident}
          <span class="comment-count">(${count} comments)</span>
        </div>
        <div class="incident-description">${i.description || "—"}</div>
        <div class="incident-comments">${commentsHTML || "<div>No comments yet.</div>"}</div>
        <div class="edit-link"> <a href="/web/incident-reporting-tool/edit-incident?objectEntryId=${i.id}" data-id="${i.id}"> Edit </a> </div>
      </div>
    `;
  }
}

customElements.define("comment-element", CommentElement);