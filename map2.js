class IncidentMapElement extends HTMLElement {
  constructor() {
    super();
    this._iconCache = {};
  }

  connectedCallback() {
    this.innerHTML = `
      <style>
        #map { 
          height: 70vh; 
          width: 100%;
          border: 0.2em solid rgb(45, 90, 171);
          border-radius: 0px; 
        }
        .leaflet-container { font: inherit; }
        .leaflet-control-attribution { display: none !important; }
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
    const DM_BASE = "/documents/d/guest";

    if (!window.L) {
      const leafletCSS = document.createElement("link");
      leafletCSS.rel = "stylesheet";
      leafletCSS.href = `${DM_BASE}/leaflet-css`;
      document.head.appendChild(leafletCSS);

      await new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = `${DM_BASE}/leaflet-js-1`;
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }
  }

  getMarkerIcon(colour) {
    if (this._iconCache[colour]) {
        return this._iconCache[colour];
    }
    const svgPin = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="18" height="30" style="pointer-events: none;">
        <path fill="${colour}" stroke="#FFFFFF" stroke-width="1.5" d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12zm0 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
        </svg>
    `;

    const icon = L.divIcon({
        className: 'custom-map-marker',
        html: svgPin,
        iconSize: [18, 30],
        iconAnchor: [9, 30],
        popupAnchor: [0, -28]
    });

    this._iconCache[colour] = icon;
    return icon;
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
        attributionControl: false,
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

      const markerGroup = L.layerGroup();

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

        let colour = "blue";
        switch (statusKey) {
          case "active":
            colour = "green";
            break;
          case "inprogress":
            colour = "orange";
            break;
          case "inactive":
            colour = "red";
            break;
          case "open":
            colour = "blue";
            break;
        }

        const label = item.incident || "Unnamed";
        const url = item.friendlyUrlPath ? item.friendlyUrlPath : `/c/incidents/${item.id}`;        const marker = L.marker([lat, lng], { icon: this.getMarkerIcon(colour) });
        marker.bindPopup(`<strong>${label}</strong>`, { closeButton: false });

        marker.on('mouseover', function () {
          this.openPopup();
        });
        marker.on('mouseout', function () {
          this.closePopup();
        });

        marker.on('click', () => {
          console.log("--- DEBUGGING MARKER CLICK ---");
          console.log("Full Item Data:", item);
          console.log("Friendly URL Path:", item.friendlyUrlPath);
          console.log("Target URL being used:", url);

          // Pause navigation for 3 seconds so you can actually read the console logs
          setTimeout(() => {
            window.location.assign(url);
          }, 3000);
        });

        markerGroup.addLayer(marker);
      });

      markerGroup.addTo(this._map);

    } catch (e) {
      console.error("Failed to load incidents:", e);
      this.querySelector("#map").innerHTML = "<p>Error loading map data</p>";
    }
  }
}

if (!customElements.get("incident-map")) {
  customElements.define("incident-map", IncidentMapElement);
}
