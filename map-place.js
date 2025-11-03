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

  decimalToDMS(lat, lng) {
  const toDMS = (dec, isLat) => {
    const dir = dec < 0 ? (isLat ? "S" : "W") : (isLat ? "N" : "E");
    const abs = Math.abs(dec);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = Math.round((minFloat - min) * 60);
    return `${deg}°${min}′${sec}″${dir}`;
  };
  return {
    latDMS: toDMS(lat, true),
    lonDMS: toDMS(lng, false)
  };
}

  updateLatLon(lat, lng) {
    const { latDMS, lonDMS } = this.decimalToDMS(lat, lng);
    
    let latField = document.querySelector('[name="latitudeDMS"]');
    let lonField = document.querySelector('[name="longitudeDMS"]');

    if (!latField) {
      latField = document.createElement("input");
      latField.type = "hidden";
      latField.name = "latitude";
      document.forms[0].appendChild(latField);
    }
    if (!lonField) {
      lonField = document.createElement("input");
      lonField.type = "hidden";
      lonField.name = "longitude";
      document.forms[0].appendChild(lonField);
    }

    latField.value = latDMS;
    lonField.value = lngDMS;

    latField.dispatchEvent(new Event("input", { bubbles: true }));
    lonField.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async renderMap() {
    const map = L.map(this.querySelector("#map")).setView([56.1304, -106.3468], 3);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
    }).addTo(map);

    let marker;

    // Hydrate with Lat and Long if they are set
    let lat = parseFloat(document.querySelector('[name="latitude"]')?.value);
    let lon = parseFloat(document.querySelector('[name="longitude"]')?.value);

    if (isNaN(lat) || isNaN(lon)) {
      const latDMS = document.querySelector('[name="latitudeDMS"]')?.value;
      const lonDMS = document.querySelector('[name="longitudeDMS"]')?.value;
      lat = this.dmsToDecimal(latDMS);
      lon = this.dmsToDecimal(lonDMS);
    }

    if (!isNaN(lat) && !isNaN(lon)) {
      marker = L.marker([lat, lon], { draggable: true }).addTo(map);
      map.setView([lat, lon], 8);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        this.updateLatLon(pos.lat, pos.lng);
      });
      this.updateLatLon(lat, lon);
    }

    map.on("click", (e) => {
      const { lat, lng } = e.latlng;
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          this.updateLatLon(pos.lat, pos.lng);
        });
      }
      this.updateLatLon(lat, lng);
    });
  }
}

customElements.define("marker-map", MarkerMapElement);
