/**
 * NavApron — MSFS surface / SID · STAR companion
 *
 * Version:   edit frontend/js/version.js
 * Changelog: edit frontend/js/changelog.js (What's New page)
 *
 * Loaded as classic scripts (not ES modules) so a missing helper
 * file cannot blank the whole map/search UI.
 */

const $ = (sel) => document.querySelector(sel);

function appVersionLabel() {
  if (typeof window.NAVAPRON_VERSION_LABEL === "string" && window.NAVAPRON_VERSION_LABEL) {
    return window.NAVAPRON_VERSION_LABEL;
  }
  const ver = window.NAVAPRON_VERSION || "v0.2";
  const prefix = window.NAVAPRON_VERSION_PREFIX || "Beta Version";
  return prefix + ": " + ver;
}

function appVersion() {
  return window.NAVAPRON_VERSION || "v0.2";
}

function appChangelog() {
  return Array.isArray(window.NAVAPRON_CHANGELOG) ? window.NAVAPRON_CHANGELOG : [];
}

/** Load What's New from changelog.json (edited via Edit Changelog.bat). */
async function ensureChangelogLoaded() {
  try {
    const res = await fetch("/changelog.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) window.NAVAPRON_CHANGELOG = data;
  } catch (_) {
    /* keep whatever changelog.js set */
  }
}

// Show version in sidebar (single source of truth: version.js)
const _verEl = $("#app-version");
if (_verEl) _verEl.textContent = appVersionLabel();
const _hubVer = $("#hub-version");
if (_hubVer) _hubVer.textContent = appVersionLabel();
document.title = "NavApron — " + appVersionLabel();

// ── What's New / changelog ───────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderChangelog() {
  const body = $("#whats-new-body");
  const sub = $("#whats-new-sub");
  if (!body) return;
  if (sub) sub.textContent = appVersionLabel();

  const entries = appChangelog();
  if (!entries.length) {
    body.innerHTML =
      '<p class="changelog-empty">No release notes yet. Double-click <strong>Edit Changelog.bat</strong> in the project folder to add them (saves <code>frontend/changelog.json</code>).</p>';
    return;
  }

  const current = String(appVersion() || "").toLowerCase();
  body.innerHTML = entries
    .map(function (rel) {
      const ver = escapeHtml(rel.version || "—");
      const isCurrent = String(rel.version || "").toLowerCase() === current;
      const date = rel.date
        ? '<span class="changelog-date">' + escapeHtml(rel.date) + "</span>"
        : "";
      const badge = isCurrent ? '<span class="changelog-badge">Current</span>' : "";
      const title = rel.title
        ? '<p class="changelog-title">' + escapeHtml(rel.title) + "</p>"
        : "";
      const items = (rel.changes || [])
        .map(function (c) {
          return "<li>" + escapeHtml(c) + "</li>";
        })
        .join("");
      return (
        '<article class="changelog-release' +
        (isCurrent ? " is-current" : "") +
        '">' +
        '<div class="changelog-meta">' +
        '<span class="changelog-ver">' +
        ver +
        "</span>" +
        badge +
        date +
        "</div>" +
        title +
        '<ul class="changelog-list">' +
        items +
        "</ul>" +
        "</article>"
      );
    })
    .join("");
}

function isWhatsNewOpen() {
  const modal = $("#whats-new-modal");
  return !!(modal && modal.classList.contains("is-open"));
}

function openWhatsNew() {
  const modal = $("#whats-new-modal");
  if (!modal) return;
  const body = $("#whats-new-body");
  if (body) body.innerHTML = '<p class="changelog-empty">Loading release notes…</p>';
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  modal.removeAttribute("hidden");
  const closeBtn = $("#btn-whats-new-close");
  if (closeBtn) closeBtn.focus();
  ensureChangelogLoaded().then(function () {
    renderChangelog();
  });
}

function closeWhatsNew() {
  const modal = $("#whats-new-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  modal.setAttribute("hidden", "");
}

const _btnWhatsNew = $("#btn-whats-new");
if (_btnWhatsNew) _btnWhatsNew.addEventListener("click", openWhatsNew);

const _whatsNewModal = $("#whats-new-modal");
if (_whatsNewModal) {
  // Ensure closed on boot (never block map/sidebar)
  closeWhatsNew();
  _whatsNewModal.addEventListener("click", function (e) {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-close-whats-new") != null) {
      closeWhatsNew();
    }
  });
}

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && isWhatsNewOpen()) {
    closeWhatsNew();
  }
});

if (_verEl) {
  _verEl.style.cursor = "pointer";
  _verEl.title = "Open What's New";
  _verEl.addEventListener("click", openWhatsNew);
}

const state = {
  airport: null,
  layout: null,
  runwayEnds: [],
  clearance: [],
  /** Inbound taxiway clearance tokens (arrival taxi-in) */
  arrClearance: [],
  start: null, // { lat, lon, label }
  end: null, // runway end (taxi out destination)
  runwayEndMeta: null, // full runway end object for dep/arr
  arrivalStand: null, // { lat, lon, label }
  clickStartMode: false,
  depSuggestions: [],
  arrSuggestions: [],
  activeTab: "taxi",
  /** hub | journey | taxi | departure | arrival | flightplan */
  mode: "hub",
  journeyStep: "taxi-out",
  layerVisibility: {
    route: true,
    flightPlan: true,
    taxiIn: true,
    departure: true,
    arrival: true,
    aircraft: true,
    activeLeg: true,
  },
  flightPlan: null, // last built plan object
  /** Last drawn procedure paths (for linking enroute plan) */
  activeDeparture: null, // full API payload from Show SID
  activeArrival: null, // full API payload from Show STAR
  /** Dual airport charts for gate-to-gate */
  depChart: null, // { airport, layout, runwayEnds }
  destChart: null,
  /** Stored path polylines for active-leg snap (key → track or null) */
  pathTracks: {
    route: null,
    taxiIn: null,
    departure: null,
    arrival: null,
    flightPlan: null,
  },
  /** Follow plan: auto-pan/zoom to aircraft + upcoming path (vs Follow = centre on A/C) */
  followPlan: false,
  activeLegInfo: null,
  _followPlanTick: 0,
  /** Auto re-route taxi when MSFS aircraft leaves the planned path */
  autoRerouteTaxi: true,
  _taxiRerouteBusy: false,
  _lastTaxiRerouteAt: 0,
  _lastTaxiReroutePos: null,
  /** Last SimBrief OFP summary for map bubble (cruise, fuel, weights, …) */
  simbriefOfpSummary: null,
  sim: {
    enabled: false,
    connected: false,
    follow: false,
    pollTimer: null,
    lat: null,
    lon: null,
    heading: null,
    altitudeFt: null,
    gsKt: null,
  },
  layers: {
    taxiways: null,
    runways: null,
    aprons: null,
    parking: null,
    route: null,
    startMarker: null,
    endMarker: null,
    labels: null,
  },
  twyLayerByName: new Map(),
  searchTimer: null,
};

// ── Map ──────────────────────────────────────────────────────────
/** Gate/stand numbers only when zoomed in this far (avoids clutter at airport overview). */
const GATE_LABEL_MIN_ZOOM = 16;

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true,
}).setView([51.47, -0.46], 13);

function updateGateLabelVisibility() {
  try {
    const show = map.getZoom() >= GATE_LABEL_MIN_ZOOM;
    map.getContainer().classList.toggle("show-gate-labels", show);
  } catch (_) {}
}

map.on("zoomend", updateGateLabelVisibility);
map.on("zoom", updateGateLabelVisibility);
// Initial state (overview = labels hidden)
updateGateLabelVisibility();

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a> · Aeroways: OpenStreetMap',
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(map);

const baseLayers = {
  taxiways: L.layerGroup().addTo(map),
  runways: L.layerGroup().addTo(map),
  aprons: L.layerGroup().addTo(map),
  parking: L.layerGroup().addTo(map),
  labels: L.layerGroup().addTo(map),
  route: L.layerGroup().addTo(map),
  taxiIn: L.layerGroup().addTo(map),
  departure: L.layerGroup().addTo(map),
  arrival: L.layerGroup().addTo(map),
  flightPlan: L.layerGroup().addTo(map),
  activeLeg: L.layerGroup().addTo(map),
  aircraft: L.layerGroup().addTo(map),
  markers: L.layerGroup().addTo(map),
};

const MODE_LABELS = {
  hub: "Home",
  simbrief: "SimBrief plan",
  journey: "Full journey",
  taxi: "Taxi only",
  departure: "Departure",
  arrival: "Arrival",
  flightplan: "Flight plan",
};

// ── Hub / modes ──────────────────────────────────────────────────
// Hub is a full-screen overlay (z-index). Keep #app always laid out (not
// display:none) so Leaflet never inits on a zero-size map container.
function hideSimBriefSetup() {
  const el = $("#sb-setup");
  if (!el) return;
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
}

function showSimBriefSetup() {
  state.mode = "simbrief";
  const hub = $("#hub");
  if (hub) {
    hub.hidden = true;
    hub.setAttribute("aria-hidden", "true");
  }
  const el = $("#sb-setup");
  if (el) {
    el.hidden = false;
    el.removeAttribute("aria-hidden");
  }
  document.body.classList.add("hub-open");
  try {
    localStorage.setItem("navapron_mode", "simbrief");
  } catch (_) {}
  // Prefill from storage / plan panel
  try {
    const u = localStorage.getItem("navapron_simbrief_user");
    if (u && $("#sb-user")) $("#sb-user").value = u;
  } catch (_) {}
  if ($("#fp-ac")?.value && $("#sb-ac")) $("#sb-ac").value = $("#fp-ac").value;
  if ($("#fp-dep")?.value) setSbAirportPick("dep", { icao: $("#fp-dep").value });
  if ($("#fp-dest")?.value) setSbAirportPick("dest", { icao: $("#fp-dest").value });
  _setSbSetupStatus("");
  $("#sb-dep-search")?.focus();
}

function showHub() {
  state.mode = "hub";
  hideSimBriefSetup();
  const hub = $("#hub");
  if (hub) {
    hub.hidden = false;
    hub.removeAttribute("aria-hidden");
  }
  document.body.classList.add("hub-open");
  try {
    localStorage.setItem("navapron_mode", "hub");
  } catch (_) {}
}

function enterMode(mode) {
  try {
    if (!mode || mode === "hub") {
      showHub();
      return;
    }
    if (mode === "simbrief") {
      showSimBriefSetup();
      return;
    }
    state.mode = mode;
    hideSimBriefSetup();
    const hub = $("#hub");
    if (hub) {
      hub.hidden = true;
      hub.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("hub-open");
    try {
      localStorage.setItem("navapron_mode", mode);
    } catch (_) {}

    // Always show the planning menu when entering the map from Home
    try {
      setSidebarCollapsed(false, { persist: true, quiet: true });
    } catch (_) {}

    const badge = $("#mode-badge");
    if (badge) badge.textContent = MODE_LABELS[mode] || mode;

    const journeySteps = $("#journey-steps");
    const modeTabs = $("#mode-tabs");
    if (mode === "journey") {
      if (journeySteps) journeySteps.hidden = false;
      if (modeTabs) modeTabs.hidden = true;
      setJourneyStep(state.journeyStep || "taxi-out");
    } else {
      if (journeySteps) journeySteps.hidden = true;
      if (modeTabs) modeTabs.hidden = false;
      const tabMap = {
        taxi: "taxi",
        departure: "departure",
        arrival: "arrival",
        flightplan: "flightplan",
      };
      switchTab(tabMap[mode] || "taxi");
    }

    // Leaflet: force correct tile/pane size after hub closes / sidebar opens
    setTimeout(() => {
      try {
        map.invalidateSize(true);
      } catch (err) {
        console.warn("map.invalidateSize", err);
      }
    }, 50);
    setTimeout(() => {
      try {
        map.invalidateSize(true);
      } catch (_) {}
    }, 250);

    if (mode === "flightplan") {
      try {
        refreshSavedPlansList();
      } catch (err) {
        console.warn("refreshSavedPlansList", err);
      }
    }
    setStatus("Mode: " + (MODE_LABELS[mode] || mode), "ok");
  } catch (err) {
    console.error("enterMode failed", mode, err);
    try {
      setStatus("Could not open mode: " + (err && err.message ? err.message : err), "err");
    } catch (_) {}
  }
}

// ── SimBrief setup screen (airport pickers + generate) ───────────
const _sbPicks = { dep: null, dest: null };
let _sbSearchTimers = { dep: null, dest: null };

function _setSbSetupStatus(text) {
  const el = $("#sb-setup-status");
  if (el) el.textContent = text || "";
}

function setSbAirportPick(which, ap) {
  const icao = (ap?.icao || "").toUpperCase();
  _sbPicks[which] = icao
    ? {
        icao,
        name: ap.name || "",
        city: ap.city || "",
        iata: ap.iata || "",
      }
    : null;
  const picked = $(which === "dep" ? "#sb-dep-picked" : "#sb-dest-picked");
  if (picked) {
    if (_sbPicks[which]) {
      const bits = [_sbPicks[which].icao];
      if (_sbPicks[which].iata) bits.push(_sbPicks[which].iata);
      if (_sbPicks[which].name) bits.push(_sbPicks[which].name);
      picked.textContent = bits.join(" · ");
      picked.classList.remove("is-empty");
    } else {
      picked.textContent =
        which === "dep" ? "No departure selected" : "No arrival selected";
      picked.classList.add("is-empty");
    }
  }
  const search = $(which === "dep" ? "#sb-dep-search" : "#sb-dest-search");
  if (search && icao) search.value = icao;
  // Sync main plan fields early
  if (icao && which === "dep" && $("#fp-dep")) $("#fp-dep").value = icao;
  if (icao && which === "dest" && $("#fp-dest")) $("#fp-dest").value = icao;
}

async function runSbAirportSearch(which, q) {
  const list = $(which === "dep" ? "#sb-dep-results" : "#sb-dest-results");
  if (!list) return;
  try {
    const res = await fetch(
      `/api/airports/search?q=${encodeURIComponent(q || "")}&limit=12`
    );
    const items = await res.json();
    list.innerHTML = "";
    if (!items.length) {
      list.classList.remove("open");
      return;
    }
    for (const ap of items) {
      const li = document.createElement("li");
      const loc = [ap.city, ap.country].filter(Boolean).join(", ");
      li.innerHTML =
        `<span class="code">${escapeHtml(ap.icao)}</span>${escapeHtml(ap.name || "")}` +
        `<span class="meta">${ap.iata ? escapeHtml(ap.iata) + " · " : ""}${escapeHtml(
          loc || ap.type || ""
        )}</span>`;
      li.addEventListener("click", () => {
        setSbAirportPick(which, ap);
        list.classList.remove("open");
        list.innerHTML = "";
      });
      list.appendChild(li);
    }
    list.classList.add("open");
  } catch (err) {
    console.warn("sb airport search", err);
    list.classList.remove("open");
  }
}

function wireSbAirportSearch(which) {
  const input = $(which === "dep" ? "#sb-dep-search" : "#sb-dest-search");
  const list = $(which === "dep" ? "#sb-dep-results" : "#sb-dest-results");
  if (!input || !list) return;
  input.addEventListener("input", () => {
    clearTimeout(_sbSearchTimers[which]);
    const q = input.value.trim();
    if (q.length < 1) {
      list.classList.remove("open");
      return;
    }
    // Typing a 4-letter ICAO can select immediately when search returns
    _sbSearchTimers[which] = setTimeout(() => runSbAirportSearch(which, q), 200);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) runSbAirportSearch(which, input.value.trim());
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const icao = input.value.trim().toUpperCase();
      if (/^[A-Z0-9]{3,4}$/.test(icao)) {
        setSbAirportPick(which, { icao });
        list.classList.remove("open");
      }
    }
  });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".sb-search-field")) {
    $("#sb-dep-results")?.classList.remove("open");
    $("#sb-dest-results")?.classList.remove("open");
  }
});

function setJourneyStep(step) {
  state.journeyStep = step;
  document.querySelectorAll(".journey-step").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.journeyStep === step);
  });
  // Taxi out includes SID on the same panel (same runway — no extra step)
  const tab =
    step === "taxi-out"
      ? "taxi"
      : step === "flightplan"
        ? "flightplan"
        : step === "taxi-in"
          ? "arrival"
          : "taxi";
  switchTab(tab);
  const title = $("#airport-panel-title");
  if (title) {
    title.textContent =
      step === "taxi-in"
        ? "Airport (arrival / destination)"
        : step === "flightplan"
          ? "Flight plan (both airports)"
          : "Airport (departure — taxi & SID)";
  }
  // Switch surface selects to the chart for this phase (paths stay on map)
  if (step === "taxi-in" && state.destChart) {
    applyChartAsActive(state.destChart, { fit: false, redrawAll: true });
    // Zoom into arrival airport like first chart load
    fitChartBounds(state.destChart);
  } else if (step === "taxi-out" && state.depChart) {
    applyChartAsActive(state.depChart, { fit: false, redrawAll: true });
    fitChartBounds(state.depChart);
  } else if (step === "flightplan") {
    redrawSurfaces({ fit: false });
    if (state.flightPlan) drawFlightPlan(state.flightPlan);
  } else if (step === "taxi-in" && state.layout && state.airport) {
    // Single-airport arrival (dest chart not dual-loaded yet)
    fitChartBounds({ airport: state.airport, layout: state.layout });
  }
}

/** Keep the SID panel under Taxi (journey / taxi) or under Departure mode tab. */
function placeSidPanel(forTab) {
  const panel = $("#panel-sid");
  if (!panel) return;
  const mountTaxi = $("#sid-mount-taxi");
  const mountDep = $("#sid-mount-departure");
  if (forTab === "departure" && mountDep) {
    if (panel.parentElement !== mountDep) mountDep.appendChild(panel);
  } else if (mountTaxi) {
    if (panel.parentElement !== mountTaxi) mountTaxi.appendChild(panel);
  }
}

