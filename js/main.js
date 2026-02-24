mapboxgl.accessToken = 'pk.eyJ1IjoidHRzdWkxMjMiLCJhIjoiY21sMXF2dzBqMGF5eTNmb2tpcmpwYWI0NSJ9.SvNkLh4rFRPAttTFGwFLlA';

const RATES_URL = "./assets/us-covid-2020-rates.geojson";   
const COUNTS_URL = "./assets/us-covid-2020-counts.geojson"; 

const DEFAULT_VIEW = { center: [-98.5, 39.5], zoom: 3.2 };

const fmt = new Intl.NumberFormat();

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v10",
  center: DEFAULT_VIEW.center,
  zoom: DEFAULT_VIEW.zoom
});

map.addControl(new mapboxgl.NavigationControl(), "top-right");

let ratesGeo, countsGeo;
let chart;

function pointInBounds(lng, lat, b) {
  return lng >= b.getWest() && lng <= b.getEast() && lat >= b.getSouth() && lat <= b.getNorth();
}

function makeLegend() {
  const bins = [
    { label: "< 10", color: "#f2f0f7" },
    { label: "10–25", color: "#cbc9e2" },
    { label: "25–50", color: "#9e9ac8" },
    { label: "50–75", color: "#756bb1" },
    { label: "≥ 75", color: "#54278f" }
  ];

  const el = document.getElementById("legend");
  el.innerHTML = "<strong>Case rate (per 1,000)</strong>";
  bins.forEach(b => {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `<span class="swatch" style="background:${b.color}"></span>${b.label}`;
    el.appendChild(row);
  });
}

function buildTop10InView(bounds) {
  const inView = [];
  for (const f of ratesGeo.features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      const ring = geom.coordinates[0];
      let minLng=180, maxLng=-180, minLat=90, maxLat=-90;
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      const cLng = (minLng + maxLng) / 2;
      const cLat = (minLat + maxLat) / 2;
      if (!pointInBounds(cLng, cLat, bounds)) continue;
    } else {
      continue;
    }

    const p = f.properties || {};
    const rate = Number(p.rates);
    if (!Number.isFinite(rate)) continue;

    inView.push({
      name: `${p.county}, ${p.state}`,
      rate
    });
  }

  inView.sort((a, b) => b.rate - a.rate);
  return inView.slice(0, 10);
}

function updateSidebar() {
  const bounds = map.getBounds();

  const top10 = buildTop10InView(bounds);
  document.getElementById("county-count").textContent = fmt.format(top10.length ? top10.length : 0);

  let casesSum = 0;
  let deathsSum = 0;
  let pointCount = 0;

  for (const f of countsGeo.features) {
    const g = f.geometry;
    if (!g || g.type !== "Point") continue;
    const [lng, lat] = g.coordinates;
    if (!pointInBounds(lng, lat, bounds)) continue;

    const p = f.properties || {};
    casesSum += Number(p.cases) || 0;
    deathsSum += Number(p.deaths) || 0;
    pointCount++;
  }

  document.getElementById("cases-sum").textContent = fmt.format(casesSum);
  document.getElementById("deaths-sum").textContent = fmt.format(deathsSum);

  const categories = top10.map(d => d.name);
  const values = ["rates", ...top10.map(d => d.rate)];

  if (!chart) {
    chart = c3.generate({
      bindto: "#covid-chart",
      data: {
        columns: [values],
        type: "bar"
      },
      axis: {
        x: {
          type: "category",
          categories,
          tick: { rotate: 70, multiline: false }
        },
        y: { label: "Cases per 1,000" }
      },
      bar: { width: { ratio: 0.6 } }
    });
  } else {
    chart.load({ columns: [values], categories });
  }
}

async function loadGeoJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}`);
  return await r.json();
}

map.on("load", async () => {
  makeLegend();

  ratesGeo = await loadGeoJSON(RATES_URL);
  countsGeo = await loadGeoJSON(COUNTS_URL);

  map.addSource("rates", { type: "geojson", data: ratesGeo });
  map.addSource("counts", { type: "geojson", data: countsGeo });

  map.addLayer({
    id: "rates-fill",
    type: "fill",
    source: "rates",
    paint: {
      "fill-opacity": 0.75,
      "fill-color": [
        "step",
        ["to-number", ["get", "rates"]],
        "#f2f0f7",   // <10
        10, "#cbc9e2",
        25, "#9e9ac8",
        50, "#756bb1",
        75, "#54278f"
      ]
    }
  });

  map.addLayer({
    id: "rates-outline",
    type: "line",
    source: "rates",
    paint: { "line-width": 0.5 }
  });


  map.addLayer({
    id: "counts-circle",
    type: "circle",
    source: "counts",
    paint: {
      "circle-opacity": 0.55,
      "circle-stroke-width": 0.5,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["to-number", ["get", "cases"]],
        0, 1,
        10000, 5,
        50000, 10,
        200000, 18
      ]
    }
  });

  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });

  map.on("mousemove", "rates-fill", (e) => {
    map.getCanvas().style.cursor = "pointer";
    const f = e.features[0];
    const p = f.properties || {};
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>${p.county}, ${p.state}</strong><br/>
         Cases: ${fmt.format(p.cases)}<br/>
         Deaths: ${fmt.format(p.deaths)}<br/>
         Rate per 1,000: ${Number(p.rates).toFixed(2)}`
      )
      .addTo(map);
  });

  map.on("mouseleave", "rates-fill", () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
  });

  updateSidebar();

  map.on("moveend", () => updateSidebar());

  document.getElementById("resetLink").addEventListener("click", (evt) => {
    evt.preventDefault();
    map.flyTo({ center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom });
  });
});
