class IncidentElement extends HTMLElement {
  constructor() {
    super();
    this.expandedIds = new Set(); // Track expanded entries
  }

  async connectedCallback() {
    this.innerHTML = "<p>Loading incidents...</p>";

    try {
      const res = await fetch("/o/c/incidents");
      const data = await res.json();
      const items = data.items || [];

      this.render(items);
    } catch (e) {
      console.error("Error fetching incidents:", e);
      this.innerHTML = "<p>Error loading incidents</p>";
    }
  }

  render(items) {
    this.innerHTML = `
      <h2>Incident List</h2>
      ${items.map((i) => this.renderIncident(i)).join("")}
    `;

    // Attach toggle handlers
    this.querySelectorAll(".toggle-link").forEach((el) => {
      el.addEventListener("click", (e) => {
        const id = el.dataset.id;
        if (this.expandedIds.has(id)) {
          this.expandedIds.delete(id);
        } else {
          this.expandedIds.add(id);
        }
        this.render(items); // Re-render with updated state
      });
    });
  }

  renderIncident(i) {
    const isExpanded = this.expandedIds.has(String(i.id));

    if (!isExpanded) {
      return `
        <div class="incident-entry" style="margin-bottom:1em; padding:0.5em; border:1px solid #ccc;">
          <div><strong>Incident:</strong> 
            <a href="#" class="toggle-link" data-id="${i.id}">
              ${i.incident}
            </a>
          </div>
          <div><strong>Description:</strong> ${i.description || "—"}</div>
          <div><a href="#" class="toggle-link" data-id="${i.id}">Read more</a></div>
        </div>
      `;
    }

    const fields = [
      "incident",
      "type",
      "classification",
      "location",
      "countries",
      "opened",
      "latitudeDMS",
      "longitudeDMS",
      "updated",
      "closed",
      "mGRS",
      "description"
    ];

    const rows = fields
      .map((f) => {
        if (!i[f]) return "";

        if (f === "incident" && i.viewableURL) {
          return `<div><strong>${f}:</strong> 
                    <a href="${i.viewableURL}" target="_blank" class="toggle-link" data-id="${i.id}">
                      ${i[f]}
                    </a>
                  </div>`;
        }

        return `<div><strong>${f}:</strong> ${i[f]}</div>`;
      })
      .join("");

    return `
      <div class="incident-entry" style="margin-bottom:1em; padding:0.5em; border:1px solid #ccc;">
        ${rows}
        <div><a href="#" class="toggle-link" data-id="${i.id}">Collapse</a></div>
      </div>
    `;
  }
}

customElements.define("incident-element", IncidentElement);