// ── Layer chips ──────────────────────────────────────────────────
function applyLayerVisibility() {
  const vis = state.layerVisibility;
  for (const [key, on] of Object.entries(vis)) {
    const layer = baseLayers[key];
    if (!layer) continue;
    if (on) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
  document.querySelectorAll(".layer-chip").forEach((chip) => {
    const k = chip.dataset.layer;
    chip.classList.toggle("active", !!vis[k]);
  });
}

function fitAllRoutes() {
  try {
    const layers = [];
    const vis = state.layerVisibility;
    const collect = (key) => {
      const g = baseLayers[key];
      if (!g || !vis[key]) return;
      g.getLayers().forEach((ly) => layers.push(ly));
    };
    collect("route");
    collect("flightPlan");
    collect("taxiIn");
    collect("departure");
    collect("arrival");
    collect("activeLeg");
    if (!layers.length) {
      if (state.layout) drawLayout(state.layout);
      else setStatus("Nothing to fit yet — draw a route first", "err");
      return;
    }
    const fg = L.featureGroup(layers);
    const b = fg.getBounds();
    if (b && b.isValid && b.isValid()) map.fitBounds(b.pad(0.12));
    else setStatus("Could not fit bounds", "err");
  } catch (err) {
    console.warn("fitAllRoutes", err);
    setStatus("Could not fit bounds", "err");
  }
}

// ── Active leg / follow plan ─────────────────────────────────────
/** Metres between two WGS84 points. */
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distance from point to segment; local equirectangular projection. */
function distPointToSegmentM(lat, lon, lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const midLat = ((lat1 + lat2) / 2) * toR;
  const x = (lon - lon1) * toR * Math.cos(midLat) * R;
  const y = (lat - lat1) * toR * R;
  const dx = (lon2 - lon1) * toR * Math.cos(midLat) * R;
  const dy = (lat2 - lat1) * toR * R;
  const len2 = dx * dx + dy * dy;
  let t = len2 < 1e-6 ? 0 : (x * dx + y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = t * dx;
  const py = t * dy;
  const dist = Math.hypot(x - px, y - py);
  return {
    dist,
    t,
    alongLat: lat1 + t * (lat2 - lat1),
    alongLon: lon1 + t * (lon2 - lon1),
  };
}

/**
 * Register a drawn path for active-leg snapping.
 * @param {string} key pathTracks key
 * @param {Array} coords [[lat,lon],...] or [{lat,lon}]
 * @param {{ name?: string, labels?: string[], maxSnapM?: number }} opts
 */
function setPathTrack(key, coords, opts = {}) {
  if (!state.pathTracks) state.pathTracks = {};
  if (!coords || coords.length < 2) {
    state.pathTracks[key] = null;
    return;
  }
  const pts = coords.map((c) => {
    if (Array.isArray(c)) return [Number(c[0]), Number(c[1])];
    return [Number(c.lat), Number(c.lon)];
  }).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) {
    state.pathTracks[key] = null;
    return;
  }
  state.pathTracks[key] = {
    coords: pts,
    labels: opts.labels || null,
    name: opts.name || key,
    maxSnapM: opts.maxSnapM != null ? opts.maxSnapM : defaultSnapM(key),
  };
}

function defaultSnapM(key) {
  if (key === "route" || key === "taxiIn") return 400;
  if (key === "departure" || key === "arrival") return 8000;
  if (key === "flightPlan") return 25000;
  return 2000;
}

function clearPathTrack(key) {
  if (state.pathTracks) state.pathTracks[key] = null;
  if (state.sim.lat != null) updateActiveLeg(state.sim.lat, state.sim.lon);
  else {
    baseLayers.activeLeg?.clearLayers();
    state.activeLegInfo = null;
    updateActiveLegHud(null);
  }
}

function findNearestOnTracks(lat, lon) {
  const tracks = state.pathTracks || {};
  const onGround = state.sim.onGround !== false;
  // Prefer surface paths when on ground; SID/STAR/enroute when airborne
  const priority = onGround
    ? ["route", "taxiIn", "departure", "arrival", "flightPlan"]
    : ["departure", "arrival", "flightPlan", "route", "taxiIn"];

  let best = null;
  priority.forEach((key, prioIdx) => {
    const tr = tracks[key];
    if (!tr?.coords || tr.coords.length < 2) return;
    const maxSnap = tr.maxSnapM || defaultSnapM(key);
    for (let i = 0; i < tr.coords.length - 1; i++) {
      const a = tr.coords[i];
      const b = tr.coords[i + 1];
      const { dist, alongLat, alongLon } = distPointToSegmentM(
        lat,
        lon,
        a[0],
        a[1],
        b[0],
        b[1]
      );
      if (dist > maxSnap) continue;
      // Prefer closer; small tie-break for path priority
      const score = dist + prioIdx * 25;
      if (best && score >= best.score) continue;

      let remaining = haversineM(alongLat, alongLon, b[0], b[1]);
      for (let j = i + 1; j < tr.coords.length - 1; j++) {
        remaining += haversineM(
          tr.coords[j][0],
          tr.coords[j][1],
          tr.coords[j + 1][0],
          tr.coords[j + 1][1]
        );
      }

      let nextLabel = null;
      if (tr.labels && tr.labels.length) {
        for (let j = i + 1; j < tr.labels.length; j++) {
          if (tr.labels[j]) {
            nextLabel = tr.labels[j];
            break;
          }
        }
      }

      best = {
        key,
        segIdx: i,
        dist,
        remaining,
        nextLabel,
        alongLat,
        alongLon,
        coords: tr.coords,
        name: tr.name,
        score,
      };
    }
  });
  return best;
}

function updateActiveLeg(lat, lon) {
  const layer = baseLayers.activeLeg;
  if (!layer) return;
  layer.clearLayers();
  if (lat == null || lon == null) {
    state.activeLegInfo = null;
    updateActiveLegHud(null);
    return;
  }
  const hit = findNearestOnTracks(lat, lon);
  state.activeLegInfo = hit;
  if (!hit) {
    updateActiveLegHud(null);
    return;
  }

  if (state.layerVisibility.activeLeg !== false) {
    // Current segment + a few ahead (amber highlight)
    const endIdx = Math.min(hit.coords.length - 1, hit.segIdx + 4);
    const highlight = hit.coords.slice(hit.segIdx, endIdx + 1);
    if (highlight.length >= 2) {
      L.polyline(highlight, {
        color: "#f59e0b",
        weight: 12,
        opacity: 0.4,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(layer);
      L.polyline(highlight, {
        color: "#fde68a",
        weight: 6,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(layer);
    }
    // Tip of current segment (next vertex)
    const tip = hit.coords[Math.min(hit.segIdx + 1, hit.coords.length - 1)];
    if (tip) {
      L.circleMarker(tip, {
        radius: 7,
        color: "#fef3c7",
        fillColor: "#f59e0b",
        fillOpacity: 1,
        weight: 2,
        interactive: false,
      }).addTo(layer);
    }
  }

  updateActiveLegHud(hit);
  if (state.followPlan) applyFollowPlan(lat, lon, hit);
}

function updateActiveLegHud(hit) {
  const el = $("#active-leg-hud");
  if (!el) return;
  if (!hit) {
    el.classList.remove("visible");
    el.textContent = "";
    return;
  }
  const phaseNames = {
    route: "Taxi out",
    taxiIn: "Taxi in",
    departure: "SID",
    arrival: "STAR",
    flightPlan: "Enroute",
  };
  const phase = phaseNames[hit.key] || hit.name || "Path";
  const nm = hit.remaining / 1852;
  const nmStr = nm >= 10 ? nm.toFixed(0) : nm >= 1 ? nm.toFixed(1) : nm.toFixed(2);
  const next = hit.nextLabel ? ` → ${hit.nextLabel}` : "";
  el.textContent = `${phase}${next} · ${nmStr} NM remaining`;
  el.classList.add("visible");
}

/** Keep aircraft + upcoming path in view; phase-aware max zoom. */
function applyFollowPlan(lat, lon, hit) {
  try {
    state._followPlanTick = (state._followPlanTick || 0) + 1;
    // ~every 1.5s at 750ms poll — smoother, less fight with user pan
    if (state._followPlanTick % 2 !== 0) return;

    const pts = [[lat, lon]];
    const ahead = Math.min(hit.coords.length - 1, hit.segIdx + 6);
    for (let i = hit.segIdx; i <= ahead; i++) pts.push(hit.coords[i]);
    const b = L.latLngBounds(pts);
    if (!b.isValid()) return;

    const maxZoom =
      hit.key === "route" || hit.key === "taxiIn"
        ? 17
        : hit.key === "flightPlan"
          ? 9
          : 12;
    map.fitBounds(b.pad(0.4), {
      animate: true,
      duration: 0.55,
      maxZoom,
    });
  } catch (err) {
    console.warn("applyFollowPlan", err);
  }
}

function setFollowPlan(on) {
  state.followPlan = !!on;
  const btn = $("#btn-follow-plan");
  if (btn) btn.classList.toggle("active", state.followPlan);
  if (state.followPlan) {
    // Avoid fighting pure aircraft-follow pan
    if (state.sim.follow) {
      state.sim.follow = false;
      $("#btn-sim-follow")?.classList.remove("active");
    }
    if (state.sim.lat != null && state.activeLegInfo) {
      applyFollowPlan(state.sim.lat, state.sim.lon, state.activeLegInfo);
    } else if (state.sim.lat != null) {
      updateActiveLeg(state.sim.lat, state.sim.lon);
    }
    setStatus("Follow plan on — map tracks aircraft + next path", "ok");
  } else {
    setStatus("Follow plan off", "ok");
  }
}

// ── Sidebar tabs ─────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    const on = p.id === `tab-${name}`;
    p.classList.toggle("active", on);
    if (on) p.removeAttribute("hidden");
    else p.setAttribute("hidden", "");
  });
  // SID panel: under Taxi for journey/taxi; under Departure when that tab is open
  placeSidPanel(name === "departure" ? "departure" : "taxi");
  // Swap which airport is "active" for selects + which chart's taxiways are clickable
  if (state.depChart || state.destChart) {
    try {
      let chart = null;
      if (name === "arrival" && state.destChart) chart = state.destChart;
      else if ((name === "taxi" || name === "departure") && state.depChart)
        chart = state.depChart;
      if (chart) {
        state.airport = chart.airport;
        state.layout = chart.layout;
        state.runwayEnds = chart.runwayEnds || [];
        renderAirportCard({ airport: chart.airport, layout: chart.layout });
        populateSelects({
          airport: chart.airport,
          layout: chart.layout,
          runway_ends: chart.runwayEnds,
        });
        renderTaxiwayButtons(chart.layout.taxiway_names || []);
      }
      redrawSurfaces({ fit: false });
      if (name === "arrival") {
        renderArrClearance();
        // Zoom into arrival airport (same feel as first load)
        if (state.destChart) fitChartBounds(state.destChart);
        else if (chart) fitChartBounds(chart);
      }
    } catch (err) {
      console.warn("switchTab chart swap", err);
    }
  } else if (name === "arrival" && state.layout && state.airport) {
    fitChartBounds({ airport: state.airport, layout: state.layout });
  }
  if (name === "flightplan") refreshSavedPlansList();
}

// Hub cards + home
document.querySelectorAll(".hub-card[data-mode]").forEach((card) => {
  card.addEventListener("click", () => enterMode(card.dataset.mode));
});
$("#btn-home")?.addEventListener("click", () => showHub());
$("#btn-whats-new-hub")?.addEventListener("click", () => openWhatsNew());
document.querySelectorAll(".journey-step").forEach((btn) => {
  btn.addEventListener("click", () => setJourneyStep(btn.dataset.journeyStep));
});
document.querySelectorAll(".layer-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const k = chip.dataset.layer;
    if (!k || !(k in state.layerVisibility)) return;
    state.layerVisibility[k] = !state.layerVisibility[k];
    applyLayerVisibility();
  });
});
$("#btn-fit-journey")?.addEventListener("click", () => fitAllRoutes());
applyLayerVisibility();

// ── Status / loading ─────────────────────────────────────────────
function setStatus(text, mode = "ok") {
  const st = $("#status-text");
  if (st) st.textContent = text;
  const dot = $("#status-dot");
  if (!dot) return;
  dot.classList.remove("busy", "err");
  if (mode === "busy") dot.classList.add("busy");
  if (mode === "err") dot.classList.add("err");
}
// Expose for airline.js (classic script, no modules)
try {
  window.setStatus = setStatus;
} catch (_) {}

function setLoading(on, text = "Loading…") {
  const el = $("#loading");
  const lt = $("#loading-text");
  if (lt) lt.textContent = text;
  if (el) el.classList.toggle("visible", on);
}

function setHint(text, visible = true) {
  const el = $("#map-hint");
  if (!el) return;
  el.innerHTML = text;
  el.classList.toggle("visible", visible && !!text);
}

// ── Airport search ───────────────────────────────────────────────
const searchInput = $("#airport-search");
const resultsList = $("#search-results");

if (searchInput) {
  searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => runSearch(searchInput.value), 220);
  });

  searchInput.addEventListener("focus", () => {
    if (!searchInput.value.trim()) runSearch("");
  });
}

document.addEventListener("click", (e) => {
  if (resultsList && !e.target.closest(".search-wrap")) {
    resultsList.classList.remove("open");
  }
});

async function runSearch(q) {
  try {
    const res = await fetch(`/api/airports/search?q=${encodeURIComponent(q)}&limit=20`);
    const data = await res.json();
    renderResults(data);
  } catch (err) {
    console.error(err);
    setStatus("Search failed", "err");
  }
}

function renderResults(items) {
  resultsList.innerHTML = "";
  if (!items.length) {
    resultsList.classList.remove("open");
    return;
  }
  for (const ap of items) {
    const li = document.createElement("li");
    const loc = [ap.city, ap.country].filter(Boolean).join(", ");
    li.innerHTML = `<span class="code">${ap.icao}</span>${escapeHtml(ap.name)}
      <span class="meta">${ap.iata ? ap.iata + " · " : ""}${escapeHtml(loc || ap.type)}</span>`;
    li.addEventListener("click", () => {
      resultsList.classList.remove("open");
      searchInput.value = ap.icao;
      // Load as dest when planning arrival / taxi-in so dep chart is not overwritten
      const asDest = shouldLoadAirportAsDest();
      loadAirport(ap.icao, {
        role: asDest ? "dest" : "dep",
        keepPaths:
          state.mode === "journey" ||
          !!state.flightPlan ||
          !!(state.depChart && state.destChart) ||
          asDest ||
          !!state.depChart ||
          !!state.destChart,
        fit: !state.flightPlan,
      });
    });
    resultsList.appendChild(li);
  }
  resultsList.classList.add("open");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Load airport layout ──────────────────────────────────────────
/** True when search/refresh should store the chart as destination, not departure. */
function shouldLoadAirportAsDest() {
  if (state.mode === "arrival") return true;
  if (state.mode === "journey" && state.journeyStep === "taxi-in") return true;
  if (state.activeTab === "arrival") return true;
  return false;
}

/**
 * @param {string} icao
 * @param {boolean|{refresh?:boolean, role?:"dep"|"dest"|"active", keepPaths?:boolean, fit?:boolean}} options
 */
async function loadAirport(icao, options = false) {
  const opts =
    typeof options === "boolean"
      ? { refresh: options, role: "active", keepPaths: false, fit: true }
      : {
          refresh: !!options.refresh,
          role: options.role || "active",
          keepPaths: !!options.keepPaths,
          fit: options.fit !== false,
        };

  setLoading(true, `Loading taxi chart for ${icao}…`);
  setStatus(`Fetching chart for ${icao} from OpenStreetMap…`, "busy");

  if (!opts.keepPaths) {
    clearRoute();
    clearDeparture();
    clearArrival();
    clearTaxiIn();
    state.clearance = [];
    state.arrClearance = [];
    state.runwayEndMeta = null;
    state.arrivalStand = null;
    state.depSuggestions = [];
    state.arrSuggestions = [];
    resetDepSelect();
    resetArrSelect();
    updateArrTaxiButtons();
    renderClearance();
    renderArrClearance();
  }

  // Progress messages so a slow OSM response doesn't feel frozen
  const started = Date.now();
  const tips = [
    `Contacting map servers for ${icao}…`,
    "OpenStreetMap can take 10–30s on first load…",
    "Still waiting on chart servers — almost there…",
    "Large airports take longer the first time (then cached)…",
  ];
  let tipIdx = 0;
  const progressTimer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    tipIdx = Math.min(tipIdx + 1, tips.length - 1);
    setLoading(true, `${tips[tipIdx]} (${sec}s)`);
    setStatus(`Loading ${icao}… ${sec}s`, "busy");
  }, 4000);

  const controller = new AbortController();
  const killTimer = setTimeout(() => controller.abort(), 90000);

  try {
    const url = `/api/airports/${encodeURIComponent(icao)}/layout${
      opts.refresh ? "?refresh=true" : ""
    }`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail;
      throw new Error(
        typeof detail === "string" ? detail : detail?.[0]?.msg || res.statusText
      );
    }
    const data = await res.json();
    const chart = {
      airport: data.airport,
      layout: data.layout,
      runwayEnds: data.runway_ends || [],
      source: data.source,
    };

    // Store dual-airport charts — never clobber the other role's airport
    const icaoUp = (data.airport?.icao || icao || "").toUpperCase();
    let role = opts.role || "active";
    if (role === "active") {
      role = shouldLoadAirportAsDest() ? "dest" : "dep";
    }
    if (role === "dep") {
      state.depChart = chart;
      if ($("#fp-dep") && icaoUp) {
        // Only auto-fill dep ICAO; leave dest alone
        $("#fp-dep").value = icaoUp;
      }
    } else if (role === "dest") {
      state.destChart = chart;
      if ($("#fp-dest") && icaoUp) {
        $("#fp-dest").value = icaoUp;
      }
    }

    // Active chart for selects / taxi buttons (both surfaces if dual)
    applyChartAsActive(chart, { fit: opts.fit, redrawAll: true });

    const src = data.source ? ` · ${data.source}` : "";
    const sec = Math.round((Date.now() - started) / 1000);
    const both =
      state.depChart &&
      state.destChart &&
      state.depChart.airport.icao !== state.destChart.airport.icao;
    setStatus(
      both
        ? `${state.depChart.airport.icao} + ${state.destChart.airport.icao} charts · gate-to-gate ready (${sec}s)`
        : `${data.airport.icao} · ${data.layout.stats.taxiway_segments} segments · ${data.layout.stats.named_taxiways} taxiways${src} (${sec}s)`,
      "ok"
    );
    setHint(
      both
        ? `Both airports loaded — taxi out at <strong>${state.depChart.airport.icao}</strong>, taxi in at <strong>${state.destChart.airport.icao}</strong>`
        : `Chart loaded for <strong>${data.airport.icao}</strong> — pick start, runway, and taxiways`,
      true
    );
    setTimeout(() => setHint("", false), 6000);
    return chart;
  } catch (err) {
    console.error(err);
    const msg =
      err.name === "AbortError"
        ? "Timed out waiting for map servers. Click Refresh or try again."
        : err.message;
    setStatus(`Failed: ${msg}`, "err");
    setHint(`Could not load chart: ${escapeHtml(msg)}`, true);
    return null;
  } finally {
    clearInterval(progressTimer);
    clearTimeout(killTimer);
    setLoading(false);
  }
}

function applyChartAsActive(chart, { fit = true, redrawAll = true } = {}) {
  if (!chart) return;
  state.airport = chart.airport;
  state.layout = chart.layout;
  state.runwayEnds = chart.runwayEnds || [];
  renderAirportCard({ airport: chart.airport, layout: chart.layout });
  if (redrawAll) redrawSurfaces({ fit });
  else {
    drawLayout(chart.layout, { fit, clearSurface: true });
  }
  populateSelects({
    airport: chart.airport,
    layout: chart.layout,
    runway_ends: chart.runwayEnds,
  });
  renderTaxiwayButtons(chart.layout.taxiway_names || []);
}

/**
 * Zoom the map to a single airport chart (like first load), not both dep+dest.
 */
function fitChartBounds(chart, { maxZoom = 16, pad = 0.08 } = {}) {
  if (!chart) return;
  try {
    const bounds = [];
    const layout = chart.layout;
    if (layout) {
      for (const tw of layout.taxiways || []) {
        for (const c of tw.coords || []) {
          if (c != null && c[0] != null) bounds.push([c[0], c[1]]);
        }
      }
      for (const rw of layout.runways || []) {
        for (const c of rw.coords || []) {
          if (c != null && c[0] != null) bounds.push([c[0], c[1]]);
        }
      }
      for (const ap of layout.aprons || []) {
        for (const c of ap.coords || []) {
          if (c != null && c[0] != null) bounds.push([c[0], c[1]]);
        }
      }
      for (const p of layout.parking || []) {
        if (p.lat != null && p.lon != null) bounds.push([p.lat, p.lon]);
      }
    }
    if (bounds.length >= 2) {
      const b = L.latLngBounds(bounds);
      if (b.isValid()) {
        map.fitBounds(b.pad(pad), { maxZoom, animate: true });
        return;
      }
    }
    if (chart.airport?.lat != null && chart.airport?.lon != null) {
      map.setView([chart.airport.lat, chart.airport.lon], Math.min(14, maxZoom), {
        animate: true,
      });
    }
  } catch (err) {
    console.warn("fitChartBounds", err);
  }
}

function clearSurfaceLayers() {
  for (const key of ["taxiways", "runways", "aprons", "parking", "labels"]) {
    baseLayers[key]?.clearLayers();
  }
  state.twyLayerByName.clear();
}

/** Arrival / taxi-in phase — inbound clearance UI and dest chart interaction. */
function isArrivalTaxiMode() {
  if (state.mode === "arrival") return true;
  if (state.mode === "journey" && state.journeyStep === "taxi-in") return true;
  if (state.activeTab === "arrival") return true;
  return false;
}

/** Draw dep + dest surface charts together (paths preserved). */
function redrawSurfaces({ fit = false } = {}) {
  clearSurfaceLayers();
  const bounds = [];
  const paint = (chart, opts) => {
    if (!chart?.layout) return;
    paintLayoutOntoMap(chart.layout, {
      ...opts,
      collectBounds: bounds,
    });
  };
  const dep = state.depChart;
  const dest = state.destChart;
  const arrMode = isArrivalTaxiMode();
  // In arrival/taxi-in: dest chart is interactive (clickable taxiways for inbound clearance)
  // Otherwise: dep chart interactive, dest dimmed if both loaded
  if (dep && dest && dep.airport?.icao !== dest.airport?.icao) {
    if (arrMode) {
      paint(dep, { taxiInteractive: false, dim: true });
      paint(dest, { taxiInteractive: true, dim: false });
    } else {
      paint(dep, { taxiInteractive: true, dim: false });
      paint(dest, { taxiInteractive: false, dim: true });
    }
  } else if (dep) {
    paint(dep, { taxiInteractive: true });
  } else if (dest) {
    paint(dest, { taxiInteractive: true });
  } else if (state.layout) {
    // Legacy single layout
    paintLayoutOntoMap(state.layout, {
      taxiInteractive: true,
      collectBounds: bounds,
    });
  }
  if (fit && bounds.length) {
    try {
      map.fitBounds(L.latLngBounds(bounds).pad(0.08));
    } catch (_) {}
  }
}

