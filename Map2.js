(() => {
  // Prevent redeclaration errors when Liferay re-evaluates the JS file
  if (customElements.get("incident-map")) return;

  class IncidentMapElement extends HTMLElement {
    constructor() {
      super();
      this._iconCache = {};
      this._map = null;
      this._isFetching = false;
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
        // Small delay ensures Liferay layout finishes calculating container size
        setTimeout(() => this.renderMap(), 50);
      });
    }

    static get observedAttributes() { return ['status-filter']; }

    attributeChangedCallback(name, oldVal, newVal) {
      if (name === 'status-filter' && oldVal !== newVal) {
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
        if (!document.querySelector(`link[href*="leaflet-css"]`)) {
          const leafletCSS = document.createElement("link");
          leafletCSS.rel = "stylesheet";
          leafletCSS.href = `${DM_BASE}/leaflet-css`;
          document.head.appendChild(leafletCSS);
        }

        await new Promise((resolve, reject) => {
          if (window.L) return resolve();
          const script = document.createElement("script");
          script.src = `${DM_BASE}/leaflet-js-1`;
          script.onload = resolve;
          script.onerror = reject;
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

    parseKmlToGeoJSON(kmlText) {
        const xml = new DOMParser().parseFromString(kmlText, 'text/xml');
        const features = [];

        const placemarks = xml.querySelectorAll('Placemark');
        placemarks.forEach((placemark) => {
            const name = placemark.querySelector('name')?.textContent || '';
            const description = placemark.querySelector('description')?.textContent || '';
            
            let geometry = null;

            const point = placemark.querySelector('Point coordinates');
            if (point) {
            const coords = point.textContent.trim().split(',').map(Number);
            geometry = {
                type: 'Point',
                coordinates: [coords[0], coords[1]] // [lng, lat]
            };
            }

            const line = placemark.querySelector('LineString coordinates');
            if (line) {
            const rawCoords = line.textContent.trim().split(/\s+/);
            const coordinates = rawCoords.map(c => c.split(',').slice(0, 2).map(Number));
            geometry = {
                type: 'LineString',
                coordinates: coordinates
            };
            }

            const poly = placemark.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
            if (poly) {
            const rawCoords = poly.textContent.trim().split(/\s+/);
            const coordinates = rawCoords.map(c => c.split(',').slice(0, 2).map(Number));
            geometry = {
                type: 'Polygon',
                coordinates: [coordinates]
            };
            }

            if (geometry) {
            features.push({
                type: 'Feature',
                properties: { name, description },
                geometry: geometry
            });
            }
        });

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    // Native File Upload Handler
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();

        try {
            let geojson = null;

            if (fileName.endsWith('.kml')) {
            const text = await file.text();
            geojson = this.parseKmlToGeoJSON(text);
            } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
            const text = await file.text();
            geojson = JSON.parse(text);
            } else if (fileName.endsWith('.zip')) {
            // Shapefiles require decoding binary ArrayBuffers (.shp + .dbf)
            const buffer = await file.arrayBuffer();
            geojson = await this.parseShapefileZipNative(buffer);
            }

            if (geojson && geojson.features.length > 0) {
            this.addGeoJsonToMap(geojson);
            } else {
            alert("No valid map features found in file.");
            }
        } catch (err) {
            console.error("Parsing error:", err);
            alert("Could not process file format.");
        } finally {
            event.target.value = '';
        }
    }

    dmsToDecimal(dms) {
      if (!dms) return NaN;
      let str = String(dms).trim();

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
      if (this._isFetching) return;
      this._isFetching = true;

      const container = this.querySelector('#map');
      if (!container) {
        this._isFetching = false;
        return;
      }

      // Safely tear down existing map instance
      if (this._map) {
        this._map.remove();
        this._map = null;
      }

      try {
        if (!window.L) throw new Error('Leaflet not loaded');

        // Fetch data BEFORE initializing Leaflet map to prevent container locking issues
        const res = await fetch("/o/c/incidents");
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        const data = await res.json();

        // Initialize Map
        this._map = L.map(container, { 
          zoomControl: false,
          worldCopyJump: true,
          attributionControl: false,
          minZoom: 2 
        }).setView([20, 0], 2);

        L.control.zoom({ position: 'topleft' }).addTo(this._map);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          minZoom: 2,
          maxZoom: 10,
          noWrap: false,
        }).addTo(this._map);

        const filterSet = this.statusFilterSet;
        const markerGroup = L.layerGroup();

        (data.items || []).forEach((item) => {
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
          const marker = L.marker([lat, lng], { icon: this.getMarkerIcon(colour) });

          marker.bindPopup(`<strong>${label}</strong>`, { closeButton: false });

          marker.on('mouseover', function () { this.openPopup(); });
          marker.on('mouseout', function () { this.closePopup(); });
          marker.on('click', () => {
            window.location.assign(`/web/guest/incident-detail-viewer?id=${item.id}`);
          });

          markerGroup.addLayer(marker);
        });

        markerGroup.addTo(this._map);

        // Forces Leaflet to recalculate tile dimensions after rendering
        setTimeout(() => {
          if (this._map) this._map.invalidateSize();
        }, 100);

      } catch (e) {
        console.error("Failed to load incidents:", e);
        container.innerHTML = `<p style="padding: 1em; color: red;">Error loading map data: ${e.message}</p>`;
      } finally {
        this._isFetching = false;
      }
    }
  }

  customElements.define("incident-map", IncidentMapElement);
})();