class IncidentMapEdElement extends HTMLElement {
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
      .map-toolbar { margin: 0.5em 0; display: flex; gap: 0.5em; align-items: center; }
    </style>
    <div class="map-toolbar">
      <label><strong>Status:</strong></label>
      <select id="status-filter">
        <option value="">All</option>
        <option value="active">Active</option>
        <option value="inprogress">In Progress</option>
        <option value="inactive">Inactive</option>
        <option value="open">Open</option>
      </select>
    </div>
    <div id="map">Loading map...</div>
  `;
  this.statusFilterSet = this.parseFilter(this.getAttribute('status-filter'));

  const sel = this.querySelector('#status-filter');
  if(sel){
    sel.value = [...(this.statusFilterSet ?? [])][0] ?? '';
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v) this.setAttribute('status-filter', v);
      else this.removeAttribute('status-filter');
    });
  }

  this.loadLeaflet().then(() => {
    this.isReady = true;
    requestAnimationFrame(() => this.renderMap());
  });
}
  static fullscreenLoaded = false;
  static get observedAttributes() { return ['status-filter']; }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'status-filter'){
      this.statusFilterSet = this.parseFilter(newVal);
      if (this.isReady) this.renderMap();
    }
  }
  parseFilter(val){
    if(!val) return null;
    return new Set(
      String(val)
        .toLowerCase()
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
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
      if (!IncidentMapEdElement.fullscreenLoaded) {
        IncidentMapEdElement.fullscreenLoaded = true;
  
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

    // Reset map container to avoid duplicate maps on re-render
    const container = this.querySelector('#map');
    if (!container) return;
    container.innerHTML = ''; // clear any previous content

    if (this._map) {
      this._map.remove();
      this._map = null;
    }

    try {
      if (!window.L) throw new Error('Leaflet not loaded');

      container.innerHTML = '';

      this._map = L.map(this.querySelector("#map"),{ 
        zoomControl: false,
        fullscreenControl: true, 
        fullscreenControlOptions: {
          position: 'topright'
        }
      }).setView([56.1304, -100.3468], 3);
      
      // Add zoom control back at top-left
      L.control.zoom({ position: 'topleft' }).addTo(this._map);
      
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
      }).addTo(this._map);

      const res = await fetch("/o/c/incidents");
      const data = await res.json();
      const bounds = [];

      const filterSet = this.statusFilterSet;

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

        if (filterSet && (!statusKey || !filterSet.has(statusKey))) return;

        let color = "blue"; // default
        
        switch (statusKey) {
          case "active":
            color = "green";
            break;
          case "inprogress":
            color = "orange";
            break;
          case "inactive":
            color = "red";
            break;
          case "open":
            color = "blue";
            break;
        }

        const label = item.incident || "Unnamed";
        const url = `/web/incident-reporting-tool/edit-incident-editor-view?objectEntryId=${item.id}`;

        const marker = L.marker([lat, lng], { icon: this.getMarkerIcon(color) }).addTo(this._map);
        marker.bindPopup(`<a href="${url}" target="_self">${label}</a>`);
        bounds.push([lat, lng]);
      });

      
    } catch (e) {
      console.error("Failed to load incidents:", e);
      this.querySelector("#map").innerHTML = "<p>Error loading map data</p>";
    }
  }
}

customElements.define("incident-edit-map", IncidentMapEdElement);
