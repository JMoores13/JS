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

   this.loadLeaflet()
      .then(() => this.loadMgrs())
      .then(() => {
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
  async loadMgrs() {
  if (!window.mgrs) {
    await new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://JMoores13.github.io/JS/mgrs.js"; // 
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }
}

 dmsToDecimal(dms) {
  if (!dms) return NaN;
  let str = dms.trim()
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

  // Range validation
  if ((direction === "N" || direction === "S") && Math.abs(decimal) > 90) return NaN;
  if ((direction === "E" || direction === "W") && Math.abs(decimal) > 180) return NaN;

  return decimal;
}

decimalToDMS(lat, lng) {
  const toDMS = (dec, isLat) => {
    // Normalize longitude into [-180, 180]
    if (!isLat) {
      dec = ((dec + 180) % 360 + 360) % 360 - 180;
    }

    const dir = dec < 0 ? (isLat ? "S" : "W") : (isLat ? "N" : "E");
    const abs = Math.abs(dec);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = Math.round((minFloat - min) * 60);

    // zero‑pad for readability
    const pad = (n) => String(n).padStart(2, "0");
    return `${deg}°${pad(min)}′${pad(sec)}″${dir}`;
  };

  return {
    latDMS: toDMS(lat, true),
    lonDMS: toDMS(lng, false)
  };
}

updateLatLon(lat, lng) {
  // Normalize longitude before converting
  if (lng > 180 || lng < -180) {
    lng = ((lng + 180) % 360 + 360) % 360 - 180;
  }

  const { latDMS, lonDMS } = this.decimalToDMS(lat, lng);

  let latField = document.querySelector('[name="latitudeDMS"]');
  let lonField = document.querySelector('[name="longitudeDMS"]');
  let mgrsField = document.querySelector('[name="mGRS"]');

  if (!latField) {
    latField = document.createElement("input");
    latField.type = "hidden";
    latField.name = "latitudeDMS";
    document.forms[0].appendChild(latField);
  }
  if (!lonField) {
    lonField = document.createElement("input");
    lonField.type = "hidden";
    lonField.name = "longitudeDMS";
    document.forms[0].appendChild(lonField);
  }
  if (!mgrsField) {
    mgrsField = document.createElement("input");
    mgrsField.type = "hidden";
    mgrsField.name = "mGRS";
    document.forms[0].appendChild(mgrsField);
  }

  latField.value = latDMS;
  lonField.value = lonDMS;

  if (window.mgrs) {
    mgrsField.value = window.mgrs.forward([lng, lat], 5);
  }

  latField.dispatchEvent(new Event("input", { bubbles: true }));
  lonField.dispatchEvent(new Event("input", { bubbles: true }));
  mgrsField.dispatchEvent(new Event("input", { bubbles: true }));
}

async renderMap() {
  const map = L.map(this.querySelector("#map")).setView([56.1304, -106.3468], 3);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(map);

  let marker;

  // Always hydrate from DMS fields
  const latDMS = document.querySelector('[name="latitudeDMS"]')?.value;
  const lonDMS = document.querySelector('[name="longitudeDMS"]')?.value;

  let lat = this.dmsToDecimal(latDMS);
  let lon = this.dmsToDecimal(lonDMS);

  if (!isNaN(lat) && !isNaN(lon)) {
    marker = L.marker([lat, lon], { draggable: true }).addTo(map);
    map.setView([lat, lon], 8);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      this.updateLatLon(pos.lat, pos.lng);
    });
    this.updateLatLon(lat, lon);
  }

  if ((isNaN(lat) || isNaN(lon)) && window.mgrs) {
  const mgrsVal = document.querySelector('[name="mGRS"]')?.value;
  if (mgrsVal) {
    const [lng, latFromMgrs] = window.mgrs.toPoint(mgrsVal);
    lat = latFromMgrs;
    lon = lng;
  }
}

  const latField = document.querySelector('[name="latitudeDMS"]');
const lonField = document.querySelector('[name="longitudeDMS"]');

let inputTimer;
[latField, lonField].forEach(field => {
  field?.addEventListener("input", () => {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      const lat = this.dmsToDecimal(latField.value);
      const lon = this.dmsToDecimal(lonField.value);
      if (!isNaN(lat) && !isNaN(lon)) {
        if (!marker) {
          marker = L.marker([lat, lon], { draggable: true }).addTo(map);
        } else {
          marker.setLatLng([lat, lon]);
        }
        map.setView([lat, lon], 8);
      }
    }, 500); // wait 500ms after typing stops
  });
});
  
const mgrsField = document.querySelector('[name="mGRS"]');
mgrsField?.addEventListener("input", () => {
  const mgrsVal = mgrsField.value;
  if (mgrsVal && window.mgrs) {
    try {
      // Normalize by removing spaces and forcing uppercase
      mgrsVal = mgrsVal.replace(/\s+/g, "").toUpperCase();
      const [lngV, latV] = window.mgrs.toPoint(mgrsVal);
      if (!isNaN(latV) && !isNaN(lngV)) {
        if (!marker) {
          marker = L.marker([latV, lngV], { draggable: true }).addTo(map);
        } else {
          marker.setLatLng([latV, lngV]);
        }
        map.setView([latV, lngV], 8);
        this.updateLatLon(latV, lngV);
      }
    } catch (e) {
      console.warn("Invalid MGRS:", mgrsVal);
    }
  }
});
  // Allow user to click to place/move marker
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