function renderAirportCard(data) {
  const ap = data.airport;
  const st = data.layout.stats;
  $("#airport-card").classList.add("visible");
  $("#ap-icao").textContent = ap.icao + (ap.iata ? ` / ${ap.iata}` : "");
  $("#ap-name").textContent = [ap.name, ap.city, ap.country].filter(Boolean).join(" · ");
  const roleHint = $("#ap-role-hint");
  if (roleHint) {
    const depI = state.depChart?.airport?.icao;
    const destI = state.destChart?.airport?.icao;
    if (depI && destI && depI !== destI) {
      roleHint.style.display = "block";
      roleHint.innerHTML =
        `Dep <strong>${escapeHtml(depI)}</strong> · Dest <strong>${escapeHtml(destI)}</strong>` +
        ` · editing <strong>${escapeHtml(ap.icao)}</strong>` +
        (isArrivalTaxiMode()
          ? " (arrival / taxi-in)"
          : " (departure / taxi-out)");
    } else {
      roleHint.style.display = "none";
      roleHint.textContent = "";
    }
  }
  $("#ap-stats").innerHTML = `
    <span class="chip ok">${st.named_taxiways} taxiways</span>
    <span class="chip">${st.runways} runways</span>
    <span class="chip">${st.parking} stands/gates</span>
    <span class="chip">${st.taxiway_segments} segments</span>
  `;
}

// ── Draw chart ───────────────────────────────────────────────────
function clearLayers() {
  for (const key of Object.keys(baseLayers)) {
    baseLayers[key].clearLayers();
  }
  state.twyLayerByName.clear();
  $("#dep-summary")?.classList?.remove("visible");
  $("#arr-summary")?.classList?.remove("visible");
}

/**
 * Draw surface geometry without wiping taxi/enroute path layers.
 * @param {object} layout
 * @param {{fit?: boolean, clearSurface?: boolean}} [opts]
 */
function drawLayout(layout, opts = {}) {
  const fit = opts.fit !== false;
  if (opts.clearSurface !== false) clearSurfaceLayers();
  const bounds = [];
  paintLayoutOntoMap(layout, {
    taxiInteractive: true,
    collectBounds: bounds,
  });
  if (fit && bounds.length) {
    try {
      map.fitBounds(L.latLngBounds(bounds).pad(0.08));
    } catch (_) {}
  }
}

function paintLayoutOntoMap(layout, {
  taxiInteractive = true,
  dim = false,
  collectBounds = null,
} = {}) {
  const bounds = collectBounds || [];
  const opMul = dim ? 0.55 : 1;

  for (const apron of layout.aprons || []) {
    if ((apron.coords || []).length < 3) continue;
    const latlngs = apron.coords.map((c) => [c[0], c[1]]);
    L.polygon(latlngs, {
      color: "#334155",
      weight: 1,
      fillColor: "#1e293b",
      fillOpacity: 0.45 * opMul,
    })
      .bindPopup(`Apron: ${apron.name}`)
      .addTo(baseLayers.aprons);
    latlngs.forEach((ll) => bounds.push(ll));
  }

  for (const tw of layout.taxiways || []) {
    const latlngs = tw.coords.map((c) => [c[0], c[1]]);
    const isUnnamed = !tw.name || tw.name === "UNNAMED";
    const line = L.polyline(latlngs, {
      color: isUnnamed ? "#78716c" : dim ? "#ca8a04" : "#f0c040",
      weight: isUnnamed ? 2 : 3.5,
      opacity: (isUnnamed ? 0.45 : 0.9) * opMul,
      lineCap: "round",
      lineJoin: "round",
    }).bindPopup(`Taxiway <strong>${tw.name}</strong>`);
    line.addTo(baseLayers.taxiways);
    if (!isUnnamed && taxiInteractive) {
      if (!state.twyLayerByName.has(tw.name)) {
        state.twyLayerByName.set(tw.name, []);
      }
      state.twyLayerByName.get(tw.name).push(line);
      // Click taxiway on map → clearance (out or in, same as pill buttons)
      line.on("click", (e) => {
        try {
          if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        } catch (_) {}
        if (isArrivalTaxiMode()) addToArrClearance(tw.name);
        else addToClearance(tw.name);
      });
      line.on("mouseover", function () {
        this.setStyle({ weight: 5.5, opacity: 1 });
      });
      line.on("mouseout", function () {
        // re-apply clearance highlight state
        if (isArrivalTaxiMode()) highlightArrClearanceTaxiways();
        else highlightClearanceTaxiways();
      });
    }
    latlngs.forEach((ll) => bounds.push(ll));
  }

  for (const rw of layout.runways || []) {
    const latlngs = rw.coords.map((c) => [c[0], c[1]]);
    L.polyline(latlngs, {
      color: "#9ca3af",
      weight: 10,
      opacity: 0.85 * opMul,
      lineCap: "butt",
    })
      .bindPopup(`Runway <strong>${rw.name}</strong>`)
      .addTo(baseLayers.runways);
    // centerline dashes
    L.polyline(latlngs, {
      color: "#e5e7eb",
      weight: 1.5,
      opacity: 0.7 * opMul,
      dashArray: "8 10",
    }).addTo(baseLayers.runways);
    latlngs.forEach((ll) => bounds.push(ll));
  }

  // Parking / gates — numbered markers on the map
  const parking = layout.parking || [];
  const maxMarkers = dim ? 150 : 600;
  const step = parking.length > maxMarkers ? Math.ceil(parking.length / maxMarkers) : 1;
  for (let i = 0; i < parking.length; i += step) {
    const p = parking[i];
    const name = String(p.name || "").trim();
    if (!name) continue;
    // Skip raw OSM node IDs (long pure numbers) — not useful as gate labels
    if (/^\d{6,}$/.test(name)) continue;

    const isGate = p.type === "gate";
    const kind = isGate ? "Gate" : "Stand";
    const label = `${kind} ${name}`;
    const val = JSON.stringify({ lat: p.lat, lon: p.lon, label });

    const icon = L.divIcon({
      className: "gate-marker",
      html:
        `<div class="gate-label ${isGate ? "is-gate" : "is-stand"}" style="opacity:${opMul}">` +
        `<span class="gate-dot"></span>` +
        `<span class="gate-name">${escapeHtml(name)}</span>` +
        `</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 8],
    });
    const m = L.marker([p.lat, p.lon], {
      icon,
      interactive: true,
      keyboard: false,
      zIndexOffset: 200,
    }).bindPopup(`${kind} <strong>${escapeHtml(name)}</strong>`);

    m.on("click", () => {
      // Taxi-in phase: gate click sets arrival stand
      if (
        (state.mode === "journey" && state.journeyStep === "taxi-in") ||
        state.activeTab === "arrival"
      ) {
        state.arrivalStand = { lat: p.lat, lon: p.lon, label };
        const arrStand = $("#arr-stand-select");
        if (arrStand) {
          let found = false;
          for (const o of arrStand.options) {
            if (o.value === val) {
              found = true;
              break;
            }
          }
          if (!found) {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = label;
            arrStand.appendChild(opt);
          }
          arrStand.value = val;
        }
        updateArrTaxiButtons();
      } else {
        setStart(p.lat, p.lon, label);
        const startSel = $("#start-select");
        if (startSel) {
          let found = false;
          for (const opt of startSel.options) {
            if (opt.value === val) {
              found = true;
              break;
            }
          }
          if (!found) {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = label;
            startSel.appendChild(opt);
          }
          startSel.value = val;
        }
      }
    });
    m.addTo(baseLayers.parking);
  }

  // Taxiway name labels + runway numbers at thresholds
  addTaxiwayLabels(layout);
  // Runway labels only for active/interactive chart to avoid clutter
  if (taxiInteractive) {
    addRunwayLabels(layout, state.runwayEnds || []);
  }

  highlightClearanceTaxiways();
}

function addTaxiwayLabels(layout) {
  const best = new Map(); // name -> {len, mid}
  for (const tw of layout.taxiways || []) {
    if (!tw.name || tw.name === "UNNAMED" || tw.coords.length < 2) continue;
    let len = 0;
    for (let i = 1; i < tw.coords.length; i++) {
      const a = tw.coords[i - 1];
      const b = tw.coords[i];
      const dlat = a[0] - b[0];
      const dlon = a[1] - b[1];
      len += Math.sqrt(dlat * dlat + dlon * dlon);
    }
    const mid = tw.coords[Math.floor(tw.coords.length / 2)];
    const prev = best.get(tw.name);
    if (!prev || len > prev.len) {
      best.set(tw.name, { len, mid });
    }
  }
  for (const [name, info] of best) {
    const icon = L.divIcon({
      className: "",
      html: `<div class="marker-label">${name}</div>`,
      iconSize: null,
      iconAnchor: [12, 10],
    });
    L.marker(info.mid, { icon, interactive: false }).addTo(baseLayers.labels);
  }
}

function parseRwyHeading(desig) {
  const m = String(desig).trim().match(/^(\d{1,2})/);
  if (!m) return null;
  let n = parseInt(m[1], 10);
  if (n === 0) n = 36;
  return (n % 36) * 10;
}

function bearingDeg(a, b) {
  const toRad = Math.PI / 180;
  const lat1 = a[0] * toRad;
  const lat2 = b[0] * toRad;
  const dlon = (b[1] - a[1]) * toRad;
  const y = Math.sin(dlon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function headingDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/** Place large runway designator labels at each threshold. */
function addRunwayLabels(layout, runwayEnds) {
  // Prefer API-computed ends (deduped, real numbers like 07 / 25)
  if (runwayEnds && runwayEnds.length) {
    for (const re of runwayEnds) {
      const n = String(re.name || "");
      if (!n || /\(A\)|\(B\)/i.test(n) || n.toUpperCase() === "RWY") continue;
      placeRunwayLabel(re.lat, re.lon, n);
    }
    return;
  }

  // Fallback: per-runway ends from layout, then geometry
  for (const rw of layout.runways || []) {
    if (rw.ends && rw.ends.length >= 2) {
      for (const e of rw.ends) {
        placeRunwayLabel(e.lat, e.lon, e.name);
      }
      continue;
    }
    const coords = rw.coords || [];
    if (coords.length < 2) continue;
    const name = rw.name || "";
    const parts = name.replace(/\s+/g, "").split("/").filter(Boolean);
    const endA = coords[0];
    const endB = coords[coords.length - 1];
    if (parts.length >= 2 && /^\d/.test(parts[0])) {
      // Designator at a threshold = landing course FROM that end TO the far end
      const h0 = parseRwyHeading(parts[0]);
      const leaveA = bearingDeg(endA, endB);
      const leaveB = bearingDeg(endB, endA);
      let nameA = parts[0];
      let nameB = parts[1];
      if (h0 != null) {
        if (headingDelta(leaveA, h0) > headingDelta(leaveB, h0)) {
          nameA = parts[1];
          nameB = parts[0];
        }
      }
      placeRunwayLabel(endA[0], endA[1], nameA);
      placeRunwayLabel(endB[0], endB[1], nameB);
    }
  }
}

function placeRunwayLabel(lat, lon, text) {
  const icon = L.divIcon({
    className: "",
    html: `<div class="runway-label">${escapeHtml(String(text))}</div>`,
    iconSize: null,
    iconAnchor: [18, 12],
  });
  L.marker([lat, lon], { icon, interactive: false, zIndexOffset: 500 }).addTo(
    baseLayers.labels
  );
}

function highlightClearanceTaxiways() {
  // reset all
  for (const [, lines] of state.twyLayerByName) {
    for (const line of lines) {
      line.setStyle({ color: "#f0c040", weight: 3.5, opacity: 0.9 });
    }
  }
  const names = isArrivalTaxiMode()
    ? state.arrClearance || []
    : state.clearance || [];
  const color = isArrivalTaxiMode() ? "#38bdf8" : "#f97316";
  for (const name of names) {
    const lines = state.twyLayerByName.get(name) || [];
    for (const line of lines) {
      line.setStyle({ color, weight: 5, opacity: 1 });
    }
  }
}

function highlightArrClearanceTaxiways() {
  highlightClearanceTaxiways();
}

// ── Selects ──────────────────────────────────────────────────────
function runwayOptionValue(re) {
  return JSON.stringify({
    lat: re.lat,
    lon: re.lon,
    label: `RWY ${re.name}`,
    name: re.name,
    approach_hdg: re.approach_hdg ?? null,
    runway: re.runway || null,
  });
}

function fillRunwaySelect(sel, ends, placeholder) {
  sel.disabled = false;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  for (const re of ends || []) {
    const opt = document.createElement("option");
    opt.value = runwayOptionValue(re);
    opt.textContent = `Runway ${re.name}${
      re.runway && re.runway !== re.name ? ` (${re.runway})` : ""
    }`;
    sel.appendChild(opt);
  }
}

function populateSelects(data) {
  const startSel = $("#start-select");
  const rwySel = $("#runway-select");
  const depRwy = $("#dep-runway-select");
  const arrRwy = $("#arr-runway-select");
  const arrStand = $("#arr-stand-select");

  startSel.disabled = false;
  startSel.innerHTML = `<option value="">— Click map or pick stand (${(data.layout.parking || []).length}) —</option>`;
  const parking = [...(data.layout.parking || [])];
  // Backend already sorts; keep stable natural-ish order
  for (const p of parking) {
    const opt = document.createElement("option");
    const label = `${p.type === "gate" ? "Gate" : "Stand"} ${p.name}`;
    opt.value = JSON.stringify({ lat: p.lat, lon: p.lon, label });
    opt.textContent = label;
    startSel.appendChild(opt);
  }

  // Arrival stand list
  if (arrStand) {
    arrStand.disabled = false;
    arrStand.innerHTML = `<option value="">— Select stand for taxi-in (${parking.length}) —</option>`;
    for (const p of parking) {
      const opt = document.createElement("option");
      const label = `${p.type === "gate" ? "Gate" : "Stand"} ${p.name}`;
      opt.value = JSON.stringify({ lat: p.lat, lon: p.lon, label });
      opt.textContent = label;
      arrStand.appendChild(opt);
    }
    arrStand.onchange = () => {
      if (!arrStand.value) {
        state.arrivalStand = null;
        updateArrTaxiButtons();
        return;
      }
      const v = JSON.parse(arrStand.value);
      state.arrivalStand = { lat: v.lat, lon: v.lon, label: v.label };
      // Gate marker
      baseLayers.markers.eachLayer((layer) => {
        if (layer._isArrStand) baseLayers.markers.removeLayer(layer);
      });
      const m = L.circleMarker([v.lat, v.lon], {
        radius: 8,
        color: "#38bdf8",
        fillColor: "#0284c7",
        fillOpacity: 1,
        weight: 2,
      }).bindPopup(`Taxi-in: <strong>${v.label}</strong>`);
      m._isArrStand = true;
      m.addTo(baseLayers.markers);
      updateArrTaxiButtons();
    };
  }

  const ends = data.runway_ends || [];
  fillRunwaySelect(rwySel, ends, "— Select runway —");
  fillRunwaySelect(depRwy, ends, "— Select departure runway —");
  fillRunwaySelect(arrRwy, ends, "— Select landing runway —");

  startSel.onchange = () => {
    if (!startSel.value) return;
    const v = JSON.parse(startSel.value);
    setStart(v.lat, v.lon, v.label);
  };

  const onRwyChange = (sel, alsoArrival) => {
    if (!sel.value) return;
    const v = JSON.parse(sel.value);
    applyRunwaySelection(v, { syncFrom: sel.id, forArrival: alsoArrival });
  };

  rwySel.onchange = () => onRwyChange(rwySel, false);
  depRwy.onchange = () => onRwyChange(depRwy, false);
  arrRwy.onchange = () => onRwyChange(arrRwy, true);

  $("#btn-route").disabled = false;
  $("#btn-dep-suggest").disabled = false;
  $("#btn-arr-suggest").disabled = false;
}

function applyRunwaySelection(v, { syncFrom, forArrival }) {
  setEnd(v.lat, v.lon, v.label);
  state.runwayEndMeta = {
    name: v.name,
    lat: v.lat,
    lon: v.lon,
    approach_hdg: v.approach_hdg,
    runway: v.runway,
  };
  // Keep taxi / dep / arr runway dropdowns in sync
  const payload = runwayOptionValue(state.runwayEndMeta);
  for (const id of ["runway-select", "dep-runway-select", "arr-runway-select"]) {
    const el = $(`#${id}`);
    if (!el || el.id === syncFrom) continue;
    // match by name
    for (const opt of el.options) {
      if (!opt.value) continue;
      try {
        if (JSON.parse(opt.value).name === v.name) {
          el.value = opt.value;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }
  onRunwayChangedForDeparture();
  onRunwayChangedForArrival();
  updateArrTaxiButtons();
}

function updateArrTaxiButtons() {
  const ready = !!(state.airport && state.runwayEndMeta && state.arrivalStand);
  const a = $("#btn-arr-taxi-show");
  const b = $("#btn-arr-taxi-best");
  if (a) a.disabled = !ready;
  if (b) b.disabled = !ready;
}

function setStart(lat, lon, label) {
  state.start = { lat, lon, label };
  baseLayers.markers.eachLayer((layer) => {
    if (layer._isStart) baseLayers.markers.removeLayer(layer);
  });
  const m = L.circleMarker([lat, lon], {
    radius: 9,
    color: "#22c55e",
    fillColor: "#16a34a",
    fillOpacity: 1,
    weight: 3,
  }).bindPopup(`Start: <strong>${label || "Position"}</strong>`);
  m._isStart = true;
  m.addTo(baseLayers.markers);
  updateRouteButton();
}

function setEnd(lat, lon, label) {
  state.end = { lat, lon, label };
  baseLayers.markers.eachLayer((layer) => {
    if (layer._isEnd) baseLayers.markers.removeLayer(layer);
  });
  const m = L.circleMarker([lat, lon], {
    radius: 9,
    color: "#ef4444",
    fillColor: "#b91c1c",
    fillOpacity: 1,
    weight: 3,
  }).bindPopup(`Runway: <strong>${label || "End"}</strong>`);
  m._isEnd = true;
  m.addTo(baseLayers.markers);
  updateRouteButton();
}

function updateRouteButton() {
  $("#btn-route").disabled = !(state.airport && state.start && state.end);
}

// ── Clearance UI ─────────────────────────────────────────────────
function renderTaxiwayButtons(names) {
  // Outbound grid
  fillTwyGrid($("#twy-grid"), names, (name) => addToClearance(name), state.clearance);
  // Inbound grid (same names from active arrival chart)
  fillTwyGrid(
    $("#arr-twy-grid"),
    names,
    (name) => addToArrClearance(name),
    state.arrClearance || []
  );
}

function fillTwyGrid(grid, names, onClick, selectedList) {
  if (!grid) return;
  grid.innerHTML = "";
  if (!names.length) {
    grid.innerHTML =
      '<span style="font-size:0.8rem;color:var(--text-muted)">No named taxiways in OSM for this airport.</span>';
    return;
  }
  for (const name of names) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "twy-btn";
    btn.textContent = name;
    btn.dataset.name = name;
    if ((selectedList || []).includes(name)) btn.classList.add("selected");
    btn.addEventListener("click", () => onClick(name));
    grid.appendChild(btn);
  }
}

function addToClearance(name) {
  if (!name) return;
  state.clearance.push(name);
  renderClearance();
  highlightClearanceTaxiways();
}

function removeClearanceAt(index) {
  state.clearance.splice(index, 1);
  renderClearance();
  highlightClearanceTaxiways();
}

function renderClearance() {
  const row = $("#clearance-row");
  if (!row) return;
  row.innerHTML = "";
  state.clearance.forEach((name, i) => {
    const pill = document.createElement("span");
    pill.className = "twy-pill";
    pill.innerHTML = `${escapeHtml(name)} <span class="x">✕</span>`;
    pill.title = "Remove";
    pill.addEventListener("click", () => removeClearanceAt(i));
    row.appendChild(pill);
  });
  // mark selected buttons (outbound grid only)
  document.querySelectorAll("#twy-grid .twy-btn").forEach((btn) => {
    btn.classList.toggle("selected", state.clearance.includes(btn.dataset.name));
  });
  const textEl = $("#clearance-text");
  if (textEl && document.activeElement !== textEl) {
    textEl.value = state.clearance.join(" ");
  }
}

function addToArrClearance(name) {
  if (!name) return;
  if (!state.arrClearance) state.arrClearance = [];
  state.arrClearance.push(name);
  renderArrClearance();
  highlightArrClearanceTaxiways();
}

function removeArrClearanceAt(index) {
  if (!state.arrClearance) return;
  state.arrClearance.splice(index, 1);
  renderArrClearance();
  highlightArrClearanceTaxiways();
}

function renderArrClearance() {
  const row = $("#arr-clearance-row");
  if (row) {
    row.innerHTML = "";
    (state.arrClearance || []).forEach((name, i) => {
      const pill = document.createElement("span");
      pill.className = "twy-pill";
      pill.innerHTML = `${escapeHtml(name)} <span class="x">✕</span>`;
      pill.title = "Remove";
      pill.addEventListener("click", () => removeArrClearanceAt(i));
      row.appendChild(pill);
    });
  }
  document.querySelectorAll("#arr-twy-grid .twy-btn").forEach((btn) => {
    btn.classList.toggle(
      "selected",
      (state.arrClearance || []).includes(btn.dataset.name)
    );
  });
  const textEl = $("#arr-taxi-clearance");
  if (textEl && document.activeElement !== textEl) {
    textEl.value = (state.arrClearance || []).join(" ");
  }
}

function syncArrClearanceFromText() {
  const parsed = parseClearanceText($("#arr-taxi-clearance")?.value || "");
  state.arrClearance = parsed;
  renderArrClearance();
  highlightArrClearanceTaxiways();
}

function clearTaxiPage() {
  // Clearance
  state.clearance = [];
  const textEl = $("#clearance-text");
  if (textEl) textEl.value = "";
  renderClearance();
  highlightClearanceTaxiways();
  // Drawn taxi-out path + summary
  clearRoute();
  setStatus("Taxi path and clearance cleared", "ok");
}

const btnClearTaxi = $("#btn-clear-clearance");
if (btnClearTaxi) {
  btnClearTaxi.addEventListener("click", (e) => {
    e.preventDefault();
    clearTaxiPage();
  });
}

const PHONETIC = {
  ALPHA: "A",
  BRAVO: "B",
  CHARLIE: "C",
  DELTA: "D",
  ECHO: "E",
  FOXTROT: "F",
  GOLF: "G",
  HOTEL: "H",
  INDIA: "I",
  JULIET: "J",
  JULIETT: "J",
  KILO: "K",
  LIMA: "L",
  MIKE: "M",
  NOVEMBER: "N",
  OSCAR: "O",
  PAPA: "P",
  QUEBEC: "Q",
  ROMEO: "R",
  SIERRA: "S",
  TANGO: "T",
  UNIFORM: "U",
  VICTOR: "V",
  WHISKEY: "W",
  XRAY: "X",
  "X-RAY": "X",
  YANKEE: "Y",
  ZULU: "Z",
};

function parseClearanceText(text) {
  const raw = text.toUpperCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  // Drop common ATC filler words
  const skip = new Set([
    "TAXI",
    "VIA",
    "TO",
    "HOLD",
    "SHORT",
    "RUNWAY",
    "RWY",
    "CROSS",
    "AND",
    "THE",
    "AT",
    "ON",
    "FOR",
    "DEPARTURE",
  ]);
  const tokens = raw.split(" ").filter((t) => t && !skip.has(t));
  const out = [];
  for (let t of tokens) {
    if (PHONETIC[t]) t = PHONETIC[t];
    // Match against known taxiway names when airport loaded
    const names = state.layout?.taxiway_names || [];
    const exact = names.find((n) => n.toUpperCase() === t);
    if (exact) {
      out.push(exact);
      continue;
    }
    // keep token as typed (e.g. A1)
    if (/^[A-Z]{1,3}\d*[A-Z]?$/.test(t) || /^[A-Z]\d+[A-Z]?$/.test(t)) {
      out.push(t);
    }
  }
  return out;
}

$("#clearance-text").addEventListener("change", () => {
  const parsed = parseClearanceText($("#clearance-text").value);
  if (parsed.length) {
    state.clearance = parsed;
    renderClearance();
    highlightClearanceTaxiways();
  }
});

$("#clearance-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const parsed = parseClearanceText($("#clearance-text").value);
    state.clearance = parsed;
    renderClearance();
    highlightClearanceTaxiways();
  }
});

// ── Routing ──────────────────────────────────────────────────────
/**
 * @param {boolean} useClearance
 * @param {{ quiet?: boolean, fromAircraft?: boolean, skipFit?: boolean }} opts
 */
async function computeRoute(useClearance = true, opts = {}) {
  const quiet = !!opts.quiet;
  const fromAircraft = !!opts.fromAircraft;
  if (!state.airport || !state.end) {
    if (!quiet) setStatus("Select start position and runway first", "err");
    return null;
  }
  let startLat = state.start?.lat;
  let startLon = state.start?.lon;
  if (fromAircraft && state.sim.lat != null && state.sim.lon != null) {
    startLat = state.sim.lat;
    startLon = state.sim.lon;
    state.start = {
      lat: startLat,
      lon: startLon,
      label: quiet ? "Aircraft (auto re-route)" : "Aircraft (live)",
    };
  }
  if (startLat == null || startLon == null) {
    if (!quiet) setStatus("Select start position and runway first", "err");
    return null;
  }
  if (!quiet) {
    setLoading(true, "Computing taxi path…");
    setStatus("Routing…", "busy");
  }
  try {
    const res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        icao: state.airport.icao,
        start_lat: startLat,
        start_lon: startLon,
        end_lat: state.end.lat,
        end_lon: state.end.lon,
        clearance: useClearance ? state.clearance : [],
        // Always target the runway *threshold end*, not a mid-runway join
        end_is_runway_threshold: true,
        far_lat: getOppositeRunwayEnd()?.lat ?? null,
        far_lon: getOppositeRunwayEnd()?.lon ?? null,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || "Routing failed");
    }
    drawRoute(data, { skipFit: quiet || !!opts.skipFit });
    showRouteSummary(data);
    setStatus(
      quiet
        ? "Taxi path updated from aircraft position"
        : data.message || "Route ready",
      "ok"
    );
    return data;
  } catch (err) {
    console.error(err);
    if (!quiet) {
      setStatus(err.message, "err");
      $("#route-summary").classList.remove("visible");
    }
    return null;
  } finally {
    if (!quiet) setLoading(false);
  }
}

