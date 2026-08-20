(() => {
  if (customElements.get("incident-map")) return;

  class IncidentMapElement extends HTMLElement {
    constructor() {
      super();
      this._iconCache = {};
      this._map = null;
      this._isFetching = false;
      this._uploadedLayers = null;
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
          .map-toolbar { 
            margin: 0.5em 0; 
            display: flex; 
            gap: 1em; 
            align-items: center; 
            flex-wrap: wrap; 
          }
          .custom-map-marker { background: transparent !important; border: none !important; }
          .file-upload-label {
            background: transparent;
            border: none;
            padding: 0;
            color: #0066cc;
            text-decoration: underline;
            cursor: pointer;
            font: inherit;
          }
          .file-upload-label:hover { color: #004499; text-decoration: none;  }
          #file-uploader { display: none; }

          /* tooltip */ 
          .tooltip-cont {
            position: relative;
            display: inline-block;
          }
          .tooltip-cont .tooltip {
            visibility: hidden;
            background-color: #000931;
            color: #dbdada;
            text-align: center;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 14px;
            position: absolute;
            bottom: 125%; 
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.2s ease-in-out;
            pointer-events: none;
          }
          .tooltip-cont:hover .tooltip {
            visibility: visible;
            opacity: 1;
          }
        </style>
        <div class="map-toolbar">
          <div>
            <label><strong>Status:</strong></label>
            <select id="status-filter">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inprogress">In Progress</option>
              <option value="inactive">Inactive</option>
              <option value="open">Open</option>
            </select>
          </div>
          <div class="tooltip-cont">
            <label for="file-uploader" class="file-upload-label">
              <span>Upload Map Data</span>
            </label>
            <span class="tooltip">KML(.kml), GeoJSON(.json/.geojson), and Shapefiles(.zip) accepted</span>
            <input type="file" id="file-uploader" accept=".kml,.json,.geojson,.zip">
          </div>
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

      const fileInput = this.querySelector('#file-uploader');
      if (fileInput) {
        fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
      }

      this.loadLeaflet().then(() => {
        this.isReady = true;
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
          const script = document.createElement("script");
          script.src = `${DM_BASE}/leaflet-js-1`;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
    }

    // Router for direct client-side parsing
    async handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file || !this._map) return;

      const fileName = file.name.toLowerCase();

      try {
        let MapPoint = null;

        if (fileName.endsWith('.kml')) {
          const text = await file.text();
          MapPoint = this.parseKmlToGeoJSON(text);

        } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
          const text = await file.text();
          MapPoint = JSON.parse(text);

        } else if (fileName.endsWith('.zip')) {
          const buffer = await file.arrayBuffer();
          MapPoint = await this.parseShapefileZipNative(buffer);

        } else {
          alert("Unsupported file format.");
          return;
        }

        if (MapPoint && MapPoint.features && MapPoint.features.length > 0) {
          this.addGeoJsonToMap(MapPoint);
        } else {
          alert("No valid features found in file.");
        }
      } catch (err) {
        console.error("Native file parsing error:", err);
        alert(`Could not parse file: ${err.message}`);
      } finally {
        event.target.value = '';
      }
    }

    // Native KML Parser using DOMParser
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
          geometry = { type: 'Point', coordinates: [coords[0], coords[1]] };
        }

        
        const line = placemark.querySelector('LineString coordinates');
        if (line) {
          const rawCoords = line.textContent.trim().split(/\s+/);
          const coordinates = rawCoords.map(c => c.split(',').slice(0, 2).map(Number));
          geometry = { type: 'LineString', coordinates: coordinates };
        }

        
        const poly = placemark.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
        if (poly) {
          const rawCoords = poly.textContent.trim().split(/\s+/);
          const coordinates = rawCoords.map(c => c.split(',').slice(0, 2).map(Number));
          geometry = { type: 'Polygon', coordinates: [coordinates] };
        }

        if (geometry) {
          features.push({
            type: 'Feature',
            properties: { name, description },
            geometry: geometry
          });
        }
      });

      return { type: 'FeatureCollection', features };
    }

    
    async parseShapefileZipNative(zipBuffer) {
      const shpBuffer = await this.extractFileFromZipNative(zipBuffer, '.shp');
      if (!shpBuffer) throw new Error("No .shp file found inside ZIP archive.");

      const view = new DataView(shpBuffer);
      const features = [];
      let offset = 100; // Skip 100-byte main header

      while (offset < view.byteLength) {
        
        const recordLength = view.getInt32(offset + 4, false) * 2;
        offset += 8;

        if (offset >= view.byteLength) break;

        const shapeType = view.getInt32(offset, true);
        
        // Point SHP
        if (shapeType === 1) {
          const x = view.getFloat64(offset + 4, true);
          const y = view.getFloat64(offset + 12, true);
          features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [x, y] }
          });
        } 
       
        // Line SHP
        else if (shapeType === 3 || shapeType === 5) {
          const numParts = view.getInt32(offset + 36, true);
          const numPoints = view.getInt32(offset + 40, true);
          
          let partsOffset = offset + 44;
          let pointsOffset = partsOffset + (numParts * 4);

          const parts = [];
          for (let i = 0; i < numParts; i++) {
            parts.push(view.getInt32(partsOffset + (i * 4), true));
          }

          const points = [];
          for (let i = 0; i < numPoints; i++) {
            const x = view.getFloat64(pointsOffset + (i * 16), true);
            const y = view.getFloat64(pointsOffset + (i * 16) + 8, true);
            points.push([x, y]);
          }

          const type = shapeType === 3 ? 'LineString' : 'Polygon';
          const coordinates = parts.map((start, idx) => {
            const end = (idx + 1 < parts.length) ? parts[idx + 1] : points.length;
            return points.slice(start, end);
          });

          features.push({
            type: 'Feature',
            properties: {},
            geometry: { 
              type: type, 
              coordinates: type === 'LineString' ? coordinates[0] : coordinates 
            }
          });
        }

        offset += recordLength;
      }

      return { type: 'FeatureCollection', features };
    }

    // Pure JS ZIP Reader extracting target extension byte buffers
    async extractFileFromZipNative(zipBuffer, extension) {
      const view = new DataView(zipBuffer);
      let offset = 0;

      while (offset < view.byteLength - 30) {

        if (view.getUint32(offset, true) === 0x04034b50) {
          const compMethod = view.getUint16(offset + 8, true);
          const compSize = view.getUint32(offset + 18, true);
          const nameLen = view.getUint16(offset + 26, true);
          const extraLen = view.getUint16(offset + 28, true);

          const fileNameBytes = new Uint8Array(zipBuffer, offset + 30, nameLen);
          const fileName = new TextDecoder().decode(fileNameBytes);

          const dataOffset = offset + 30 + nameLen + extraLen;

          if (fileName.toLowerCase().endsWith(extension)) {
            const rawData = zipBuffer.slice(dataOffset, dataOffset + compSize);

            // Uncompressed (Store)
            if (compMethod === 0) return rawData;

            // Deflate Compressed - Use Native Browser DecompressionStream API
            if (compMethod === 8) {
              const ds = new DecompressionStream('deflate-raw');
              const writer = ds.writable.getWriter();
              writer.write(rawData);
              writer.close();
              return await new Response(ds.readable).arrayBuffer();
            }
          }

          offset = dataOffset + compSize;
        } else {
          offset++;
        }
      }
      return null;
    }

    addGeoJsonToMap(geojson) {
      if (!this._uploadedLayers) {
        this._uploadedLayers = L.layerGroup().addTo(this._map);
      }

      const layer = L.geoJSON(geojson, {
        style: () => ({
          color: '#e74c3c',
          weight: 3,
          opacity: 0.8,
          fillColor: '#f39c12',
          fillOpacity: 0.35
        }),
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: "#e74c3c",
            color: "#ffffff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
          });
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties) {
            let popupContent = `<div style="max-height:150px; overflow-y:auto;">`;
            for (const [key, val] of Object.entries(feature.properties)) {
              if (val !== null && val !== undefined) {
                popupContent += `<strong>${key}:</strong> ${val}<br/>`;
              }
            }
            popupContent += `</div>`;

            layer.bindPopup(popupContent, { closeButton: false });

            layer.on('mouseover', function() {
              this.openPopup();
            });

            layer.on('mouseout', function() {
              this.closePopup();
            });
          }
        }
      });

      this._uploadedLayers.addLayer(layer);

      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        this._map.fitBounds(bounds, { padding: [20, 20] });
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

      if (this._map) {
        this._map.remove();
        this._map = null;
      }

      try {
        if (!window.L) throw new Error('Leaflet not loaded');

        const res = await fetch("/o/c/incidents");
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        const data = await res.json();

        this._map = L.map(container, { 
          zoomControl: false,
          worldCopyJump: true,
          attributionControl: false,
          minZoom: 2 
        }).setView([20, 0], 2);

        L.control.zoom({ position: 'topleft' }).addTo(this._map);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          minZoom: 2,
          maxZoom: 20,
          noWrap: false,
        }).addTo(this._map);

        this._uploadedLayers = L.layerGroup().addTo(this._map);

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
            case "active": colour = "green"; break;
            case "inprogress": colour = "orange"; break;
            case "inactive": colour = "red"; break;
            case "open": colour = "blue"; break;
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
