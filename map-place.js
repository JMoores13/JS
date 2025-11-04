class MarkerMapElement extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = `
      <style>
        #map { height: 500px; width: 100%; }
        .leaflet-container { font: inherit; }
        #clearBtn { margin-top: 8px; padding: 4px 8px; }
        border: 0.2em solid rgb(45, 90, 171);
        border-radius: 0px;
      </style>
      <div id="map">Loading map...</div>
      <button id="clearBtn" type="button">Clear</button>
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

  // Helpers
  const normalizeMgrs = (val) => (val || "").replace(/\s+/g, "").toUpperCase();
  const parseMgrs = (val) => {
    if (!window.mgrs) return null;
    const s = normalizeMgrs(val);
    try {
      const [lng, lat] = window.mgrs.toPoint(s);
      return (isNaN(lat) || isNaN(lng)) ? null : { lat, lng };
    } catch {
      return null;
    }
  };
 const ensureMarker = (lat, lng) => {
  if (isNaN(lat) || isNaN(lng)) return;

  if (!marker) {
    // First time: create marker and recenter
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    map.setView([lat, lng], 8);

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      this.updateLatLon(pos.lat, pos.lng);
    });
  } else {
    // Subsequent updates: just move marker, don't recenter
    marker.setLatLng([lat, lng]);
  }

  this.updateLatLon(lat, lng);
};

  // Hydrate from DMS
  const latDMS = document.querySelector('[name="latitudeDMS"]')?.value;
  const lonDMS = document.querySelector('[name="longitudeDMS"]')?.value;
  let lat = this.dmsToDecimal(latDMS);
  let lon = this.dmsToDecimal(lonDMS);

  if (!isNaN(lat) && !isNaN(lon)) {
    ensureMarker(lat, lon);
  } else {
    // Fallback: hydrate from MGRS
    const mgrsVal = document.querySelector('[name="mGRS"]')?.value;
    const parsed = parseMgrs(mgrsVal);
    if (parsed) {
      lat = parsed.lat;
      lon = parsed.lng;
      ensureMarker(lat, lon);
    }
  }

  // DMS input listeners (keep in sync)
  const latField = document.querySelector('[name="latitudeDMS"]');
  const lonField = document.querySelector('[name="longitudeDMS"]');
  let inputTimer;
  [latField, lonField].forEach(field => {
    field?.addEventListener("input", () => {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        const newLat = this.dmsToDecimal(latField.value);
        const newLon = this.dmsToDecimal(lonField.value);
        ensureMarker(newLat, newLon);
      }, 500);
    });
  });

  // MGRS input listener (manual entry)
  const mgrsField = document.querySelector('[name="mGRS"]');
  mgrsField?.addEventListener("input", () => {
    const parsed = parseMgrs(mgrsField.value);
    if (parsed) {
      ensureMarker(parsed.lat, parsed.lng);
    } else {
      console.warn("Invalid MGRS:", mgrsField.value);
    }
  });

  // Clear button logic
const clearBtn = this.querySelector("#clearBtn");
clearBtn.addEventListener("click", () => {
  // Remove marker if it exists
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }

  // Clear fields
  const latField = document.querySelector('[name="latitudeDMS"]');
  const lonField = document.querySelector('[name="longitudeDMS"]');
  const mgrsField = document.querySelector('[name="mGRS"]');

  if (latField) latField.value = "";
  if (lonField) lonField.value = "";
  if (mgrsField) mgrsField.value = "";

  // Fire input events so any bound logic reacts
  latField?.dispatchEvent(new Event("input", { bubbles: true }));
  lonField?.dispatchEvent(new Event("input", { bubbles: true }));
  mgrsField?.dispatchEvent(new Event("input", { bubbles: true }));

  // Optionally reset map view
  map.setView([56.1304, -106.3468], 3);
});

  // Map click
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    ensureMarker(lat, lng);
  });
}
}

customElements.define("marker-map", MarkerMapElement);