function drawRoute(data, opts = {}) {
  baseLayers.route.clearLayers();
  if (!data.coords || data.coords.length < 2) {
    clearPathTrack("route");
    return;
  }
  const latlngs = data.coords.map((c) => [c[0], c[1]]);
  // glow
  L.polyline(latlngs, {
    color: "#0891b2",
    weight: 12,
    opacity: 0.35,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(baseLayers.route);
  L.polyline(latlngs, {
    color: "#22d3ee",
    weight: 5,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
  })
    .bindPopup(data.message || "Taxi path")
    .addTo(baseLayers.route);
  setPathTrack("route", latlngs, { name: "Taxi out" });
  if (state.sim.lat != null) updateActiveLeg(state.sim.lat, state.sim.lon);
  if (!opts.skipFit) {
    map.fitBounds(latlngs, { padding: [50, 50], maxZoom: 17 });
  }
}

function clearRoute() {
  baseLayers.route.clearLayers();
  clearPathTrack("route");
  $("#route-summary").classList.remove("visible");
  // keep departure until explicitly cleared
}

function showRouteSummary(data) {
  const el = $("#route-summary");
  el.classList.add("visible");
  $("#route-dist").textContent = `${data.distance_nm} NM · ${data.distance_m} m`;
  $("#route-msg").textContent = data.message || "";
  const via = (data.taxiways_used || []).join(" → ");
  $("#route-via").textContent = via ? `VIA ${via}` : "";
}

$("#btn-route").addEventListener("click", () => computeRoute(true));
$("#btn-auto-route").addEventListener("click", () => computeRoute(false));

// ── Departures / SIDs ────────────────────────────────────────────
async function onRunwayChangedForDeparture() {
  if (!state.airport || !state.runwayEndMeta) {
    resetDepSelect();
    return;
  }
  const sugBtn = $("#btn-dep-suggest");
  const showBtn = $("#btn-dep-show");
  if (sugBtn) sugBtn.disabled = false;
  if (showBtn) showBtn.disabled = false;
  // Load published SIDs for this runway into the dropdown
  try {
    const rwy = encodeURIComponent(state.runwayEndMeta.name || "");
    const res = await fetch(
      `/api/airports/${encodeURIComponent(state.airport.icao)}/departures?runway=${rwy}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatApiError(data, "Could not load SIDs"));
    const catalog = (data.sids || []).map((s) => ({
      ...s,
      kind: "sid",
    }));
    if (catalog.length) {
      state.depSuggestions = catalog;
      populateDepSelect(
        catalog,
        `SIDs for RWY ${state.runwayEndMeta.name} (catalog + SimBrief)`
      );
      const sb = catalog.filter((s) => s.source === "simbrief").length;
      setStatus(
        `${catalog.length} SID(s) for RWY ${state.runwayEndMeta.name}` +
          (sb ? ` · ${sb} from SimBrief` : ""),
        "ok"
      );
      return;
    }
    setStatus("No published SIDs — loading suggested departures…", "busy");
    await loadSuggestions({ quiet: true });
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Could not load SIDs", "err");
    try {
      await loadSuggestions({ quiet: true });
    } catch (_) {
      resetDepSelect();
    }
  }
}

function resetDepSelect() {
  const sel = $("#dep-select");
  if (sel) {
    sel.disabled = true;
    sel.innerHTML = `<option value="">Select runway first</option>`;
  }
  const show = $("#btn-dep-show");
  if (show) show.disabled = true;
  const sug = $("#btn-dep-suggest");
  if (sug) sug.disabled = !state.runwayEndMeta;
}

function formatApiError(data, fallback) {
  if (!data) return fallback;
  const d = data.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((x) => (typeof x === "string" ? x : x.msg || JSON.stringify(x)))
      .join("; ");
  }
  if (data.error) return String(data.error);
  if (data.message) return String(data.message);
  return fallback;
}

function ensurePathLayerVisible(key) {
  state.layerVisibility[key] = true;
  const layer = baseLayers[key];
  if (layer && !map.hasLayer(layer)) layer.addTo(map);
  document.querySelectorAll(`.layer-chip[data-layer="${key}"]`).forEach((chip) => {
    chip.classList.add("active");
  });
}

function populateDepSelect(items, placeholder) {
  const sel = $("#dep-select");
  if (!sel) return;
  sel.disabled = false;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder || "— Select departure —";
  sel.appendChild(ph);
  for (const s of items) {
    const opt = document.createElement("option");
    opt.value = s.id;
    let tag = s.kind === "sid" ? "SID" : s.type || "SUG";
    if (s.source === "simbrief") tag = "SimBrief";
    opt.textContent = `[${tag}] ${s.name}`;
    opt.title = s.description || "";
    sel.appendChild(opt);
  }
  const showBtn = $("#btn-dep-show");
  if (showBtn) showBtn.disabled = false;
}

async function loadSuggestions(opts = {}) {
  const quiet = !!opts.quiet;
  if (!state.airport || !state.runwayEndMeta) {
    if (!quiet) setStatus("Select a departure runway first", "err");
    return;
  }
  if (!quiet) {
    setLoading(true, "Finding departure options…");
    setStatus("Suggesting departures…", "busy");
  }
  try {
    const res = await fetch("/api/departures/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        icao: state.airport.icao,
        runway: {
          name: String(state.runwayEndMeta.name || ""),
          lat: Number(state.runwayEndMeta.lat),
          lon: Number(state.runwayEndMeta.lon),
          approach_hdg:
            state.runwayEndMeta.approach_hdg != null
              ? Number(state.runwayEndMeta.approach_hdg)
              : null,
          runway: state.runwayEndMeta.runway || null,
        },
        limit: 8,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatApiError(data, "Suggest failed"));
    state.depSuggestions = data.suggestions || [];
    populateDepSelect(
      state.depSuggestions,
      quiet
        ? `Suggested for RWY ${state.runwayEndMeta.name} (no published SIDs)`
        : `Suggestions for RWY ${state.runwayEndMeta.name}`
    );
    setStatus(
      `${state.depSuggestions.length} departure option(s) for RWY ${state.runwayEndMeta.name}`,
      "ok"
    );
    if (!quiet) {
      setHint("Pick a SID or suggested route, then <strong>Show SID</strong>", true);
      setTimeout(() => setHint("", false), 4000);
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Suggest failed", "err");
  } finally {
    if (!quiet) setLoading(false);
  }
}

async function showDeparture() {
  if (!state.airport || !state.runwayEndMeta) {
    setStatus("Select a departure runway first", "err");
    return;
  }
  const sel = $("#dep-select");
  let sidId = sel ? sel.value : "";
  const atcEl = $("#dep-atc");
  const atcText = (atcEl && atcEl.value ? atcEl.value : "").trim();

  if (!sidId && !atcText) {
    setStatus("Pick a SID (or click Suggest), or type the ATC departure clearance", "err");
    return;
  }

  const meta = (state.depSuggestions || []).find((s) => s.id === sidId) || null;
  if (!sidId && atcText) sidId = "AUTO";

  setLoading(true, "Building departure route…");
  setStatus("Building SID / departure path…", "busy");
  try {
    const res = await fetch("/api/departures/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        icao: state.airport.icao,
        runway: {
          name: String(state.runwayEndMeta.name || ""),
          lat: Number(state.runwayEndMeta.lat),
          lon: Number(state.runwayEndMeta.lon),
          approach_hdg:
            state.runwayEndMeta.approach_hdg != null
              ? Number(state.runwayEndMeta.approach_hdg)
              : null,
          runway: state.runwayEndMeta.runway || null,
        },
        sid_id: sidId || "AUTO",
        meta: meta,
        atc_text: atcText || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(formatApiError(data, "Could not build departure"));
    }
    drawDeparture(data);
    showDepSummary(data);
    setStatus(data.message || "Departure ready", "ok");
  } catch (err) {
    console.error(err);
    setStatus(typeof err.message === "string" ? err.message : "Departure failed", "err");
    $("#dep-summary")?.classList?.remove("visible");
  } finally {
    setLoading(false);
  }
}

function drawDeparture(data) {
  baseLayers.departure.clearLayers();
  const coords = data.coords || (data.points || []).map((p) => [p.lat, p.lon]);
  if (!coords || coords.length < 2) {
    clearPathTrack("departure");
    state.activeDeparture = null;
    setStatus("Departure path has no coordinates", "err");
    return;
  }
  state.activeDeparture = data;
  const latlngs = coords.map((c) => [c[0], c[1]]);

  ensurePathLayerVisible("departure");

  L.polyline(latlngs, {
    color: "#6b21a8",
    weight: 12,
    opacity: 0.3,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(baseLayers.departure);

  L.polyline(latlngs, {
    color: "#c084fc",
    weight: 4,
    opacity: 1,
    dashArray: "10 8",
    lineCap: "round",
    lineJoin: "round",
  })
    .bindPopup(
      `<strong>${escapeHtml(data.sid_name || "Departure")}</strong><br>${escapeHtml(
        data.message || ""
      )}`
    )
    .addTo(baseLayers.departure);

  // Fix labels along the path
  for (const p of data.points || []) {
    if (p.kind === "runway" || p.lat == null || p.lon == null) continue;
    const icon = L.divIcon({
      className: "",
      html: `<div class="dep-fix-label">${escapeHtml(p.ident || "")}</div>`,
      iconSize: [0, 0],
      iconAnchor: [16, 10],
    });
    L.marker([p.lat, p.lon], { icon, interactive: false, zIndexOffset: 400 }).addTo(
      baseLayers.departure
    );
  }

  const labels = (data.points || []).map((p) => p.ident || "");
  setPathTrack("departure", latlngs, {
    name: data.sid_name || "Departure",
    labels: labels.length === latlngs.length ? labels : null,
  });
  if (state.sim.lat != null) updateActiveLeg(state.sim.lat, state.sim.lon);
  // Re-link enroute plan to this SID exit if a plan is on the map
  relinkFlightPlanToProcedures();

  try {
    const b = L.latLngBounds(latlngs);
    if (b.isValid()) map.fitBounds(b.pad(0.2), { maxZoom: 12 });
  } catch (err) {
    console.warn("fitBounds departure", err);
  }
}

function clearDeparture() {
  baseLayers.departure.clearLayers();
  clearPathTrack("departure");
  state.activeDeparture = null;
  $("#dep-summary")?.classList?.remove("visible");
  const atc = $("#dep-atc");
  if (atc) atc.value = "";
  relinkFlightPlanToProcedures();
}

function showDepSummary(data) {
  const el = $("#dep-summary");
  if (!el) return;
  el.classList.add("visible");
  const dist = $("#dep-dist");
  const msg = $("#dep-msg");
  const via = $("#dep-via");
  if (dist)
    dist.textContent = `${data.distance_nm ?? "—"} NM · HDG ${data.departure_hdg ?? "—"}°`;
  if (msg) msg.textContent = data.message || data.description || "";
  if (via) {
    const path = (data.points || []).map((p) => p.ident).filter(Boolean).join(" → ");
    via.textContent = path || "";
  }
}

$("#btn-dep-suggest")?.addEventListener("click", () => loadSuggestions());
$("#btn-dep-show")?.addEventListener("click", () => showDeparture());
$("#btn-dep-clear")?.addEventListener("click", () => clearDeparture());
$("#dep-atc")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    showDeparture();
  }
});

// ── Arrivals / STARs ─────────────────────────────────────────────
async function onRunwayChangedForArrival() {
  if (!state.airport || !state.runwayEndMeta) {
    resetArrSelect();
    return;
  }
  const sugBtn = $("#btn-arr-suggest");
  const showBtn = $("#btn-arr-show");
  if (sugBtn) sugBtn.disabled = false;
  if (showBtn) showBtn.disabled = false;
  try {
    const rwy = encodeURIComponent(state.runwayEndMeta.name || "");
    const res = await fetch(
      `/api/airports/${encodeURIComponent(state.airport.icao)}/arrivals?runway=${rwy}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatApiError(data, "Could not load STARs"));
    const catalog = (data.stars || []).map((s) => ({ ...s, kind: "star" }));
    if (catalog.length) {
      state.arrSuggestions = catalog;
      populateArrSelect(
        catalog,
        `STARs for RWY ${state.runwayEndMeta.name} (catalog + SimBrief)`
      );
      const sb = catalog.filter((s) => s.source === "simbrief").length;
      setStatus(
        `${catalog.length} STAR(s) for RWY ${state.runwayEndMeta.name}` +
          (sb ? ` · ${sb} from SimBrief` : ""),
        "ok"
      );
      return;
    }
    // No catalog entries — auto-load vector suggestions (no extra click)
    setStatus("No published STARs — loading suggested arrivals…", "busy");
    await loadArrivalSuggestions({ quiet: true });
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Could not load STARs", "err");
    // Still try suggestions so dropdown is usable
    try {
      await loadArrivalSuggestions({ quiet: true });
    } catch (_) {
      resetArrSelect();
    }
  }
}

function resetArrSelect() {
  const sel = $("#arr-select");
  if (sel) {
    sel.disabled = true;
    sel.innerHTML = `<option value="">Select runway first</option>`;
  }
  const show = $("#btn-arr-show");
  if (show) show.disabled = true;
  const sug = $("#btn-arr-suggest");
  if (sug) sug.disabled = !state.runwayEndMeta;
}

function populateArrSelect(items, placeholder) {
  const sel = $("#arr-select");
  if (!sel) return;
  sel.disabled = false;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder || "— Select arrival —";
  sel.appendChild(ph);
  for (const s of items) {
    const opt = document.createElement("option");
    opt.value = s.id;
    let tag = s.kind === "star" ? "STAR" : s.type || "SUG";
    if (s.source === "simbrief") tag = "SimBrief";
    opt.textContent = `[${tag}] ${s.name}`;
    opt.title = s.description || "";
    sel.appendChild(opt);
  }
  const showBtn = $("#btn-arr-show");
  if (showBtn) showBtn.disabled = false;
}

async function loadArrivalSuggestions(opts = {}) {
  const quiet = !!opts.quiet;
  if (!state.airport || !state.runwayEndMeta) {
    if (!quiet) setStatus("Select a landing runway first", "err");
    return;
  }
  if (!quiet) {
    setLoading(true, "Finding arrival options…");
    setStatus("Suggesting arrivals…", "busy");
  }
  try {
    const res = await fetch("/api/arrivals/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        icao: state.airport.icao,
        runway: {
          name: String(state.runwayEndMeta.name || ""),
          lat: Number(state.runwayEndMeta.lat),
          lon: Number(state.runwayEndMeta.lon),
          approach_hdg:
            state.runwayEndMeta.approach_hdg != null
              ? Number(state.runwayEndMeta.approach_hdg)
              : null,
          runway: state.runwayEndMeta.runway || null,
        },
        limit: 8,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatApiError(data, "Suggest failed"));
    state.arrSuggestions = data.suggestions || [];
    populateArrSelect(
      state.arrSuggestions,
      quiet
        ? `Suggested for RWY ${state.runwayEndMeta.name} (no published STARs)`
        : `Suggestions for RWY ${state.runwayEndMeta.name}`
    );
    setStatus(
      `${state.arrSuggestions.length} arrival option(s) for RWY ${state.runwayEndMeta.name}`,
      "ok"
    );
    if (!quiet) {
      setHint("Pick a STAR or suggested arrival, then <strong>Show STAR</strong>", true);
      setTimeout(() => setHint("", false), 4000);
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Suggest failed", "err");
  } finally {
    if (!quiet) setLoading(false);
  }
}

async function showArrival() {
  if (!state.airport || !state.runwayEndMeta) {
    setStatus("Select a landing runway first", "err");
    return;
  }
  const sel = $("#arr-select");
  let starId = sel ? sel.value : "";
  const atcEl = $("#arr-atc");
  const atcText = (atcEl && atcEl.value ? atcEl.value : "").trim();
  if (!starId && !atcText) {
    setStatus("Pick a STAR (or click Suggest), or type the ATC arrival clearance", "err");
    return;
  }
  const meta = (state.arrSuggestions || []).find((s) => s.id === starId) || null;
  if (!starId && atcText) starId = "AUTO";

  setLoading(true, "Building arrival route…");
  setStatus("Building STAR / arrival path…", "busy");
  try {
    const res = await fetch("/api/arrivals/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        icao: state.airport.icao,
        runway: {
          name: String(state.runwayEndMeta.name || ""),
          lat: Number(state.runwayEndMeta.lat),
          lon: Number(state.runwayEndMeta.lon),
          approach_hdg:
            state.runwayEndMeta.approach_hdg != null
              ? Number(state.runwayEndMeta.approach_hdg)
              : null,
          runway: state.runwayEndMeta.runway || null,
        },
        star_id: starId || "AUTO",
        meta: meta,
        atc_text: atcText || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(formatApiError(data, "Could not build arrival"));
    }
    drawArrival(data);
    showArrSummary(data);
    setStatus(data.message || "Arrival ready", "ok");
  } catch (err) {
    console.error(err);
    setStatus(typeof err.message === "string" ? err.message : "Arrival failed", "err");
    $("#arr-summary")?.classList?.remove("visible");
  } finally {
    setLoading(false);
  }
}

function drawArrival(data) {
  baseLayers.arrival.clearLayers();
  const coords = data.coords || (data.points || []).map((p) => [p.lat, p.lon]);
  if (!coords || coords.length < 2) {
    clearPathTrack("arrival");
    state.activeArrival = null;
    setStatus("Arrival path has no coordinates", "err");
    return;
  }
  state.activeArrival = data;
  const latlngs = coords.map((c) => [c[0], c[1]]);
  ensurePathLayerVisible("arrival");

  // Draw STAR feeder (to FAF) thinner, final approach thicker solid green
  const points = data.points || [];
  const finalIdx = points.findIndex((p) => p.kind === "final");
  if (finalIdx > 0) {
    const feeder = latlngs.slice(0, finalIdx + 1);
    const finalSeg = latlngs.slice(finalIdx);
    if (feeder.length >= 2) {
      L.polyline(feeder, {
        color: "#4ade80",
        weight: 3,
        opacity: 0.75,
        dashArray: "8 8",
        lineCap: "round",
      }).addTo(baseLayers.arrival);
    }
    if (finalSeg.length >= 2) {
      L.polyline(finalSeg, {
        color: "#166534",
        weight: 10,
        opacity: 0.3,
        lineCap: "round",
      }).addTo(baseLayers.arrival);
      L.polyline(finalSeg, {
        color: "#4ade80",
        weight: 5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      })
        .bindPopup(
          `<strong>${escapeHtml(data.star_name || "Arrival")}</strong><br>` +
            `Landing <strong>RWY ${escapeHtml(String(data.runway || ""))}</strong> ` +
            `HDG ${data.approach_hdg ?? "—"}°<br>${escapeHtml(data.message || "")}`
        )
        .addTo(baseLayers.arrival);
    }
  } else {
    L.polyline(latlngs, {
      color: "#4ade80",
      weight: 4,
      opacity: 1,
      dashArray: "12 7",
    })
      .bindPopup(escapeHtml(data.message || "Arrival"))
      .addTo(baseLayers.arrival);
  }

  for (const p of points) {
    if (p.kind === "runway") {
      // Landing threshold marker
      L.circleMarker([p.lat, p.lon], {
        radius: 10,
        color: "#4ade80",
        fillColor: "#16a34a",
        fillOpacity: 1,
        weight: 3,
      })
        .bindPopup(`Landing: <strong>${escapeHtml(p.ident)}</strong>`)
        .addTo(baseLayers.arrival);
      continue;
    }
    const icon = L.divIcon({
      className: "",
      html: `<div class="arr-fix-label">${escapeHtml(p.ident)}</div>`,
      iconSize: null,
      iconAnchor: [16, 10],
    });
    L.marker([p.lat, p.lon], { icon, interactive: false, zIndexOffset: 400 }).addTo(
      baseLayers.arrival
    );
  }

  const arrLabels = (data.points || []).map((p) => p.ident || "");
  setPathTrack("arrival", latlngs, {
    name: data.star_name || "Arrival",
    labels: arrLabels.length === latlngs.length ? arrLabels : null,
  });
  if (state.sim.lat != null) updateActiveLeg(state.sim.lat, state.sim.lon);
  // Re-join enroute plan end → STAR entry (after tracks are stored)
  try {
    relinkFlightPlanToProcedures();
  } catch (err) {
    console.warn("relink after STAR", err);
  }

  try {
    const b = L.latLngBounds(latlngs);
    if (b.isValid()) map.fitBounds(b.pad(0.2), { maxZoom: 12 });
  } catch (err) {
    console.warn("fitBounds arrival", err);
  }
}

function clearArrival() {
  baseLayers.arrival.clearLayers();
  clearPathTrack("arrival");
  state.activeArrival = null;
  $("#arr-summary")?.classList?.remove("visible");
  const atc = $("#arr-atc");
  if (atc) atc.value = "";
  relinkFlightPlanToProcedures();
}

function showArrSummary(data) {
  const el = $("#arr-summary");
  if (!el) return;
  el.classList.add("visible");
  const dist = $("#arr-dist");
  const msg = $("#arr-msg");
  const viaEl = $("#arr-via");
  if (dist)
    dist.textContent = `${data.distance_nm ?? "—"} NM · HDG ${data.approach_hdg ?? "—"}°`;
  if (msg) msg.textContent = data.message || data.description || "";
  if (viaEl) {
    const via = (data.points || []).map((p) => p.ident).filter(Boolean).join(" → ");
    viaEl.textContent = via || "";
  }
}

$("#btn-arr-suggest").addEventListener("click", () => loadArrivalSuggestions());
$("#btn-arr-show").addEventListener("click", () => showArrival());
$("#btn-arr-clear").addEventListener("click", () => clearArrival());
$("#arr-atc")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    showArrival();
  }
});

