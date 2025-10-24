class IncidentMapElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  async connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        #map { height: 500px; width: 100%; }
        .leaflet-container { font: inherit; }
      </style>
      <div id="map">Loading map...</div>
    `;

    await this.loadLeaflet();
    this.renderMap();
  }

  async loadLeaflet() {
    if (!window.L) {
      const leafletCSS = document.createElement("link");
      leafletCSS.rel = "stylesheet";
      leafletCSS.href = "https://unpkg.com/leaflet/dist/leaflet.css";
      document.head.appendChild(leafletCSS);

      await new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet/dist/leaflet.js";
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }
  }

  dmsToDecimal(dms) {
    const parts = dms.trim().split(/[^\d\w]+/);
    const degrees = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    const direction = parts[3].toUpperCase();
    let decimal = degrees + minutes / 60 + seconds / 3600;
    if (["S", "W"].includes(direction)) decimal *= -1;
    return decimal;
  }

  async renderMap() {
    const map = L.map(this.shadowRoot.querySelector("#map")).setView([0, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    try {
      const res = await fetch("/o/c/incidents");
      const data = await res.json();
      const bounds = [];

      data.items.forEach((item) => {
        const lat = this.dmsToDecimal(item.latitudeDMS);
        const lng = this.dmsToDecimal(item.longitudeDMS);
        const label = item.incident || "Unnamed";
        const url = `/web/guest/incidents/${item.friendlyUrlPath || item.id}`;

        const marker = L.marker([lat, lng]).addTo(map);
        marker.bindPopup(`<a href="${url}" target="_blank">${label}</a>`);
        bounds.push([lat, lng]);
      });

      if (bounds.length) map.fitBounds(bounds);
    } catch (e) {
      console.error("Failed to load incidents:", e);
    }
  }
}

customElements.define("incident-map", IncidentMapElement);
