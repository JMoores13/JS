class IncidentMapElement extends HTMLElement {
  constructor() {
    super();
  }

connectedCallback() {
  this.innerHTML = `
    <style>
      #map { height: 500px; width: 100%; }
      .leaflet-container { font: inherit; }
    </style>
    <div id="map">Loading map...</div>
  `;

  this.loadLeaflet().then(() => {
    requestAnimationFrame(() => this.renderMap());
  });
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

  getMarkerIcon(color) {
  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: "https://unpkg.com/leaflet/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
}

dmsToDecimal(dms) {
  if (!dms) return NaN;
  let str = dms.trim();

  // Normalize common symbols to spaces
  str = str
    .replace(/[°º]/g, " ")   // degree
    .replace(/[′’']/g, " ")  // minutes (prime, apostrophe)
    .replace(/[″”"]/g, " ")  // seconds (double prime, quote)
    .replace(/\s+/g, " ")    // collapse whitespace
    .trim();

  const parts = str.split(" ");
  if (parts.length < 4) return NaN;

  const degrees = parseFloat(parts[0]);
  const minutes = parseFloat(parts[1]);
  const seconds = parseFloat(parts[2]);
  const direction = parts[3].toUpperCase();

  if (isNaN(degrees) || isNaN(minutes) || isNaN(seconds)) return NaN;

  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (["S", "W"].includes(direction)) decimal *= -1;
  return decimal;
}

  async renderMap() {
    const map = L.map(this.querySelector("#map")).setView([56.1304, -106.3468], 3);
     L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(map);

    try {
      const res = await fetch("/o/c/incidents");
      const data = await res.json();
      const bounds = [];

      data.items.forEach((item) => {
        const lat = this.dmsToDecimal(item.latitudeDMS);
        const lng = this.dmsToDecimal(item.longitudeDMS);
        if (isNaN(lat) || isNaN(lng)) return;

        const statusKey = item.statusOfIncident?.key?.toLowerCase();
        let color = "blue"; // default
        
        switch (statusKey) {
          case "active":
            color = "blue";
            break;
          case "inprogress":
            color = "yellow";
            break;
          case "inactive":
            color = "grey";
            break;
          case "open":
            color = "green";
            break;
        }

        const label = item.incident || "Unnamed";
        const url = `/web/incident-reporting-tool/edit-incident?objectEntryId=${item.id}`;

        const marker = L.marker([lat, lng], { icon: this.getMarkerIcon(color) }).addTo(map);
        marker.bindPopup(`<a href="${url}" target="_self">${label}</a>`);
        bounds.push([lat, lng]);
      });

      
    } catch (e) {
      console.error("Failed to load incidents:", e);
      this.querySelector("#map").innerHTML = "<p>Error loading map data</p>";
    }
  }
}

customElements.define("incident-map", IncidentMapElement);