// ── Arrival taxi-in (runway → gate) ───────────────────────────────
function parseClearanceTokens(text) {
  return parseClearanceText(text || "");
}

function haversineApproxM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Opposite threshold of the currently selected runway (same pair). */
function getOppositeRunwayEnd() {
  const land = state.runwayEndMeta || state.end;
  if (!land) return null;
  const ends = state.runwayEnds || [];
  const landName = String(land.name || land.label || "")
    .replace(/^RWY\s*/i, "")
    .toUpperCase();
  const pair = land.runway || null;
  if (pair) {
    const others = ends.filter(
      (e) =>
        e.runway === pair &&
        String(e.name || "").toUpperCase() !== landName
    );
    if (others.length === 1) return others[0];
  }
  // Match by lat/lon to a known end, then find pair opposite
  let best = null;
  let bestD = Infinity;
  for (const e of ends) {
    const d =
      (e.lat - (land.lat || 0)) ** 2 + (e.lon - (land.lon || 0)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best?.runway) {
    const others = ends.filter(
      (e) =>
        e.runway === best.runway &&
        String(e.name || "").toUpperCase() !==
          String(best.name || "").toUpperCase()
    );
    if (others.length === 1) return others[0];
  }
  return null;
}

/**
 * After landing runway NN you roll out toward the far end — taxi-in starts
 * there, not at the approach threshold. Prefer the opposite end of the same
 * runway pair (e.g. land 07 → vacate near 25).
 */
function getTaxiInStartPoint() {
  const land = state.runwayEndMeta;
  if (!land) return null;

  const ends = state.runwayEnds || [];
  const landName = String(land.name || "").toUpperCase();
  const pair = land.runway || null;

  // 1) Same pair string (e.g. "07/25") — other designator
  if (pair && ends.length) {
    const others = ends.filter(
      (e) =>
        e.runway === pair &&
        String(e.name || "").toUpperCase() !== landName
    );
    if (others.length === 1) {
      return {
        lat: others[0].lat,
        lon: others[0].lon,
        label: `Vacate / RWY ${others[0].name} end (after landing ${land.name})`,
        name: others[0].name,
      };
    }
  }

  // 2) Reciprocal number (07↔25, 09L↔27R)
  const m = landName.match(/^(\d{1,2})([LCR]?)$/);
  if (m && ends.length) {
    let n = parseInt(m[1], 10);
    if (n === 0) n = 36;
    const recip = ((n + 17) % 36) + 1; // +18 mod 36, 1–36
    const recipStr = String(recip).padStart(2, "0");
    // Prefer opposite side letter: L↔R, C stays C
    const side = m[2] || "";
    const oppSide = side === "L" ? "R" : side === "R" ? "L" : side;
    const candidates = [
      recipStr + oppSide,
      recipStr + side,
      recipStr,
    ];
    for (const c of candidates) {
      const hit = ends.find(
        (e) => String(e.name || "").toUpperCase() === c.toUpperCase()
      );
      if (hit) {
        return {
          lat: hit.lat,
          lon: hit.lon,
          label: `Vacate / RWY ${hit.name} end (after landing ${land.name})`,
          name: hit.name,
        };
      }
    }
  }

  // 3) Fallback: project ~1.2 NM along landing heading from threshold
  //    (approx. down-runway toward far end if we lack pair data)
  const hdg = land.approach_hdg;
  if (hdg != null && Number.isFinite(Number(hdg))) {
    const distM = 1200;
    const R = 6371000;
    const br = (Number(hdg) * Math.PI) / 180;
    const lat1 = (land.lat * Math.PI) / 180;
    const lon1 = (land.lon * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distM / R) +
        Math.cos(lat1) * Math.sin(distM / R) * Math.cos(br)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(br) * Math.sin(distM / R) * Math.cos(lat1),
        Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2)
      );
    return {
      lat: (lat2 * 180) / Math.PI,
      lon: (lon2 * 180) / Math.PI,
      label: `Rollout (along RWY ${land.name})`,
      name: land.name,
    };
  }

  // Last resort: landing threshold (incorrect but better than nothing)
  return {
    lat: land.lat,
    lon: land.lon,
    label: `RWY ${land.name} threshold`,
    name: land.name,
  };
}

/**
 * @param {boolean} useClearance
 * @param {{ quiet?: boolean, fromAircraft?: boolean, skipFit?: boolean }} opts
 */
async function computeTaxiIn(useClearance, opts = {}) {
  const quiet = !!opts.quiet;
  if (!state.airport || !state.runwayEndMeta || !state.arrivalStand) {
    if (!quiet) setStatus("Select landing runway and gate/stand first", "err");
    return null;
  }
  // Prefer pill/map selection; fall back to text field
  if (useClearance) {
    syncArrClearanceFromText();
  }
  const clearance = useClearance ? state.arrClearance || [] : [];
  if (!quiet) {
    setLoading(true, "Evaluating runway exits…");
    setStatus("Trying early exits + full length for taxi-in…", "busy");
  }
  try {
    const body = {
      icao: state.airport.icao,
      land_runway: state.runwayEndMeta.name,
      stand_lat: state.arrivalStand.lat,
      stand_lon: state.arrivalStand.lon,
      clearance,
    };
    // Live aircraft: always preferred when connected (missed exit re-route)
    if (
      (opts.fromAircraft || state.sim.connected) &&
      state.sim.lat != null &&
      state.sim.lon != null
    ) {
      body.aircraft_lat = state.sim.lat;
      body.aircraft_lon = state.sim.lon;
    }
    const res = await fetch("/api/route/taxi-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Taxi-in routing failed");
    const startNote = data.exit_label || "runway exit";
    drawTaxiIn(
      data,
      {
        startLat: data.exit_lat,
        startLon: data.exit_lon,
        startNote,
      },
      { skipFit: quiet || !!opts.skipFit }
    );
    showArrTaxiSummary(data, startNote);
    let note = quiet
      ? `Taxi-in updated from aircraft (${startNote})`
      : `Taxi-in via ${startNote} → ${state.arrivalStand.label}`;
    if (clearance.length && data.clearance_honoured === false) {
      note += " (clearance not fully matched — try Show taxi-in again)";
    } else if (clearance.length && data.clearance_honoured) {
      note += " · clearance used";
    }
    setStatus(note, "ok");
    return data;
  } catch (err) {
    console.error(err);
    if (!quiet) {
      setStatus(err.message, "err");
      $("#arr-taxi-summary")?.classList.remove("visible");
    }
    return null;
  } finally {
    if (!quiet) setLoading(false);
  }
}

