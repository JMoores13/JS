class IncidentMapElement extends HTMLElement {
  constructor() {
    super();
  }

connectedCallback() {
  this.innerHTML = `
    <style>
      #map { 
        height: 500px; 
        width: 100%;
        border: 0.2em solid rgb(45, 90, 171);
        border-radius: 0px; 
      }
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
    
    // Load fullscreen plugin after Leaflet
    if (!L.Control.Fullscreen) {
      const fsCSS = document.createElement("link");
      fsCSS.rel = "stylesheet";
      fsCSS.href = "https://unpkg.com/leaflet.fullscreen/Control.FullScreen.css";
      document.head.appendChild(fsCSS);
  
      await new Promise((resolve) => {
        const fsScript = document.createElement("script");
        fsScript.src = "https://unpkg.com/leaflet.fullscreen/Control.FullScreen.js";
        fsScript.onload = resolve;
        document.head.appendChild(fsScript);
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
    const map = L.map(this.querySelector("#map"),{ 
        zoomControl: false,
        fullscreenControl: true, 
        fullscreenControlOptions: {
          position: 'topright'
        }
     }).setView([56.1304, -100.3468], 3);
    
     // Add zoom control back at top-left
     L.control.zoom({ position: 'topleft' }).addTo(map);
    
     L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(map);

    try {
      const res = await fetch("/o/c/incidents");
      const data = await res.json();
      const bounds = [];

      data.items.forEach((item) => {
        let lat = this.dmsToDecimal(item.latitudeDMS);
        let lng = this.dmsToDecimal(item.longitudeDMS);
        
        // If DMS not provided or invalid, try MGRS
        if ((isNaN(lat) || isNaN(lng)) && window.mgrs && item.mGRS) {
          try {
            const [lngVal, latVal] = window.mgrs.toPoint(item.mGRS);
            if (!isNaN(latVal) && !isNaN(lngVal)) {
              lat = latVal;
              lng = lngVal;
            }
          } catch (e) {
            console.warn("Invalid MGRS for incident:", item.mGRS);
          }
        }
        
        // If still invalid, skip
        if (isNaN(lat) || isNaN(lng)) return;

        const statusKey = item.statusOfIncident?.key?.toLowerCase();
        let color = "blue"; // default
        
        switch (statusKey) {
          case "active":
            color = "blue";
            break;
          case "inprogress":
            color = "orange";
            break;
          case "inactive":
            color = "red";
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
