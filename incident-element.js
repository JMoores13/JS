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