function drawTaxiIn(data, startInfo, opts = {}) {
  baseLayers.taxiIn.clearLayers();
  if (!data.coords || data.coords.length < 2) {
    clearPathTrack("taxiIn");
    return;
  }
  const latlngs = data.coords.map((c) => [c[0], c[1]]);
  L.polyline(latlngs, {
    color: "#0369a1",
    weight: 12,
    opacity: 0.3,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(baseLayers.taxiIn);
  L.polyline(latlngs, {
    color: "#38bdf8",
    weight: 5,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
  })
    .bindPopup(data.message || "Taxi-in path")
    .addTo(baseLayers.taxiIn);

  // Mark vacate / rollout start (far end after landing)
  if (startInfo && startInfo.startLat != null) {
    L.circleMarker([startInfo.startLat, startInfo.startLon], {
      radius: 8,
      color: "#38bdf8",
      fillColor: "#0ea5e9",
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(
        `Taxi-in start:<br><strong>${escapeHtml(startInfo.startNote || "Vacate")}</strong>`
      )
      .addTo(baseLayers.taxiIn);
  }

  setPathTrack("taxiIn", latlngs, { name: "Taxi in" });
  if (state.sim.lat != null) updateActiveLeg(state.sim.lat, state.sim.lon);

  if (!opts.skipFit) {
    try {
      map.fitBounds(latlngs, { padding: [50, 50], maxZoom: 16 });
    } catch {
      /* ignore */
    }
  }
}

function clearTaxiIn() {
  baseLayers.taxiIn.clearLayers();
  clearPathTrack("taxiIn");
  $("#arr-taxi-summary")?.classList.remove("visible");
  state.arrClearance = [];
  if ($("#arr-taxi-clearance")) $("#arr-taxi-clearance").value = "";
  renderArrClearance();
  highlightArrClearanceTaxiways();
}

/** Minimum distance (m) from planned taxi path centerline to trigger re-route. */
const TAXI_OFF_PATH_M = 85;
/** Don't re-route more often than this (ms). */
const TAXI_REROUTE_COOLDOWN_MS = 9000;
/** Near destination — stop re-routing. */
const TAXI_NEAR_GOAL_M = 55;
/** Need a little ground speed so we don't thrash while parked. */
const TAXI_REROUTE_MIN_GS_KT = 2;

function minDistToPathTrack(key, lat, lon) {
  const tr = state.pathTracks?.[key];
  if (!tr?.coords || tr.coords.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < tr.coords.length - 1; i++) {
    const a = tr.coords[i];
    const b = tr.coords[i + 1];
    const { dist } = distPointToSegmentM(lat, lon, a[0], a[1], b[0], b[1]);
    if (dist < best) best = dist;
  }
  return best;
}

/**
 * While MSFS is connected and taxiing, if the aircraft leaves the drawn taxi
 * path (e.g. missed runway exit), recompute from live position.
 */
async function maybeAutoRerouteTaxi(lat, lon) {
  if (!state.autoRerouteTaxi) return;
  if (!state.sim.connected || state.sim.onGround === false) return;
  if (state._taxiRerouteBusy) return;
  if (lat == null || lon == null) return;

  const gs = state.sim.gsKt != null ? Number(state.sim.gsKt) : 0;
  if (gs < TAXI_REROUTE_MIN_GS_KT) return;

  const now = Date.now();
  if (
    state._lastTaxiRerouteAt &&
    now - state._lastTaxiRerouteAt < TAXI_REROUTE_COOLDOWN_MS
  ) {
    return;
  }

  // Avoid re-routing if we barely moved since last re-route
  if (state._lastTaxiReroutePos) {
    const moved = haversineApproxM(
      lat,
      lon,
      state._lastTaxiReroutePos.lat,
      state._lastTaxiReroutePos.lon
    );
    if (moved < 20) return;
  }

  const dOut = minDistToPathTrack("route", lat, lon);
  const dIn = minDistToPathTrack("taxiIn", lat, lon);
  const hasOut = Number.isFinite(dOut) && dOut < 1e8;
  const hasIn = Number.isFinite(dIn) && dIn < 1e8;
  if (!hasOut && !hasIn) return;

  // Which path are we following? Prefer the closer track, or active leg key.
  let focus = null;
  if (hasOut && hasIn) {
    if (state.activeLegInfo?.key === "route") focus = "route";
    else if (state.activeLegInfo?.key === "taxiIn") focus = "taxiIn";
    else focus = dOut <= dIn ? "route" : "taxiIn";
  } else if (hasOut) focus = "route";
  else focus = "taxiIn";

  if (focus === "route") {
    if (!state.end || !state.airport) return;
    if (dOut <= TAXI_OFF_PATH_M) return;
    const nearRwy =
      haversineApproxM(lat, lon, state.end.lat, state.end.lon) <
      TAXI_NEAR_GOAL_M;
    if (nearRwy) return;

    state._taxiRerouteBusy = true;
    state._lastTaxiRerouteAt = now;
    state._lastTaxiReroutePos = { lat, lon };
    try {
      const useClr = !!(state.clearance && state.clearance.length);
      await computeRoute(useClr, {
        quiet: true,
        fromAircraft: true,
        skipFit: true,
      });
    } finally {
      state._taxiRerouteBusy = false;
    }
    return;
  }

  if (focus === "taxiIn") {
    if (!state.arrivalStand || !state.runwayEndMeta || !state.airport) return;
    if (dIn <= TAXI_OFF_PATH_M) return;
    const nearGate =
      haversineApproxM(
        lat,
        lon,
        state.arrivalStand.lat,
        state.arrivalStand.lon
      ) < TAXI_NEAR_GOAL_M;
    if (nearGate) return;

    state._taxiRerouteBusy = true;
    state._lastTaxiRerouteAt = now;
    state._lastTaxiReroutePos = { lat, lon };
    try {
      const useClr = !!(state.arrClearance && state.arrClearance.length);
      await computeTaxiIn(useClr, {
        quiet: true,
        fromAircraft: true,
        skipFit: true,
      });
    } finally {
      state._taxiRerouteBusy = false;
    }
  }
}

function showArrTaxiSummary(data, startNote) {
  const el = $("#arr-taxi-summary");
  if (!el) return;
  el.classList.add("visible");
  $("#arr-taxi-dist").textContent = `${data.distance_nm} NM · ${data.distance_m} m`;
  const from = startNote ? `From ${startNote}. ` : "";
  $("#arr-taxi-msg").textContent =
    from + (data.message || "Taxi-in route (after landing rollout)");
  const via = (data.taxiways_used || []).join(" → ");
  $("#arr-taxi-via").textContent = via ? `VIA ${via}` : "";
}

$("#btn-arr-taxi-show")?.addEventListener("click", () => computeTaxiIn(true));
$("#btn-arr-taxi-best")?.addEventListener("click", () => computeTaxiIn(false));
$("#btn-arr-taxi-clear")?.addEventListener("click", () => clearTaxiIn());
$("#arr-taxi-clearance")?.addEventListener("change", () => syncArrClearanceFromText());
$("#arr-taxi-clearance")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    syncArrClearanceFromText();
    computeTaxiIn(true);
  }
});

// ── SimConnect live aircraft ─────────────────────────────────────
function setUseAircraftVisible(show) {
  for (const id of ["#btn-use-aircraft", "#btn-use-aircraft-start"]) {
    const el = $(id);
    if (el) el.classList.toggle("hidden", !show);
  }
}

function setSimPill(st) {
  const pill = $("#sim-pill");
  const btn = $("#btn-sim-connect");
  const follow = $("#btn-sim-follow");
  const followPlan = $("#btn-follow-plan");
  if (!pill) return;
  pill.classList.remove("on", "searching");
  if (!st.available && st.error && String(st.error).includes("not installed")) {
    pill.textContent = "MSFS: n/a";
    pill.title = st.error || "SimConnect not installed";
    if (btn) btn.classList.add("hidden");
    setUseAircraftVisible(false);
    if (follow) follow.classList.add("hidden");
    if (followPlan) followPlan.classList.add("hidden");
    return;
  }
  if (btn) btn.classList.remove("hidden");
  if (st.connected && st.lat != null) {
    pill.textContent = "MSFS: live";
    pill.classList.add("on");
    if (btn) {
      btn.textContent = "Disconnect";
      btn.classList.add("sim-on");
    }
    if (follow) follow.classList.remove("hidden");
    if (followPlan) followPlan.classList.remove("hidden");
    setUseAircraftVisible(true);
  } else if (st.enabled) {
    pill.textContent = "MSFS: searching…";
    pill.classList.add("searching");
    if (btn) {
      btn.textContent = "Disconnect";
      btn.classList.remove("sim-on");
    }
    if (follow) follow.classList.add("hidden");
    if (followPlan) followPlan.classList.add("hidden");
    setUseAircraftVisible(false);
  } else {
    pill.textContent = "MSFS: off";
    if (btn) {
      btn.textContent = "Connect MSFS";
      btn.classList.remove("sim-on");
    }
    if (follow) follow.classList.add("hidden");
    if (followPlan) followPlan.classList.add("hidden");
    setUseAircraftVisible(false);
  }
}

function fmtSimSpeed(kt) {
  if (kt == null || Number.isNaN(Number(kt))) return "—";
  return Math.round(Number(kt)) + " kt";
}

function fmtSimAlt(ft) {
  if (ft == null || Number.isNaN(Number(ft))) return "—";
  const n = Math.round(Number(ft));
  // Compact FL for cruise; feet near ground
  if (n >= 10000) return "FL" + String(Math.round(n / 100)).padStart(3, "0");
  return n.toLocaleString() + " ft";
}

function fmtSimHdg(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return "—";
  return String(Math.round(Number(deg)) % 360).padStart(3, "0") + "°";
}

function aircraftIcon(heading, { gsKt, altFt } = {}) {
  const h = heading != null ? heading : 0;
  const gs = fmtSimSpeed(gsKt);
  const alt = fmtSimAlt(altFt);
  const hdg = fmtSimHdg(heading);
  return L.divIcon({
    className: "aircraft-icon",
    html:
      '<div class="aircraft-wrap">' +
      '<div class="aircraft-bubble" aria-hidden="true">' +
      '<div class="ac-b-row"><span class="ac-b-k">GS</span><span class="ac-b-v">' +
      gs +
      "</span></div>" +
      '<div class="ac-b-row"><span class="ac-b-k">ALT</span><span class="ac-b-v">' +
      alt +
      "</span></div>" +
      '<div class="ac-b-row"><span class="ac-b-k">HDG</span><span class="ac-b-v">' +
      hdg +
      "</span></div>" +
      "</div>" +
      '<div class="aircraft-arrow" style="transform:rotate(' +
      h +
      'deg)"></div>' +
      "</div>",
    // Wide enough for bubble; anchor at arrow centre bottom
    iconSize: [92, 78],
    iconAnchor: [46, 70],
  });
}

function updateAircraftMarker(lat, lon, heading, extras) {
  baseLayers.aircraft.clearLayers();
  if (lat == null || lon == null) return;
  const gsKt = extras && extras.gsKt != null ? extras.gsKt : state.sim.gsKt;
  const altFt =
    extras && extras.altFt != null ? extras.altFt : state.sim.altitudeFt;
  const m = L.marker([lat, lon], {
    icon: aircraftIcon(heading, { gsKt, altFt }),
    zIndexOffset: 1000,
    interactive: false,
  });
  m.addTo(baseLayers.aircraft);
  // Pure Follow centres on A/C; Follow plan uses applyFollowPlan instead
  if (state.sim.follow && !state.followPlan) {
    map.panTo([lat, lon], { animate: true, duration: 0.4 });
  }
}

async function pollSim() {
  try {
    const res = await fetch("/api/sim/position");
    const st = await res.json();
    state.sim.connected = !!st.connected;
    state.sim.enabled = !!st.enabled;
    setSimPill(st);
    if (st.ok && st.lat != null) {
      state.sim.lat = st.lat;
      state.sim.lon = st.lon;
      state.sim.heading = st.heading_deg;
      state.sim.onGround = st.on_ground;
      state.sim.altitudeFt =
        st.altitude_ft != null ? st.altitude_ft : null;
      state.sim.gsKt = st.gs_kt != null ? st.gs_kt : null;
      updateAircraftMarker(st.lat, st.lon, st.heading_deg, {
        gsKt: state.sim.gsKt,
        altFt: state.sim.altitudeFt,
      });
      updateActiveLeg(st.lat, st.lon);
      // Recompute taxi-out / taxi-in if aircraft left the planned path
      maybeAutoRerouteTaxi(st.lat, st.lon);
    } else if (!st.connected) {
      baseLayers.aircraft.clearLayers();
      baseLayers.activeLeg?.clearLayers();
      state.activeLegInfo = null;
      updateActiveLegHud(null);
      state.sim.altitudeFt = null;
      state.sim.gsKt = null;
    }
  } catch {
    setSimPill({ available: true, enabled: state.sim.enabled, connected: false });
  }
}

function startSimPoll() {
  stopSimPoll();
  pollSim();
  state.sim.pollTimer = setInterval(pollSim, 750);
}

function stopSimPoll() {
  if (state.sim.pollTimer) {
    clearInterval(state.sim.pollTimer);
    state.sim.pollTimer = null;
  }
}

async function toggleSimConnect() {
  try {
    if (state.sim.enabled || state.sim.connected) {
      await fetch("/api/sim/disconnect", { method: "POST" });
      state.sim.enabled = false;
      state.sim.connected = false;
      stopSimPoll();
      baseLayers.aircraft.clearLayers();
      baseLayers.activeLeg?.clearLayers();
      state.activeLegInfo = null;
      updateActiveLegHud(null);
      setSimPill({ available: true, enabled: false, connected: false });
      setStatus("Disconnected from MSFS", "ok");
      return;
    }
    setStatus("Connecting to MSFS…", "busy");
    const res = await fetch("/api/sim/connect", { method: "POST" });
    const st = await res.json();
    state.sim.enabled = !!st.enabled;
    setSimPill(st);
    if (st.error && !st.available) {
      setStatus(st.error, "err");
      return;
    }
    startSimPoll();
    setStatus("Looking for MSFS (start a flight if needed)…", "busy");
  } catch (err) {
    setStatus("SimConnect error: " + err.message, "err");
  }
}

function useAircraftAsStart() {
  if (state.sim.lat == null || state.sim.lon == null) {
    setStatus("No live aircraft position yet", "err");
    return;
  }
  setStart(state.sim.lat, state.sim.lon, "Aircraft (live)");
  setStatus("Taxi start set to live aircraft position", "ok");
}

$("#btn-sim-connect")?.addEventListener("click", () => toggleSimConnect());
$("#btn-sim-follow")?.addEventListener("click", () => {
  state.sim.follow = !state.sim.follow;
  $("#btn-sim-follow")?.classList.toggle("active", state.sim.follow);
  if (state.sim.follow) {
    // Mutual exclusion with Follow plan
    if (state.followPlan) setFollowPlan(false);
    if (state.sim.lat != null) map.panTo([state.sim.lat, state.sim.lon]);
  }
});
$("#btn-follow-plan")?.addEventListener("click", () => {
  setFollowPlan(!state.followPlan);
});
$("#btn-use-aircraft")?.addEventListener("click", () => useAircraftAsStart());
$("#btn-use-aircraft-start")?.addEventListener("click", () => useAircraftAsStart());

// Probe sim availability on boot
fetch("/api/sim/status")
  .then((r) => r.json())
  .then((st) => setSimPill(st))
  .catch(() => setSimPill({ available: false, enabled: false, connected: false }));

// ── Map tools ────────────────────────────────────────────────────
$("#btn-click-start").addEventListener("click", () => {
  state.clickStartMode = !state.clickStartMode;
  $("#btn-click-start").classList.toggle("active", state.clickStartMode);
  setHint(
    state.clickStartMode
      ? "Click the map to set your <strong>aircraft / start</strong> position"
      : "",
    state.clickStartMode
  );
  map.getContainer().style.cursor = state.clickStartMode ? "crosshair" : "";
});

map.on("click", (e) => {
  if (!state.clickStartMode) return;
  setStart(e.latlng.lat, e.latlng.lng, "Map position");
  state.clickStartMode = false;
  $("#btn-click-start").classList.remove("active");
  map.getContainer().style.cursor = "";
  setHint("Start position set", true);
  setTimeout(() => setHint("", false), 2000);
  // reset select
  $("#start-select").value = "";
});

$("#btn-fit").addEventListener("click", () => {
  if (!state.layout) return;
  drawLayout(state.layout);
  if (state.start) setStart(state.start.lat, state.start.lon, state.start.label);
  if (state.end) setEnd(state.end.lat, state.end.lon, state.end.label);
});

$("#btn-refresh").addEventListener("click", () => {
  if (!state.airport) return;
  const asDest = state.mode === "journey" && state.journeyStep === "taxi-in";
  loadAirport(state.airport.icao, {
    refresh: true,
    role: asDest ? "dest" : "dep",
    keepPaths: true,
  });
});

// ── Flight plan ──────────────────────────────────────────────────
function clearFlightPlanLayer() {
  baseLayers.flightPlan.clearLayers();
  clearPathTrack("flightPlan");
  state.flightPlan = null;
  const sum = $("#fp-summary");
  if (sum) sum.classList.remove("visible");
  const w = $("#fp-warnings");
  if (w) w.textContent = "";
}

function _fpNear(a, b, maxM = 2500) {
  if (!a || !b || a.lat == null || b.lat == null) return false;
  return haversineM(Number(a.lat), Number(a.lon), Number(b.lat), Number(b.lon)) <= maxM;
}

/** Airport ref for procedure sanity checks (must match dep/dest, not the other end). */
function _fpAirportRef(which, data) {
  if (which === "dep") {
    return (
      data?.dep ||
      state.depChart?.airport ||
      state.flightPlan?._raw?.dep ||
      state.flightPlan?.dep ||
      null
    );
  }
  // Destination: prefer plan dest, then dest chart, then ICAO field + chart guess
  const fromPlan = data?.dest || state.flightPlan?._raw?.dest || state.flightPlan?.dest;
  if (fromPlan?.lat != null) return fromPlan;
  if (state.destChart?.airport?.lat != null) return state.destChart.airport;
  if (fromPlan?.icao && state.destChart?.airport?.icao === fromPlan.icao) {
    return state.destChart.airport;
  }
  return fromPlan || state.destChart?.airport || null;
}

function _ptFromPair(lat, lon, ident) {
  if (lat == null || lon == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    return null;
  }
  return { lat: Number(lat), lon: Number(lon), ident: ident || "WP" };
}

/**
 * SID exit = procedure point farthest from the departure airport
 * (or last non-runway point). Must live near dep, not dest.
 */
function getSidExitPoint(planData) {
  if (!state.activeDeparture && !(state.pathTracks?.departure?.coords?.length)) {
    return null;
  }
  const depAp = _fpAirportRef("dep", planData);
  const destAp = _fpAirportRef("dest", planData);
  const pts = state.activeDeparture?.points;
  let pt = null;

  if (pts && pts.length) {
    const candidates = pts.filter(
      (p) => p && p.lat != null && p.lon != null && p.kind !== "runway"
    );
    const list = candidates.length ? candidates : pts.filter((p) => p?.lat != null);
    if (list.length && depAp?.lat != null) {
      let best = list[list.length - 1];
      let bestD = -1;
      for (const p of list) {
        const d = haversineM(Number(p.lat), Number(p.lon), Number(depAp.lat), Number(depAp.lon));
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
      pt = _ptFromPair(best.lat, best.lon, best.ident || state.activeDeparture?.sid_name || "SID exit");
    } else if (list.length) {
      const last = list[list.length - 1];
      pt = _ptFromPair(last.lat, last.lon, last.ident || "SID exit");
    }
  }

  if (!pt) {
    const track = state.pathTracks?.departure?.coords;
    if (track && track.length) {
      const last = track[track.length - 1];
      pt = _ptFromPair(
        last[0],
        last[1],
        (state.pathTracks.departure.labels &&
          state.pathTracks.departure.labels[track.length - 1]) ||
          state.activeDeparture?.sid_name ||
          "SID exit"
      );
    }
  }

  if (!pt) return null;
  // Near departure (200 NM) — SIDs can extend well out
  if (depAp?.lat != null && !_fpNear(pt, depAp, 200 * 1852)) {
    console.warn("SID exit ignored — not near departure airport", pt, depAp);
    return null;
  }
  // Prefer not to use a point that is clearly at destination
  if (destAp?.lat != null && depAp?.lat != null) {
    const dDep = haversineM(pt.lat, pt.lon, Number(depAp.lat), Number(depAp.lon));
    const dDest = haversineM(pt.lat, pt.lon, Number(destAp.lat), Number(destAp.lon));
    if (dDest < dDep && dDest < 30 * 1852) {
      console.warn("SID exit ignored — closer to destination than departure");
      return null;
    }
  }
  return pt;
}

/**
 * STAR entry = first approach fix (farthest from destination runway/airport).
 * Always re-read from activeArrival so adding a STAR updates the plan end.
 */
function getStarEntryPoint(planData) {
  if (!state.activeArrival && !(state.pathTracks?.arrival?.coords?.length)) {
    return null;
  }
  const destAp = _fpAirportRef("dest", planData);
  const depAp = _fpAirportRef("dep", planData);
  const pts = state.activeArrival?.points;
  let pt = null;

  if (pts && pts.length) {
    // Prefer first non-runway fix (STAR order: feeder → final → threshold)
    const nonRwy = pts.filter(
      (p) => p && p.lat != null && p.lon != null && p.kind !== "runway"
    );
    if (nonRwy.length && destAp?.lat != null) {
      // Entry = farthest from dest among non-runway points
      let best = nonRwy[0];
      let bestD = -1;
      for (const p of nonRwy) {
        const d = haversineM(Number(p.lat), Number(p.lon), Number(destAp.lat), Number(destAp.lon));
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
      pt = _ptFromPair(
        best.lat,
        best.lon,
        best.ident || state.activeArrival?.star_name || "STAR entry"
      );
    } else if (nonRwy.length) {
      pt = _ptFromPair(
        nonRwy[0].lat,
        nonRwy[0].lon,
        nonRwy[0].ident || "STAR entry"
      );
    }
  }

  if (!pt) {
    const track = state.pathTracks?.arrival?.coords;
    if (track && track.length) {
      let idx = 0;
      if (destAp?.lat != null && track.length >= 2) {
        // Entry = index farthest from dest
        let bestD = -1;
        for (let i = 0; i < track.length; i++) {
          const d = haversineM(track[i][0], track[i][1], Number(destAp.lat), Number(destAp.lon));
          if (d > bestD) {
            bestD = d;
            idx = i;
          }
        }
      }
      const p = track[idx];
      pt = _ptFromPair(
        p[0],
        p[1],
        (state.pathTracks.arrival.labels && state.pathTracks.arrival.labels[idx]) ||
          state.activeArrival?.star_name ||
          "STAR entry"
      );
    }
  }

  if (!pt) return null;

  // Near destination (250 NM — long STAR transitions)
  if (destAp?.lat != null && !_fpNear(pt, destAp, 250 * 1852)) {
    console.warn("STAR entry ignored — not near destination airport", pt, destAp);
    return null;
  }
  // Reject if closer to dep than dest (wrong airport procedure)
  if (depAp?.lat != null && destAp?.lat != null) {
    const dDep = haversineM(pt.lat, pt.lon, Number(depAp.lat), Number(depAp.lon));
    const dDest = haversineM(pt.lat, pt.lon, Number(destAp.lat), Number(destAp.lon));
    if (dDep < dDest && dDep < 40 * 1852) {
      console.warn("STAR entry ignored — closer to departure than destination");
      return null;
    }
  }
  return pt;
}

/** Kinds that are procedure geometry or airport endpoints — not enroute DCT fixes. */
const _FP_STRIP_KINDS = new Set([
  "airport",
  "runway",
  "sid",
  "star",
  "climb",
  "final",
  "sid_join",
  "star_join",
  "vector",
]);

/**
 * Keep only enroute fixes from a plan payload.
 * If the backend embedded SID/STAR points, strip them so we don't draw
 * SID exit → back to SID start (same airport loop).
 */
function extractEnrouteLegs(data) {
  let legs = (data.legs || [])
    .filter((l) => l && l.lat != null && l.lon != null)
    .map((l) => ({ ...l }));

  if (!legs.length && data.coords && data.coords.length) {
    legs = data.coords.map((c, i) => ({
      ident: i === 0 ? "START" : i === data.coords.length - 1 ? "END" : "WP",
      lat: Number(c[0]),
      lon: Number(c[1]),
      kind: "fix",
    }));
  }

  const fixes = legs.filter((l) => !_FP_STRIP_KINDS.has(String(l.kind || "").toLowerCase()));
  // Prefer pure fixes; if none (e.g. DCT only airport–airport), keep non-airport middle
  if (fixes.length >= 1) return fixes;

  // DCT airport→airport: no enroute fixes — return empty so we only join SID→STAR
  const onlyAirports = legs.every(
    (l) => l.kind === "airport" || l.kind === "runway" || !l.kind
  );
  if (onlyAirports) return [];

  // Fallback: drop first/last airport/runway only
  legs = legs.slice();
  while (legs.length && (legs[0].kind === "airport" || legs[0].kind === "runway")) {
    legs.shift();
  }
  while (
    legs.length &&
    (legs[legs.length - 1].kind === "airport" || legs[legs.length - 1].kind === "runway")
  ) {
    legs.pop();
  }
  return legs.filter((l) => !_FP_STRIP_KINDS.has(String(l.kind || "").toLowerCase()) || l.kind === "fix");
}

/**
 * Stitch enroute plan so it joins the SID exit and STAR entry.
 * Uses only enroute fixes + procedure join points (never re-embeds full SID/STAR).
 */
function stitchFlightPlanToProcedures(data) {
  if (!data) return data;
  const sidExit = getSidExitPoint(data);
  const starEntry = getStarEntryPoint(data);
  if (!sidExit && !starEntry) {
    return { ...data, linked: { sid: false, star: false } };
  }

  let legs = extractEnrouteLegs(data);

  // No fixes: still allow SID exit → STAR entry (or dest) connector
  if (!legs.length) {
    legs = [];
    if (sidExit) {
      legs.push({
        ident: sidExit.ident || "SID",
        lat: sidExit.lat,
        lon: sidExit.lon,
        kind: "sid_join",
        note: "Join from SID",
      });
    } else if (data.dep?.lat != null) {
      legs.push({
        ident: data.dep.icao || "DEP",
        lat: Number(data.dep.lat),
        lon: Number(data.dep.lon),
        kind: "airport",
      });
    }
    if (starEntry) {
      legs.push({
        ident: starEntry.ident || "STAR",
        lat: starEntry.lat,
        lon: starEntry.lon,
        kind: "star_join",
        note: "Join to STAR",
      });
    } else if (data.dest?.lat != null) {
      legs.push({
        ident: data.dest.icao || "DEST",
        lat: Number(data.dest.lat),
        lon: Number(data.dest.lon),
        kind: "airport",
      });
    }
  } else {
    // Drop enroute points that are really the dep airport / runway when SID exists
    if (sidExit && data.dep?.lat != null) {
      while (
        legs.length > 0 &&
        _fpNear(legs[0], data.dep, 12 * 1852)
      ) {
        legs.shift();
      }
      legs.unshift({
        ident: sidExit.ident || "SID",
        lat: sidExit.lat,
        lon: sidExit.lon,
        kind: "sid_join",
        note: "Join from SID",
      });
    } else if (sidExit) {
      if (!legs.length || !_fpNear(legs[0], sidExit, 1500)) {
        legs.unshift({
          ident: sidExit.ident || "SID",
          lat: sidExit.lat,
          lon: sidExit.lon,
          kind: "sid_join",
          note: "Join from SID",
        });
      } else {
        legs[0] = {
          ...legs[0],
          lat: sidExit.lat,
          lon: sidExit.lon,
          kind: "sid_join",
          note: "Join from SID",
        };
      }
    } else if (data.dep?.lat != null) {
      if (!legs.length || !_fpNear(legs[0], data.dep, 5000)) {
        legs.unshift({
          ident: data.dep.icao || "DEP",
          lat: Number(data.dep.lat),
          lon: Number(data.dep.lon),
          kind: "airport",
        });
      }
    }

    // Always re-anchor the END on STAR entry when a STAR is drawn.
    // Drop trailing points that are just the destination airport so the
    // plan ends at the STAR gate, not the runway/airport centre.
    if (starEntry) {
      if (data.dest?.lat != null) {
        while (
          legs.length > 0 &&
          _fpNear(legs[legs.length - 1], data.dest, 12 * 1852)
        ) {
          legs.pop();
        }
      }
      // Also drop previous star_join if re-linking
      while (
        legs.length > 0 &&
        (legs[legs.length - 1].kind === "star_join" ||
          _fpNear(legs[legs.length - 1], starEntry, 500))
      ) {
        legs.pop();
      }
      legs.push({
        ident: starEntry.ident || "STAR",
        lat: starEntry.lat,
        lon: starEntry.lon,
        kind: "star_join",
        note: "Join to STAR",
      });
    } else if (data.dest?.lat != null) {
      const last = legs[legs.length - 1];
      if (!last || !_fpNear(last, data.dest, 5000)) {
        legs.push({
          ident: data.dest.icao || "DEST",
          lat: Number(data.dest.lat),
          lon: Number(data.dest.lon),
          kind: "airport",
        });
      }
    }
  }

  // Dedupe consecutive points
  const clean = [];
  for (const leg of legs) {
    if (
      clean.length &&
      Math.abs(clean[clean.length - 1].lat - leg.lat) < 1e-5 &&
      Math.abs(clean[clean.length - 1].lon - leg.lon) < 1e-5
    ) {
      continue;
    }
    clean.push(leg);
  }

  // Guard: if everything collapsed near dep, abort stitch and return original
  if (clean.length >= 2 && data.dep?.lat != null && data.dest?.lat != null) {
    const span = haversineM(
      clean[0].lat,
      clean[0].lon,
      clean[clean.length - 1].lat,
      clean[clean.length - 1].lon
    );
    const od = haversineM(
      Number(data.dep.lat),
      Number(data.dep.lon),
      Number(data.dest.lat),
      Number(data.dest.lon)
    );
    // Stitched path much shorter than dep–dest → likely wrong join
    if (od > 30000 && span < od * 0.15) {
      console.warn("Flight plan stitch rejected — path collapsed near one airport");
      return { ...data, linked: { sid: false, star: false }, stitchRejected: true };
    }
  }

  const coords = clean.map((l) => [l.lat, l.lon]);
  let distM = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    distM += haversineM(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }

  const linkBits = [];
  if (sidExit) linkBits.push("SID");
  if (starEntry) linkBits.push("STAR");
  const baseMsg = (data.message || "").replace(/\s*·\s*linked to.*$/i, "");
  const linkNote =
    linkBits.length > 0 ? ` · linked to ${linkBits.join(" + ")}` : "";

  return {
    ...data,
    legs: clean,
    coords,
    distance_m: Math.round(distM),
    distance_nm: Math.round((distM / 1852) * 10) / 10,
    message: baseMsg + linkNote,
    linked: { sid: !!sidExit, star: !!starEntry },
  };
}

function _clonePlanRaw(src) {
  if (!src) return null;
  return {
    coords: Array.isArray(src.coords)
      ? src.coords.map((c) => (Array.isArray(c) ? [c[0], c[1]] : c))
      : src.coords,
    legs: Array.isArray(src.legs) ? src.legs.map((l) => ({ ...l })) : src.legs,
    message: src.message,
    distance_nm: src.distance_nm,
    distance_m: src.distance_m,
    icao_route: src.icao_route,
    dep: src.dep ? { ...src.dep } : src.dep,
    dest: src.dest ? { ...src.dest } : src.dest,
    warnings: src.warnings ? [...src.warnings] : src.warnings,
    route_text: src.route_text,
    source: src.source,
  };
}

function relinkFlightPlanToProcedures() {
  if (!state.flightPlan) return;
  const fp = state.flightPlan;
  // Always restitch from the original unlinked plan (never from prior join geometry)
  const base = _clonePlanRaw(fp._raw) || _clonePlanRaw(fp);
  if (!base) return;
  // Ensure dest/dep survive even if _raw was incomplete
  if (!base.dest && fp.dest) base.dest = { ...fp.dest };
  if (!base.dep && fp.dep) base.dep = { ...fp.dep };

  const linked = stitchFlightPlanToProcedures(base);
  linked._raw = fp._raw ? _clonePlanRaw(fp._raw) : _clonePlanRaw(base);
  state.flightPlan = linked;
  drawFlightPlan(linked, { fit: false, skipStitch: true });

  if ($("#fp-summary")?.classList.contains("visible")) {
    if ($("#fp-dist") && linked.distance_nm != null) {
      $("#fp-dist").textContent =
        `${linked.distance_nm} NM` +
        (linked.distance_m != null ? ` (${linked.distance_m} m)` : "");
    }
    if ($("#fp-msg") && linked.message) $("#fp-msg").textContent = linked.message;
  }

  const bits = [];
  if (linked.linked?.sid) bits.push("SID");
  if (linked.linked?.star) bits.push("STAR");
  if (bits.length) {
    setStatus("Flight plan re-linked to " + bits.join(" + "), "ok");
  }
}

function drawFlightPlan(data, { fit = true, skipStitch = false } = {}) {
  baseLayers.flightPlan.clearLayers();
  if (!data) {
    clearPathTrack("flightPlan");
    return;
  }
  // Preserve original for re-link; stitch SID exit / STAR entry
  if (!data._raw && !skipStitch) {
    data = {
      ...data,
      _raw: {
        coords: data.coords,
        legs: data.legs,
        message: data.message,
        distance_nm: data.distance_nm,
        distance_m: data.distance_m,
        icao_route: data.icao_route,
        dep: data.dep,
        dest: data.dest,
        warnings: data.warnings,
        route_text: data.route_text,
        source: data.source,
      },
    };
  }
  const plan = skipStitch ? data : stitchFlightPlanToProcedures(data._raw || data);
  if (!skipStitch) {
    plan._raw = data._raw || data;
    state.flightPlan = plan;
  }

  if (!plan?.coords || plan.coords.length < 2) {
    clearPathTrack("flightPlan");
    return;
  }
  const latlngs = plan.coords.map((c) => [c[0], c[1]]);

  // Subtle connector styling when joined to procedures
  const linked = plan.linked || {};
  L.polyline(latlngs, {
    color: "#a855f7",
    weight: 10,
    opacity: 0.28,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(baseLayers.flightPlan);
  L.polyline(latlngs, {
    color: linked.sid || linked.star ? "#e9d5ff" : "#c084fc",
    weight: 4,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    dashArray: linked.sid || linked.star ? "2 0" : null,
  }).addTo(baseLayers.flightPlan);

  (plan.legs || []).forEach((leg, i) => {
    if (leg.lat == null || leg.lon == null) return;
    const isJoin = leg.kind === "sid_join" || leg.kind === "star_join";
    const isEnd = i === 0 || i === plan.legs.length - 1;
    L.circleMarker([leg.lat, leg.lon], {
      radius: isJoin ? 8 : isEnd ? 7 : 5,
      color: isJoin ? "#fde68a" : "#f3e8ff",
      weight: 2,
      fillColor: isJoin
        ? leg.kind === "sid_join"
          ? "#c084fc"
          : "#4ade80"
        : isEnd
          ? "#a855f7"
          : "#7c3aed",
      fillOpacity: 0.95,
    })
      .bindTooltip(
        (leg.ident || "WP") + (isJoin ? " (join)" : ""),
        { permanent: false, direction: "top" }
      )
      .addTo(baseLayers.flightPlan);
  });
  if (state.layerVisibility.flightPlan && !map.hasLayer(baseLayers.flightPlan)) {
    baseLayers.flightPlan.addTo(map);
  }
  const trackCoords = (plan.legs || [])
    .filter((l) => l.lat != null && l.lon != null)
    .map((l) => [l.lat, l.lon]);
  const trackLabels = (plan.legs || [])
    .filter((l) => l.lat != null && l.lon != null)
    .map((l) => l.ident || "");
  setPathTrack("flightPlan", trackCoords.length >= 2 ? trackCoords : latlngs, {
    name: "Flight plan",
    labels: trackLabels.length ? trackLabels : null,
  });
  if (state.sim.lat != null) updateActiveLeg(state.sim.lat, state.sim.lon);
  if (fit) {
    try {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
    } catch (_) {}
  }
}

function showFpSummary(data) {
  state.flightPlan = data;
  const sum = $("#fp-summary");
  if (sum) {
    sum.classList.add("visible");
    $("#fp-dist").textContent =
      data.distance_nm != null
        ? `${data.distance_nm} NM` +
          (data.distance_m != null ? ` (${data.distance_m} m)` : "")
        : "—";
    $("#fp-msg").textContent = data.message || "";
    $("#fp-via").textContent = data.icao_route || "";
  }
  const w = $("#fp-warnings");
  if (w) {
    const bits = [];
    if (data.source === "simbrief") bits.push("Source: SimBrief OFP");
    if (data.aircraft) bits.push("A/C " + data.aircraft);
    if (data.airac) bits.push("AIRAC " + data.airac);
    if ((data.warnings || []).length) bits.push(data.warnings.join(" · "));
    w.textContent = bits.join(" · ");
  }
  if (data.dep?.icao && $("#fp-dep")) $("#fp-dep").value = data.dep.icao;
  if (data.dest?.icao && $("#fp-dest")) $("#fp-dest").value = data.dest.icao;
  if (data.route_text != null && $("#fp-route")) $("#fp-route").value = data.route_text;
}

function _arrRunwayMeta() {
  const sel = $("#arr-runway-select");
  if (!sel?.value) return null;
  try {
    return JSON.parse(sel.value);
  } catch {
    return null;
  }
}

async function buildFlightPlan() {
  const dep = ($("#fp-dep")?.value || "").trim().toUpperCase();
  const dest = ($("#fp-dest")?.value || "").trim().toUpperCase();
  const route = ($("#fp-route")?.value || "").trim();
  if (!dep || !dest) {
    setStatus("Enter departure and destination ICAO", "err");
    return;
  }
  setLoading(true, "Building flight plan…");
  setStatus("Building enroute plan…", "busy");
  try {
    const arrMeta = _arrRunwayMeta();
    // Prefer journey dep runway (taxi/SID) over arrival runway if active chart is dest
    const depRwy =
      state.end?.label?.replace(/^RWY\s*/i, "") ||
      (state.depChart && state.runwayEndMeta && !isArrivalTaxiMode()
        ? state.runwayEndMeta.name
        : null) ||
      $("#runway-select")?.selectedOptions?.[0]?.textContent?.replace(/^Runway\s*/i, "") ||
      null;

    // Do NOT pass sid_id/star_id into the builder — that embeds full SID/STAR
    // geometry into the plan, and stitching then loops back to the departure.
    // Map join uses the drawn SID exit / STAR entry only.
    const body = {
      dep_icao: dep,
      dest_icao: dest,
      route_text: route,
      dep_rwy: depRwy || state.end?.label?.replace(/^RWY\s*/i, "") || null,
      arr_rwy: arrMeta?.name || null,
      sid_id: null,
      star_id: null,
      dep_lat: state.end?.lat ?? state.depChart?.airport?.lat ?? null,
      dep_lon: state.end?.lon ?? state.depChart?.airport?.lon ?? null,
      arr_lat: arrMeta?.lat ?? null,
      arr_lon: arrMeta?.lon ?? null,
    };
    const res = await fetch("/api/flightplan/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const detail = data.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg || d).join("; ")
            : data.error || "Build failed";
      throw new Error(msg);
    }
    // Stitch to drawn SID exit / STAR entry so the purple plan joins procedures
    const linked = stitchFlightPlanToProcedures(data);
    linked._raw = {
      coords: data.coords,
      legs: data.legs,
      message: data.message,
      distance_nm: data.distance_nm,
      distance_m: data.distance_m,
      icao_route: data.icao_route,
      dep: data.dep,
      dest: data.dest,
      warnings: data.warnings,
      route_text: data.route_text,
    };
    showFpSummary(linked);
    drawFlightPlan(linked, { skipStitch: true });
    const joinBits = [];
    if (linked.linked?.sid) joinBits.push("SID");
    if (linked.linked?.star) joinBits.push("STAR");
    setStatus(
      (linked.message || "Flight plan ready") +
        (joinBits.length ? ` (joined to ${joinBits.join(" + ")})` : ""),
      "ok"
    );
  } catch (err) {
    setStatus(err.message || "Flight plan failed", "err");
  } finally {
    setLoading(false);
  }
}

/** Load departure + destination surface charts without wiping paths. */
async function loadBothAirports() {
  const dep = ($("#fp-dep")?.value || state.depChart?.airport?.icao || "").trim().toUpperCase();
  const dest = (
    $("#fp-dest")?.value ||
    state.destChart?.airport?.icao ||
    state.flightPlan?.dest?.icao ||
    ""
  )
    .trim()
    .toUpperCase();
  if (!dep || !dest) {
    setStatus("Set both departure and destination ICAOs first", "err");
    return;
  }
  setStatus(`Loading ${dep} + ${dest} for gate-to-gate…`, "busy");
  await loadAirport(dep, {
    role: "dep",
    keepPaths: true,
    fit: false,
  });
  await loadAirport(dest, {
    role: "dest",
    keepPaths: true,
    fit: false,
  });
  redrawSurfaces({ fit: false });
  if (state.flightPlan) drawFlightPlan(state.flightPlan, { fit: false });
  // Active chart follows journey step
  if (state.journeyStep === "taxi-in" && state.destChart) {
    applyChartAsActive(state.destChart, { fit: false, redrawAll: true });
  } else if (state.depChart) {
    applyChartAsActive(state.depChart, { fit: false, redrawAll: true });
  }
  fitAllRoutes();
  setStatus(`Gate-to-gate: ${dep} → ${dest} charts loaded`, "ok");
}

let _sbWaitAbort = false;

function _sbUserBody(raw) {
  return /^\d+$/.test(raw) ? { userid: raw } : { username: raw };
}

function _setSbStatus(text) {
  const el = $("#fp-sb-status");
  if (el) el.textContent = text || "";
}

function _setSbWaitingUi(on) {
  $("#btn-sb-cancel-wait")?.classList.toggle("hidden", !on);
  const gen = $("#btn-sb-generate");
  if (gen) gen.disabled = !!on;
  const setupGo = $("#btn-sb-setup-go");
  if (setupGo) setupGo.disabled = !!on;
  const setupImp = $("#btn-sb-setup-import");
  if (setupImp) setupImp.disabled = !!on;
}

async function openSimBriefDispatch(extra = {}) {
  const dep = ($("#fp-dep")?.value || "").trim().toUpperCase();
  const dest = ($("#fp-dest")?.value || "").trim().toUpperCase();
  const typecode = ($("#fp-ac")?.value || "B738").trim().toUpperCase() || "B738";
  const route = ($("#fp-route")?.value || "").trim();
  try {
    const res = await fetch("/api/simbrief/dispatch-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orig: dep || null,
        dest: dest || null,
        typecode,
        route: route || null,
        static_id: extra.static_id || null,
      }),
    });
    const data = await res.json();
    if (!data.url) throw new Error("No SimBrief URL");
    window.open(data.url, "_blank", "noopener,noreferrer");
    if (!extra.quiet) {
      setStatus(
        "SimBrief opened — generate the OFP, then use Generate & import or Import latest",
        "ok"
      );
    }
    return data.url;
  } catch (err) {
    const q = new URLSearchParams();
    if (dep) q.set("orig", dep);
    if (dest) q.set("dest", dest);
    q.set("type", typecode);
    if (route) q.set("route", route);
    if (extra.static_id) q.set("static_id", extra.static_id);
    const url =
      "https://dispatch.simbrief.com/options/custom?" + q.toString();
    window.open(url, "_blank", "noopener,noreferrer");
    return url;
  }
}

function setSbOfpBubbleVisible(show) {
  const bubble = $("#sb-ofp-bubble");
  const tab = $("#btn-sb-ofp-show");
  if (!bubble) return;
  if (show) {
    bubble.classList.remove("hidden");
    bubble.removeAttribute("hidden");
    if (tab) {
      tab.classList.add("hidden");
      tab.setAttribute("hidden", "");
    }
  } else {
    bubble.classList.add("hidden");
    bubble.setAttribute("hidden", "");
    // Only show restore tab if we have OFP data loaded
    if (tab && state.simbriefOfpSummary) {
      tab.classList.remove("hidden");
      tab.removeAttribute("hidden");
    }
  }
}

function hideSbOfpBubble() {
  setSbOfpBubbleVisible(false);
}

function showSbOfpBubble() {
  if (!state.simbriefOfpSummary) return;
  setSbOfpBubbleVisible(true);
}

function clearSbOfpBubble() {
  state.simbriefOfpSummary = null;
  const bubble = $("#sb-ofp-bubble");
  const tab = $("#btn-sb-ofp-show");
  if (bubble) {
    bubble.classList.add("hidden");
    bubble.setAttribute("hidden", "");
  }
  if (tab) {
    tab.classList.add("hidden");
    tab.setAttribute("hidden", "");
  }
}

/** Fill and show the bottom-centre SimBrief summary bubble. */
function showSbOfpSummary(data) {
  const s = data?.ofp_summary;
  if (!s || !s.has_data) {
    // Still try with partial top-level fields if present
    if (!s) {
      clearSbOfpBubble();
      return;
    }
  }
  state.simbriefOfpSummary = s;

  const set = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val || "—";
  };
  set("#sb-ofp-cruise", s.cruise_alt);
  set("#sb-ofp-time", s.flight_time);
  set("#sb-ofp-payload", s.payload);
  set("#sb-ofp-zfw", s.zfw);
  set("#sb-ofp-fuel", s.fuel);
  set("#sb-ofp-tow", s.tow);

  const title = $("#sb-ofp-bubble-title");
  if (title) {
    const route =
      (data.dep?.icao || "?") + " → " + (data.dest?.icao || "?");
    const ac = data.aircraft ? " · " + data.aircraft : "";
    title.textContent = "SimBrief · " + route + ac;
  }

  setSbOfpBubbleVisible(true);
}

async function applySimBriefPlan(data) {
  showFpSummary(data);
  drawFlightPlan(data);
  showSbOfpSummary(data);
  if (data.dep?.icao && $("#fp-dep")) $("#fp-dep").value = data.dep.icao;
  if (data.dest?.icao && $("#fp-dest")) $("#fp-dest").value = data.dest.icao;
  if (data.route_text != null && $("#fp-route")) {
    $("#fp-route").value = data.route_text;
  }
  if (data.aircraft && $("#fp-ac") && !$("#fp-ac").value) {
    $("#fp-ac").value = data.aircraft;
  }
  // Remember SimBrief SID/STAR (injected into server catalog on import)
  state.simbriefProcedures = data.procedures || null;
  state.simbriefMeta = {
    sid_ident: data.sid_ident || null,
    star_ident: data.star_ident || null,
    dep_rwy: data.dep_rwy || null,
    arr_rwy: data.arr_rwy || null,
  };

  if (data.dep?.icao && data.dest?.icao) {
    setStatus("OFP imported — loading both airport charts…", "busy");
    _setSbStatus("Loading airport charts…");
    await loadBothAirports();
  }

  // Prefer planned runways so SID/STAR lists include the SimBrief procedures
  try {
    if (data.dep_rwy && $("#dep-rwy-select")) {
      const el = $("#dep-rwy-select");
      const want = String(data.dep_rwy).toUpperCase();
      for (const opt of el.options || []) {
        if (
          String(opt.value).toUpperCase() === want ||
          String(opt.textContent).toUpperCase().includes(want)
        ) {
          el.value = opt.value;
          el.dispatchEvent(new Event("change"));
          break;
        }
      }
    }
    if (data.arr_rwy && $("#arr-rwy-select")) {
      const el = $("#arr-rwy-select");
      const want = String(data.arr_rwy).toUpperCase();
      for (const opt of el.options || []) {
        if (
          String(opt.value).toUpperCase() === want ||
          String(opt.textContent).toUpperCase().includes(want)
        ) {
          el.value = opt.value;
          el.dispatchEvent(new Event("change"));
          break;
        }
      }
    }
  } catch (_) {
    /* runway selects may not exist yet */
  }

  // Refresh SID/STAR dropdowns after charts load (catalog now has SimBrief entries)
  try {
    if (state.airport && state.runwayEndMeta) {
      if (state.mode === "departure" || state.mode === "journey" || state.mode === "flightplan") {
        await onRunwayChangedForDeparture();
      }
      if (state.mode === "arrival" || state.mode === "journey" || state.mode === "flightplan") {
        // Arrival uses dest chart runway — only if we have that chart active
        if (state.destChart || state.mode === "arrival") {
          await onRunwayChangedForArrival();
        }
      }
    }
  } catch (_) {
    /* ignore */
  }

  // Pre-select SimBrief SID/STAR in dropdowns when present
  try {
    const sidId = data.sid_ident || data.procedures?.sid?.id;
    if (sidId && $("#dep-select")) {
      const sel = $("#dep-select");
      const want = String(sidId).toUpperCase().replace(/\s+/g, "");
      for (const opt of sel.options || []) {
        if (String(opt.value).toUpperCase().replace(/\s+/g, "") === want) {
          sel.value = opt.value;
          break;
        }
      }
    }
    const starId = data.star_ident || data.procedures?.star?.id;
    if (starId && $("#arr-select")) {
      const sel = $("#arr-select");
      const want = String(starId).toUpperCase().replace(/\s+/g, "");
      for (const opt of sel.options || []) {
        if (String(opt.value).toUpperCase().replace(/\s+/g, "") === want) {
          sel.value = opt.value;
          break;
        }
      }
    }
  } catch (_) {
    /* ignore */
  }

  const extra = [];
  if (data.sid_ident) extra.push("SID " + data.sid_ident);
  if (data.star_ident) extra.push("STAR " + data.star_ident);
  const msg =
    (data.message || "SimBrief plan imported") +
    (extra.length ? " — open Departure/Arrival to show " + extra.join(" + ") : "");
  setStatus(msg, "ok");
  _setSbStatus(data.message || "Imported");
  if (data.warnings && data.warnings.length) {
    console.warn("SimBrief warnings:", data.warnings);
  }
}

/**
 * Import the latest OFP from the user's SimBrief account.
 * @param {{ fromSetup?: boolean }} opts fromSetup: use setup form user field + open Full journey
 */
async function importSimBriefOfp(opts = {}) {
  const fromSetup = !!opts.fromSetup;
  const raw = fromSetup
    ? ($("#sb-user")?.value || "").trim()
    : ($("#fp-sb-user")?.value || "").trim();
  if (!raw) {
    const msg = "Enter your SimBrief username or pilot ID";
    setStatus(msg, "err");
    if (fromSetup) _setSbSetupStatus(msg);
    else _setSbStatus(msg);
    return;
  }
  try {
    localStorage.setItem("navapron_simbrief_user", raw);
  } catch (_) {}
  // Keep main plan fields in sync when importing from setup
  if (fromSetup && $("#fp-sb-user")) $("#fp-sb-user").value = raw;

  setLoading(true, "Importing SimBrief OFP…");
  setStatus("Fetching latest SimBrief flight plan…", "busy");
  _setSbStatus("Fetching latest OFP…");
  if (fromSetup) _setSbSetupStatus("Fetching your last SimBrief OFP…");
  try {
    const res = await fetch("/api/simbrief/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(_sbUserBody(raw)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const detail = data.detail;
      throw new Error(
        typeof detail === "string"
          ? detail
          : data.error || "SimBrief import failed"
      );
    }
    if (fromSetup) {
      hideSimBriefSetup();
      enterMode("journey");
      setJourneyStep("flightplan");
      await applySimBriefPlan(data);
      setStatus(
        "Last SimBrief OFP imported — Full journey map",
        "ok"
      );
      _setSbSetupStatus("");
    } else {
      await applySimBriefPlan(data);
    }
  } catch (err) {
    setStatus(err.message || "SimBrief import failed", "err");
    _setSbStatus(err.message || "Import failed");
    if (fromSetup) _setSbSetupStatus(err.message || "Import failed");
  } finally {
    setLoading(false);
  }
}

/**
 * Open SimBrief Dispatch prefilled, wait until a *new* OFP appears for this
 * user (matching dep/dest when possible), then import automatically.
 *
 * @param {{ fromSetup?: boolean }} opts fromSetup: after import open Full journey map
 */
async function generateAndImportSimBrief(opts = {}) {
  const fromSetup = !!opts.fromSetup;
  const raw = fromSetup
    ? ($("#sb-user")?.value || "").trim()
    : ($("#fp-sb-user")?.value || "").trim();
  if (!raw) {
    const msg = "Enter your SimBrief username or pilot ID first";
    setStatus(msg, "err");
    if (fromSetup) _setSbSetupStatus(msg);
    else _setSbStatus(msg);
    return;
  }
  const dep = fromSetup
    ? (_sbPicks.dep?.icao || $("#sb-dep-search")?.value || "").trim().toUpperCase()
    : ($("#fp-dep")?.value || "").trim().toUpperCase();
  const dest = fromSetup
    ? (_sbPicks.dest?.icao || $("#sb-dest-search")?.value || "").trim().toUpperCase()
    : ($("#fp-dest")?.value || "").trim().toUpperCase();
  if (!dep || !dest) {
    const msg = "Select departure and arrival airports first";
    setStatus(msg, "err");
    if (fromSetup) _setSbSetupStatus(msg);
    else _setSbStatus(msg);
    return;
  }
  // Ensure pick objects exist if user typed ICAO only
  if (fromSetup) {
    if (!_sbPicks.dep) setSbAirportPick("dep", { icao: dep });
    if (!_sbPicks.dest) setSbAirportPick("dest", { icao: dest });
  }
  const typecode = fromSetup
    ? ($("#sb-ac")?.value || "B738").trim().toUpperCase() || "B738"
    : ($("#fp-ac")?.value || "B738").trim().toUpperCase() || "B738";
  const route = fromSetup
    ? ($("#sb-route")?.value || "").trim()
    : ($("#fp-route")?.value || "").trim();

  // Sync into main plan fields so journey map has them
  if ($("#fp-dep")) $("#fp-dep").value = dep;
  if ($("#fp-dest")) $("#fp-dest").value = dest;
  if ($("#fp-ac")) $("#fp-ac").value = typecode;
  if ($("#fp-route") && route) $("#fp-route").value = route;
  if ($("#fp-sb-user")) $("#fp-sb-user").value = raw;

  try {
    localStorage.setItem("navapron_simbrief_user", raw);
  } catch (_) {}

  _sbWaitAbort = false;
  _setSbWaitingUi(true);
  if (fromSetup) {
    $("#btn-sb-setup-cancel-wait")?.classList.remove("hidden");
    const go = $("#btn-sb-setup-go");
    if (go) go.disabled = true;
  }
  setLoading(true, "Preparing SimBrief…");
  setStatus("Opening SimBrief Dispatch…", "busy");
  _setSbStatus("Starting session…");
  if (fromSetup) _setSbSetupStatus("Opening SimBrief…");

  try {
    const body = {
      ..._sbUserBody(raw),
      orig: dep,
      dest: dest,
      typecode,
      route: route || null,
    };
    const res = await fetch("/api/simbrief/generate-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const session = await res.json().catch(() => ({}));
    if (!res.ok || session.ok === false) {
      throw new Error(
        typeof session.detail === "string"
          ? session.detail
          : session.error || "Could not start SimBrief session"
      );
    }

    window.open(session.url, "_blank", "noopener,noreferrer");
    const beforeFp = session.before_fingerprint || null;
    const wantDep = (session.want_dep || dep).toUpperCase();
    const wantDest = (session.want_dest || dest).toUpperCase();

    setStatus(
      "SimBrief opened — click Generate Flight Plan there. Waiting to import…",
      "busy"
    );
    _setSbStatus(
      "Waiting for you to click Generate on SimBrief… (auto-import when ready)"
    );
    if (fromSetup) {
      _setSbSetupStatus(
        "SimBrief opened — click Generate Flight Plan, then wait here…"
      );
    }
    setLoading(true, "Waiting for SimBrief OFP…");

    const maxPolls = 80; // ~4 minutes at 3s
    for (let i = 0; i < maxPolls; i++) {
      if (_sbWaitAbort) {
        setStatus("SimBrief wait cancelled", "ok");
        _setSbStatus("Cancelled — use Import latest when ready");
        if (fromSetup) _setSbSetupStatus("Cancelled");
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
      if (_sbWaitAbort) return;

      const sec = (i + 1) * 3;
      setStatus(`Waiting for SimBrief OFP… ${sec}s`, "busy");
      _setSbStatus(
        `Waiting for new OFP (${sec}s) — generate on the SimBrief page…`
      );
      if (fromSetup) {
        _setSbSetupStatus(`Waiting for SimBrief OFP… ${sec}s`);
      }
      setLoading(true, `Waiting for SimBrief… ${sec}s`);

      try {
        const imp = await fetch("/api/simbrief/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(_sbUserBody(raw)),
        });
        const data = await imp.json().catch(() => ({}));
        if (!imp.ok || data.ok === false) continue;

        const fp = data.fingerprint || "";
        const isNew = !beforeFp || fp !== beforeFp;
        const matchDep =
          !wantDep ||
          String(data.dep?.icao || "").toUpperCase() === wantDep;
        const matchDest =
          !wantDest ||
          String(data.dest?.icao || "").toUpperCase() === wantDest;

        if (isNew && matchDep && matchDest) {
          if (fromSetup) {
            // Open Full journey map first, then draw plan + charts
            hideSimBriefSetup();
            enterMode("journey");
            setJourneyStep("flightplan");
            await applySimBriefPlan(data);
            setStatus(
              "SimBrief OFP ready — Full journey map (plan layer on)",
              "ok"
            );
            _setSbSetupStatus("");
          } else {
            await applySimBriefPlan(data);
            _setSbStatus("New OFP imported automatically");
          }
          return;
        }
        if (isNew && (!matchDep || !matchDest)) {
          const note = `Saw OFP ${data.dep?.icao || "?"}→${data.dest?.icao || "?"} — waiting for ${wantDep}→${wantDest}…`;
          _setSbStatus(note);
          if (fromSetup) _setSbSetupStatus(note);
        }
      } catch (_) {
        /* keep waiting */
      }
    }

    setStatus(
      "Timed out waiting for SimBrief. Generate the OFP, then click Import latest only.",
      "err"
    );
    _setSbStatus("Timed out — click Import latest only after generating");
    if (fromSetup) {
      _setSbSetupStatus(
        "Timed out — generate on SimBrief, then try again or use Full journey → Import"
      );
    }
  } catch (err) {
    setStatus(err.message || "SimBrief generate failed", "err");
    _setSbStatus(err.message || "Failed");
    if (fromSetup) _setSbSetupStatus(err.message || "Failed");
  } finally {
    _setSbWaitingUi(false);
    if (fromSetup) {
      $("#btn-sb-setup-cancel-wait")?.classList.add("hidden");
      const go = $("#btn-sb-setup-go");
      if (go) go.disabled = false;
    }
    setLoading(false);
  }
}

function cancelSimBriefWait() {
  _sbWaitAbort = true;
  _setSbWaitingUi(false);
  $("#btn-sb-setup-cancel-wait")?.classList.add("hidden");
  const go = $("#btn-sb-setup-go");
  if (go) go.disabled = false;
  setLoading(false);
  setStatus("Cancelled SimBrief wait", "ok");
  _setSbStatus("Cancelled");
  _setSbSetupStatus("Cancelled");
}

async function saveFlightPlan() {
  if (!state.flightPlan) {
    setStatus("Build a plan first", "err");
    return;
  }
  const name =
    ($("#fp-name")?.value || "").trim() ||
    `${state.flightPlan.dep?.icao || "DEP"}-${state.flightPlan.dest?.icao || "DEST"}`;
  try {
    const res = await fetch("/api/flightplan/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, plan: state.flightPlan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Save failed");
    setStatus(`Saved plan: ${data.name || name}`, "ok");
    refreshSavedPlansList();
  } catch (err) {
    setStatus(err.message || "Save failed", "err");
  }
}

async function refreshSavedPlansList() {
  const sel = $("#fp-saved");
  if (!sel) return;
  try {
    const res = await fetch("/api/flightplan/list");
    const data = await res.json();
    const cur = sel.value;
    sel.innerHTML = `<option value="">— Load a saved plan —</option>`;
    for (const p of data.plans || []) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name || p.id} (${p.dep || "?"}→${p.dest || "?"}${
        p.distance_nm != null ? ", " + p.distance_nm + " NM" : ""
      })`;
      sel.appendChild(opt);
    }
    if (cur) sel.value = cur;
  } catch (_) {}
}

async function loadSavedPlan(id) {
  if (!id) return;
  try {
    const res = await fetch(`/api/flightplan/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("Plan not found");
    const data = await res.json();
    showFpSummary(data);
    if ($("#fp-name")) $("#fp-name").value = data.name || "";
    drawFlightPlan(data);
    setStatus("Loaded saved plan", "ok");
  } catch (err) {
    setStatus(err.message || "Load failed", "err");
  }
}

$("#btn-fp-build")?.addEventListener("click", () => buildFlightPlan());
$("#btn-fp-both")?.addEventListener("click", () => loadBothAirports());
$("#btn-fp-save")?.addEventListener("click", () => saveFlightPlan());
$("#btn-fp-clear")?.addEventListener("click", () => {
  clearFlightPlanLayer();
  setStatus("Flight plan cleared from map", "ok");
});
$("#btn-sb-open")?.addEventListener("click", () => openSimBriefDispatch());
$("#btn-sb-import")?.addEventListener("click", () => importSimBriefOfp());
$("#btn-sb-generate")?.addEventListener("click", () => generateAndImportSimBrief());
$("#btn-sb-cancel-wait")?.addEventListener("click", () => cancelSimBriefWait());
$("#btn-sb-ofp-hide")?.addEventListener("click", () => hideSbOfpBubble());
$("#btn-sb-ofp-show")?.addEventListener("click", () => showSbOfpBubble());
$("#fp-saved")?.addEventListener("change", (e) => {
  loadSavedPlan(e.target.value);
});
try {
  const sb = localStorage.getItem("navapron_simbrief_user");
  if (sb && $("#fp-sb-user")) $("#fp-sb-user").value = sb;
  if (sb && $("#sb-user")) $("#sb-user").value = sb;
} catch (_) {}

// SimBrief setup screen (Home → SimBrief → Full journey)
wireSbAirportSearch("dep");
wireSbAirportSearch("dest");
setSbAirportPick("dep", null);
setSbAirportPick("dest", null);
$("#btn-sb-setup-back")?.addEventListener("click", () => showHub());
$("#btn-sb-setup-go")?.addEventListener("click", () =>
  generateAndImportSimBrief({ fromSetup: true })
);
$("#btn-sb-setup-import")?.addEventListener("click", () =>
  importSimBriefOfp({ fromSetup: true })
);
$("#btn-sb-setup-cancel-wait")?.addEventListener("click", () => cancelSimBriefWait());

// ── Sidebar collapse (more map while flying) ─────────────────────
function isSidebarCollapsed() {
  return !!$("#app")?.classList.contains("sidebar-collapsed");
}

function setSidebarCollapsed(collapsed, { persist = true, quiet = false } = {}) {
  const app = $("#app");
  if (!app) return;
  const on = !!collapsed;
  app.classList.toggle("sidebar-collapsed", on);
  document.body.classList.toggle("sidebar-collapsed", on);

  const hideBtn = $("#btn-sidebar-collapse");
  const openBtn = $("#btn-sidebar-open");
  if (hideBtn) {
    hideBtn.setAttribute("aria-expanded", on ? "false" : "true");
    hideBtn.title = on
      ? "Sidebar hidden — use the Menu tab on the map to show it"
      : "Hide sidebar — more map (click the Menu tab to show again)";
  }
  if (openBtn) {
    openBtn.setAttribute("aria-expanded", on ? "false" : "true");
    openBtn.setAttribute("aria-hidden", on ? "false" : "true");
  }

  if (persist) {
    try {
      localStorage.setItem("navapron_sidebar_collapsed", on ? "1" : "0");
    } catch (_) {}
  }

  // Leaflet must remeasure after grid column animates
  const fixMap = () => {
    try {
      map.invalidateSize(true);
    } catch (_) {}
  };
  fixMap();
  setTimeout(fixMap, 80);
  setTimeout(fixMap, 260);

  if (!quiet) {
    setStatus(on ? "Sidebar hidden — click Menu on the map edge to show" : "Sidebar shown", "ok");
  }
}

function toggleSidebar() {
  setSidebarCollapsed(!isSidebarCollapsed());
}

$("#btn-sidebar-collapse")?.addEventListener("click", () => setSidebarCollapsed(true));
$("#btn-sidebar-open")?.addEventListener("click", () => setSidebarCollapsed(false));

// Keyboard: [ hides, ] shows (when not typing in a field)
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const tag = (t && t.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) {
    return;
  }
  if (e.key === "[") {
    e.preventDefault();
    setSidebarCollapsed(true);
  } else if (e.key === "]") {
    e.preventDefault();
    setSidebarCollapsed(false);
  }
});

