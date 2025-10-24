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
      <style>
  .incident-entry {
    margin-bottom: 1em;
    padding: 0.5em;
    border: 1px solid #ccc;
  }
  .incident-title {
    font-size: 1.25em;
    font-weight: bold;
    margin-bottom: 0.5em;
  }
  .incident-description {
    margin-bottom: 0.5em;
  }
  .incident-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5em 1em;
    margin-bottom: 0.5em;
  }
  .incident-grid div {
    display: flex;
    flex-direction: column;
  }
  .toggle-link {
    cursor: pointer;
    color: #007bff;
    text-decoration: underline;
  }
</style>
      <h2>Incident List</h2>
      ${items.map((i) => this.renderIncident(i)).join("")}
    `;

    this.querySelectorAll(".toggle-link").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = el.dataset.id;
        if (this.expandedIds.has(id)) {
          this.expandedIds.delete(id);
        } else {
          this.expandedIds.add(id);
        }
        this.render(items);
      });
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
    "type",
    "classification",
    "location",
    "countries",
    "opened",
    "latitudeDMS",
    "longitudeDMS",
    "updated",
    "closed",
    "mGRS"
  ];

  const rows = fields
    .map((f) => {
      if (!i[f]) return "";

      const label = `<strong>${capitalize(f)}:</strong>`;
      const value =
        typeof i[f] === "object"
          ? JSON.stringify(i[f])
          : capitalize(i[f]);

      return `<div>${label} ${value}</div>`;
    })
    .join("");

  return `
    <div class="incident-entry">
      <div class="incident-title">
        <a href="#" class="toggle-link" data-id="${i.id}">
          ${capitalize(i.incident)}
        </a>
      </div>
      <div class="incident-description">${i.description || "—"}</div>
      <div class="incident-grid">
        ${rows}
      </div>
      <div><a href="#" class="toggle-link" data-id="${i.id}">Collapse</a></div>
    </div>
  `;
}
}

customElements.define("incident-element", IncidentElement);
