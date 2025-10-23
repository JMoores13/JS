class IncidentElement extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = "<h2>Loading incidents...</h2>";
    try {
      const res = await fetch("/o/c/incidents");
      const data = await res.json();
      this.render(data.items || []);
    } catch (e) {
      this.innerHTML = "<p>Error loading incidents</p>";
    }
  }

  render(incidents) {
    this.innerHTML = `
      <h2>Incident List</h2>
      <ul>
        ${incidents
          .map(
            (i) => `<li><strong>${i.incident}</strong> — ${i.description}</li>`
          )
          .join("")}
      </ul>
    `;
  }
}

customElements.define("incident-element", IncidentElement);