// Start with menu open on the map (enterMode also opens it from Home).
// Users can still hide with « Hide / [ — preference is only for mid-session.
try {
  setSidebarCollapsed(false, { persist: false, quiet: true });
} catch (_) {}

// ── Always on top (desktop window) ───────────────────────────────
// Works only when NavApron.exe / run.bat hosts the window (WebView2 or Edge app).
// A plain browser tab cannot pin itself — button still saves the pref for next desktop launch.
let windowPrefsDesktopHost = false;

async function loadWindowPrefs() {
  try {
    const res = await fetch("/api/window/prefs");
    if (!res.ok) return;
    const prefs = await res.json();
    windowPrefsDesktopHost = !!prefs.desktop_host;
    const on = !!prefs.always_on_top;
    const btn = $("#btn-always-on-top");
    btn?.classList.toggle("active", on);
    if (btn) {
      btn.title = windowPrefsDesktopHost
        ? "Keep NavApron above other windows (WebView or Edge/Chrome app mode). Use borderless/windowed MSFS — exclusive fullscreen can cover everything."
        : "Keep on top only works in the NavApron desktop window (NavApron.exe / run.bat), not a normal browser tab.";
    }
  } catch {
    /* ignore */
  }
}

async function toggleAlwaysOnTop() {
  const btn = $("#btn-always-on-top");
  const next = !btn?.classList.contains("active");
  try {
    const res = await fetch("/api/window/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ always_on_top: next }),
    });
    const prefs = await res.json();
    windowPrefsDesktopHost = !!prefs.desktop_host;
    const on = !!prefs.always_on_top;
    btn?.classList.toggle("active", on);
    if (on && !windowPrefsDesktopHost) {
      setStatus(
        "Keep on top is saved, but only applies in NavApron.exe (WebView or Edge/Chrome app) — not a normal browser tab",
        "err"
      );
    } else if (on) {
      setStatus(
        "Keep on top on (works in WebView and Edge/Chrome app mode) — use windowed/borderless MSFS if it still goes under",
        "ok"
      );
    } else {
      setStatus("Window is no longer always on top", "ok");
    }
  } catch (err) {
    setStatus("Could not change always-on-top: " + err.message, "err");
  }
}

$("#btn-always-on-top")?.addEventListener("click", () => toggleAlwaysOnTop());
loadWindowPrefs();

// ── Boot ─────────────────────────────────────────────────────────
// Ensure logo stays on PNG; fall back to SVG only if PNG missing
(() => {
  const logo = document.getElementById("app-logo");
  if (!logo) return;
  logo.addEventListener("error", () => {
    if (logo.dataset.fallback) return;
    logo.dataset.fallback = "1";
    logo.src = "/img/logo.svg?v=3";
  });
})();

document.title = "NavApron — " + appVersionLabel();
// Start on hub; restore last non-hub mode only if user left mid-session (optional)
try {
  const last = localStorage.getItem("navapron_mode");
  if (last && last !== "hub") {
    // Always show hub first for clarity; user picks mode
  }
} catch (_) {}
showHub();
setStatus("Choose a mode to begin", "ok");
runSearch("").catch(() => {});
