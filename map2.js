class IncidentMapElement extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = `
      <style>
        #map { 
          height: 80vh; 
          width: 100%;
          border: 0.2em solid rgb(45, 90, 171);
          border-radius: 0px; 
        }
        .leaflet-container { font: inherit; }
        .map-toolbar { margin: 0.5em 0; display: flex; gap: 0.5em; align-items: center; }
        .custom-map-marker { background: transparent !important; border: none !important; }
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
    if (sel) {
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

  static get observedAttributes() { return ['status-filter']; }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'status-filter') {
      this.statusFilterSet = this.parseFilter(newVal);
      if (this.isReady) this.renderMap();
    }
  }

  parseFilter(val) {
    if (!val) return null;
    return new Set(
      String(val)
        .toLowerCase()
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
  }

  async loadLeaflet() {
    const DM_BASE = "/documents/d/incident-reporting-tool";

    if (!window.L) {
      const leafletCSS = document.createElement("link");
      leafletCSS.rel = "stylesheet";
      leafletCSS.href = `${DM_BASE}/<leaflet-css-1>`;
      document.head.appendChild(leafletCSS);

      await new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = `${DM_BASE}/<leaflet-js-2>`;
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }
  }

  getMarkerIcon(color) {
  const svgPin = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="25" height="41">
      <path fill="${color}" stroke="#FFFFFF" stroke-width="1.5" d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12zm0 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
    </svg>
  `;

  return L.divIcon({
    className: 'custom-map-marker',
    html: svgPin,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34]
  });
}

  dmsToDecimal(dms) {
    if (!dms) return NaN;
    let str = dms.trim();

    str = str
      .replace(/[°º]/g, " ")
      .replace(/[′’']/g, " ")
      .replace(/[″”"]/g, " ")
      .replace(/\s+/g, " ")
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
    const container = this.querySelector('#map');
    if (!container) return;
    container.innerHTML = '';

    if (this._map) {
      this._map.remove();
      this._map = null;
    }

    try {
      if (!window.L) throw new Error('Leaflet not loaded');

      this._map = L.map(container, { 
        zoomControl: false,
        worldCopyJump: true,  // Wraps markers when scrolling across the equator/dateline
        minZoom: 2 
      }).setView([20, 0], 2);
      L.control.zoom({ position: 'topleft' }).addTo(this._map);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 2,
        maxZoom: 10,
        noWrap: false,
      }).addTo(this._map);

      const res = await fetch("/o/c/incidents");
      const data = await res.json();

      const filterSet = this.statusFilterSet;

      data.items.forEach((item) => {
        let lat = this.dmsToDecimal(item.latitudeDMS);
        let lng = this.dmsToDecimal(item.longitudeDMS);

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

        if (isNaN(lat) || isNaN(lng)) return;

        const statusKey = item.statusOfIncident?.key?.toLowerCase();
        if (filterSet && (!statusKey || !filterSet.has(statusKey))) return;

        let color = "blue";
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
        const url = `/web/incident-reporting-tool/edit-incident?objectEntryId=${item.id}`;

        const marker = L.marker([lat, lng], { icon: this.getMarkerIcon(color) }).addTo(this._map);
        marker.bindPopup(`<a href="${url}" target="_self">${label}</a>`);
      });

    } catch (e) {
      console.error("Failed to load incidents:", e);
      this.querySelector("#map").innerHTML = "<p>Error loading map data</p>";
    }
  }
}

customElements.define("incident-map", IncidentMapElement);