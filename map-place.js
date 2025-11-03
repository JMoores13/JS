class MarkerMapElement extends HTMLElement {
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
  }
}

customElements.define("incident-map", MarkerMapElement);
