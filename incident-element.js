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
    // List of fields you want to display
    const fields = [
      "id",
      "modifiedDate",
      "incident",
      "description",
      "location",
      "opened",
      "classification",
      "countries",
      "closed",
      "updated",
      "mGRS",
      "type",
      "longitudeDMS",
      "latitudeDMS"
    ];

    // Build HTML only for fields that have a value
  const rows = fields
    .map((f) => {
      if (!i[f]) return "";

      // Special case: make the incident title a link
      if (f === "incident") {
        return `<div><strong>${f}:</strong> 
                  <a href="/incidents/${i.id}" target="_blank">
                    ${i[f]}
                  </a>
                </div>`;
      }

      return `<div><strong>${f}:</strong> ${i[f]}</div>`;
    })
    .join("");



    return `<div class="incident-entry" style="margin-bottom:1em; padding:0.5em; border:1px solid #ccc;">
              ${rows}
            </div>`;
  }
}

customElements.define("incident-element", IncidentElement);
