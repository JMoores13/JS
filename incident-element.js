class IncidentElement extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = "<p>Loading incidents...</p>";

    try {
      const res = await fetch("/o/c/incidents");
      const data = await res.json();
      const items = data.items || [];

      this.innerHTML = `
        <h2>Incident List</h2>
        ${items.map((i) => this.renderIncident(i)).join("")}
      `;
    } catch (e) {
      console.error("Error fetching incidents:", e);
      this.innerHTML = "<p>Error loading incidents</p>";
    }
  }

  renderIncident(i) {
  const fields = [
    "id",
    "incident",
    "description",
    "creator",
    "location",
    "opened",
    "modifiedDate",
    "updated",
    "closed",
    "classification",
    "countries",
    "mGRS",
    "type",
    "longitudeDMS",
    "latitudeDMS"
  ];

 const rows = fields
  .map((f) => {
    if (!i[f]) return "";

    // Special case: make the incident title a link using viewableURL
    if (f === "incident" && i.viewableURL) {
      return `<div><strong>${f}:</strong> 
                <a href="${i.viewableURL}" target="_blank">
                  ${i[f]}
                </a>
              </div>`;
    }

    // Special case: render creator object with readable name
    if (f === "creator" && typeof i[f] === "object") {
      const name = i[f].name || i[f].givenName || i[f].alternateName || "Unknown";
      return `<div><strong>${f}:</strong> ${name}</div>`;
    }

    // Fallback: stringify any other object-type field
    if (typeof i[f] === "object") {
      return `<div><strong>${f}:</strong> ${JSON.stringify(i[f])}</div>`;
    }

    // Default rendering for primitive fields
    return `<div><strong>${f}:</strong> ${i[f]}</div>`;
  })
  .join("");

  return `<div class="incident-entry" style="margin-bottom:1em; padding:0.5em; border:1px solid #ccc;">
            ${rows}
          </div>`;
}
}

customElements.define("incident-element", IncidentElement);
