/**
 * NavApron — virtual airline panel (roleplay logbook + live flight tracking)
 * Loaded after app.js. Uses classic scripts (no modules).
 */
(function () {
  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(text, mode) {
    if (typeof window.setStatus === "function") {
      window.setStatus(text, mode);
      return;
    }
    // app.js setStatus is not global — mirror minimal status update
    const el = $("#status-text");
    const dot = $("#status-dot");
    if (el) el.textContent = text;
    if (dot) {
      dot.classList.remove("busy", "err");
      if (mode === "busy") dot.classList.add("busy");
      if (mode === "err") dot.classList.add("err");
    }
  }

  function fixMap() {
    try {
      if (typeof map !== "undefined" && map && map.invalidateSize) {
        map.invalidateSize(true);
      }
    } catch (_) {}
  }

  function setAirlineCollapsed(collapsed, { persist = true, quiet = false } = {}) {
    const app = $("#app");
    if (!app) return;
    const on = !!collapsed;
    app.classList.toggle("airline-collapsed", on);
    const hideBtn = $("#btn-airline-collapse");
    const openBtn = $("#btn-airline-open");
    if (hideBtn) hideBtn.setAttribute("aria-expanded", on ? "false" : "true");
    if (openBtn) {
      openBtn.setAttribute("aria-expanded", on ? "false" : "true");
      openBtn.setAttribute("aria-hidden", on ? "false" : "true");
    }
    if (persist) {
      try {
        localStorage.setItem("navapron_airline_collapsed", on ? "1" : "0");
      } catch (_) {}
    }
    fixMap();
    setTimeout(fixMap, 80);
    setTimeout(fixMap, 260);
    if (!quiet) {
      setStatus(on ? "Airline panel hidden" : "Airline panel shown", "ok");
    }
  }

  function fmtDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
    return m + ":" + String(r).padStart(2, "0");
  }

  function phaseLabel(p) {
    const map = {
      gate: "Gate",
      taxi_out: "Taxi out",
      airborne: "Airborne",
      taxi_in: "Taxi in",
    };
    return map[p] || p || "—";
  }

  /** Landing rate ft/min (negative = descending). */
  function fmtLandingFpm(v) {
    if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
    const n = Math.round(Number(v));
    const sign = n > 0 ? "+" : "";
    return sign + n + " fpm";
  }

  let overview = null;
  let pollTimer = null;
  /** false = show saved card; true = create/edit form. Never force create when profile exists. */
  let editingProfile = false;

  /** Cached logbook rows for detail/delete (id → flight). */
  let logbookById = {};
  let logbookFlights = [];
  let logbookTotal = 0;
  let logbookOffset = 0;
  const LOGBOOK_PAGE = 25;
  let selectedLogId = null;

  function hasProfile() {
    return !!(overview && overview.profile);
  }

  function hasActive() {
    return !!(overview && overview.active);
  }

  function prefillFromPlan() {
    const depEl = $("#al-dep");
    const destEl = $("#al-dest");
    if (!depEl || !destEl) return;
    if (depEl.value && destEl.value) return;
    let dep = ($("#fp-dep") && $("#fp-dep").value) || "";
    let dest = ($("#fp-dest") && $("#fp-dest").value) || "";
    try {
      if (typeof state !== "undefined" && state) {
        if (!dep && state.flightPlan && state.flightPlan.dep) dep = state.flightPlan.dep.icao || "";
        if (!dest && state.flightPlan && state.flightPlan.dest) dest = state.flightPlan.dest.icao || "";
        if (!dep && state.depChart && state.depChart.airport) dep = state.depChart.airport.icao || "";
        if (!dest && state.destChart && state.destChart.airport) dest = state.destChart.airport.icao || "";
        if (!dep && state.airport) dep = state.airport.icao || "";
      }
    } catch (_) {}
    if (!depEl.value && dep) depEl.value = String(dep).toUpperCase();
    if (!destEl.value && dest) destEl.value = String(dest).toUpperCase();
  }

  function fillProfileForm(p) {
    const name = $("#al-name");
    const code = $("#al-code");
    const cs = $("#al-callsign");
    const color = $("#al-color");
    const motto = $("#al-motto");
    if (name) name.value = (p && p.name) || "";
    if (code) code.value = (p && p.code) || "";
    if (cs) cs.value = (p && p.callsign) || "";
    if (color) color.value = (p && p.color) || "#3b82f6";
    if (motto) motto.value = (p && p.motto) || "";
  }

  function renderProfile() {
    const view = $("#airline-profile-view");
    const form = $("#airline-profile-form");
    const actions = $("#airline-profile-actions");
    const btnCancel = $("#btn-al-cancel-edit");
    const btnSave = $("#btn-al-save");
    const p = overview && overview.profile;

    // No airline yet → create form until first permanent save
    if (!p) {
      editingProfile = true;
      if (view) {
        view.classList.add("hidden");
        view.innerHTML = "";
      }
      if (actions) actions.classList.add("hidden");
      if (form) form.classList.remove("hidden");
      if (btnCancel) btnCancel.classList.add("hidden");
      if (btnSave) btnSave.textContent = "Create airline";
      return;
    }

    // Saved airline: card + Edit by default; form only while editing
    if (view) {
      view.innerHTML =
        '<div class="al-profile-card">' +
        '<div class="al-profile-swatch" style="background:' +
        escapeHtml(p.color || "#3b82f6") +
        '"></div>' +
        "<div>" +
        '<div class="al-profile-name">' +
        escapeHtml(p.name) +
        "</div>" +
        '<div class="al-profile-meta">' +
        escapeHtml(p.code || "—") +
        " · " +
        escapeHtml(p.callsign || "—") +
        "</div>" +
        (p.motto
          ? '<div class="al-profile-motto">“' + escapeHtml(p.motto) + "”</div>"
          : "") +
        "</div></div>";
      view.classList.toggle("hidden", editingProfile);
    }
    if (actions) actions.classList.toggle("hidden", editingProfile);
    if (form) form.classList.toggle("hidden", !editingProfile);
    if (btnCancel) btnCancel.classList.toggle("hidden", !editingProfile);
    if (btnSave) btnSave.textContent = "Save changes";

    if (editingProfile) fillProfileForm(p);
  }

  function renderLive() {
    const hint = $("#al-live-hint");
    const form = $("#al-flight-form");
    const live = $("#al-flight-live");
    const startBtn = $("#btn-al-start");
    const active = overview && overview.active;

    if (!hasProfile()) {
      if (hint)
        hint.textContent =
          "Create your airline above, then connect MSFS and start a flight to build your logbook.";
      if (form) form.classList.remove("hidden");
      if (live) live.classList.add("hidden");
      if (startBtn) startBtn.disabled = true;
      return;
    }

    if (active) {
      if (hint)
        hint.textContent = active.sim_connected
          ? "Tracking via SimConnect — fly your route, then End flight to log it."
          : "Flight open — Connect MSFS to track position, distance and phase.";
      if (form) form.classList.add("hidden");
      if (live) live.classList.remove("hidden");

      const fn = $("#al-live-fn");
      const phase = $("#al-live-phase");
      const route = $("#al-live-route");
      if (fn) fn.textContent = active.flight_number || "—";
      if (phase) {
        phase.textContent = phaseLabel(active.phase);
        phase.className = "al-phase-badge phase-" + (active.phase || "gate");
      }
      if (route)
        route.textContent =
          (active.dep_icao || "????") + " → " + (active.dest_icao || "????");
      const block = $("#al-live-block");
      const air = $("#al-live-air");
      const nm = $("#al-live-nm");
      const alt = $("#al-live-alt");
      const gs = $("#al-live-gs");
      const track = $("#al-live-track");
      if (block) block.textContent = fmtDuration(active.block_time_s);
      if (air) air.textContent = fmtDuration(active.airborne_time_s);
      if (nm) nm.textContent = (active.distance_nm != null ? active.distance_nm : 0) + " NM";
      if (alt)
        alt.textContent =
          active.max_alt_ft != null ? Math.round(active.max_alt_ft) + " ft" : "—";
      const last = active.last || {};
      if (gs)
        gs.textContent =
          last.gs_kt != null
            ? Math.round(last.gs_kt) + " kt"
            : active.max_gs_kt != null
              ? "max " + Math.round(active.max_gs_kt) + " kt"
              : "—";
      const landing = $("#al-live-landing");
      if (landing) landing.textContent = fmtLandingFpm(active.landing_fpm);
      if (track)
        track.textContent = active.tracking
          ? "Live"
          : active.sim_connected
            ? "Waiting…"
            : "MSFS off";
    } else {
      if (hint)
        hint.textContent =
          "Connect MSFS (map toolbar), set dep/dest, then Start flight. Tracking runs on the server while you fly.";
      if (form) form.classList.remove("hidden");
      if (live) live.classList.add("hidden");
      if (startBtn) startBtn.disabled = false;
      prefillFromPlan();
    }
  }

  function renderStats() {
    const st = (overview && overview.stats) || {};
    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v != null ? String(v) : "0";
    };
    set("#al-st-flights", st.flights_completed || 0);
    set("#al-st-hours", st.block_hours || 0);
    set("#al-st-air", st.airborne_hours || 0);
    set("#al-st-nm", st.distance_nm || 0);
    set("#al-st-apt", st.unique_airports || 0);
    set("#al-st-long", st.longest_flight_nm || 0);
    set("#al-st-avg-ldg", fmtLandingFpm(st.avg_landing_fpm));
    set("#al-st-soft-ldg", fmtLandingFpm(st.softest_landing_fpm));
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return String(iso);
    }
  }

  function renderLogbook() {
    const list = $("#al-logbook-list");
    const countEl = $("#al-logbook-count");
    const moreBtn = $("#btn-al-log-more");
    if (!list) return;

    if (countEl) {
      countEl.textContent =
        logbookTotal > 0
          ? logbookTotal === 1
            ? "1 flight"
            : logbookTotal + " flights"
          : "";
    }

    if (!logbookFlights.length) {
      list.innerHTML =
        '<p class="airline-hint">No flights logged yet. Complete a flight with MSFS to fill your logbook.</p>';
      if (moreBtn) moreBtn.classList.add("hidden");
      return;
    }

    list.innerHTML = logbookFlights
      .map(function (f) {
        const cancelled = f.outcome === "cancelled";
        const id = escapeHtml(f.id || "");
        const route =
          escapeHtml(f.dep_icao || "????") + " → " + escapeHtml(f.dest_icao || "????");
        const meta =
          (f.distance_nm != null ? f.distance_nm + " NM" : "—") +
          " · " +
          fmtDuration(f.block_time_s) +
          (f.landing_fpm != null ? " · " + fmtLandingFpm(f.landing_fpm) : "") +
          (cancelled ? " · cancelled" : "") +
          (f.ended_at ? " · " + fmtDateTime(f.ended_at) : "");
        return (
          '<div class="al-log-item' +
          (cancelled ? " cancelled" : "") +
          '" data-flight-id="' +
          id +
          '" role="button" tabindex="0" title="View flight details">' +
          '<div class="al-log-main">' +
          '<div class="al-log-top">' +
          '<span class="al-log-fn">' +
          escapeHtml(f.flight_number || "—") +
          "</span>" +
          "<span>" +
          route +
          "</span>" +
          "</div>" +
          '<div class="al-log-meta">' +
          escapeHtml(meta) +
          "</div>" +
          "</div>" +
          '<button type="button" class="al-log-del" data-delete-id="' +
          id +
          '" title="Delete this flight" aria-label="Delete flight">×</button>' +
          "</div>"
        );
      })
      .join("");

    if (moreBtn) {
      moreBtn.classList.toggle("hidden", logbookFlights.length >= logbookTotal);
    }
  }

  function openLogModal(flight) {
    if (!flight) return;
    selectedLogId = flight.id || null;
    const modal = $("#al-log-modal");
    if (!modal) return;

    const set = function (sel, text) {
      const el = $(sel);
      if (el) el.textContent = text;
    };
    set("#al-log-fn", flight.flight_number || "—");
    set(
      "#al-log-route",
      (flight.dep_icao || "????") + " → " + (flight.dest_icao || "????")
    );
    set("#al-log-block", fmtDuration(flight.block_time_s));
    set("#al-log-air", fmtDuration(flight.airborne_time_s));
    set(
      "#al-log-nm",
      (flight.distance_nm != null ? flight.distance_nm : 0) + " NM"
    );
    set(
      "#al-log-alt",
      flight.max_alt_ft != null ? Math.round(flight.max_alt_ft) + " ft" : "—"
    );
    set(
      "#al-log-gs",
      flight.max_gs_kt != null ? Math.round(flight.max_gs_kt) + " kt" : "—"
    );
    set("#al-log-landing", fmtLandingFpm(flight.landing_fpm));
    set("#al-log-phase", phaseLabel(flight.phase_end || flight.phase));

    const outcomeEl = $("#al-log-outcome");
    if (outcomeEl) {
      const o = flight.outcome || "completed";
      outcomeEl.textContent = o;
      outcomeEl.className =
        "al-log-outcome" + (o === "cancelled" ? " is-cancelled" : "");
      outcomeEl.classList.remove("hidden");
    }

    const sub = $("#al-log-sub");
    if (sub) {
      sub.textContent =
        (flight.airline_name || flight.airline_code || "Logbook") +
        (flight.outcome === "cancelled" ? " · cancelled" : "");
    }
    const when = $("#al-log-when");
    if (when) {
      when.textContent =
        "Started " +
        fmtDateTime(flight.started_at) +
        " · Ended " +
        fmtDateTime(flight.ended_at);
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    modal.removeAttribute("hidden");
  }

  function closeLogModal() {
    const modal = $("#al-log-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("hidden", "");
    selectedLogId = null;
  }

  async function refreshLogbook(opts) {
    const append = !!(opts && opts.append);
    try {
      if (!append) {
        logbookOffset = 0;
        logbookFlights = [];
        logbookById = {};
      }
      const res = await fetch(
        "/api/airline/logbook?limit=" +
          LOGBOOK_PAGE +
          "&offset=" +
          logbookOffset
      );
      const data = await res.json();
      if (!data.ok) return;
      logbookTotal = data.total || 0;
      const page = data.flights || [];
      page.forEach(function (f) {
        if (f && f.id) logbookById[f.id] = f;
      });
      if (append) {
        logbookFlights = logbookFlights.concat(page);
      } else {
        logbookFlights = page;
      }
      logbookOffset = logbookFlights.length;
      renderLogbook();
    } catch (_) {
      /* ignore */
    }
  }

  async function deleteLogFlight(flightId, { fromModal } = {}) {
    if (!flightId) return;
    const cached = logbookById[flightId];
    const label =
      (cached && cached.flight_number) ||
      (cached &&
        (cached.dep_icao || "????") + " → " + (cached.dest_icao || "????")) ||
      "this flight";
    if (
      !confirm(
        "Delete " +
          label +
          " from your logbook?\n\nCareer stats will update. This cannot be undone."
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        "/api/airline/logbook/" + encodeURIComponent(flightId),
        { method: "DELETE" }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : data.error || "Delete failed"
        );
      }
      if (fromModal) closeLogModal();
      setStatus("Deleted " + label + " from logbook", "ok");
      await refreshLogbook();
      await refreshOverview();
    } catch (err) {
      setStatus(err.message || "Could not delete flight", "err");
    }
  }

  async function refreshOverview() {
    try {
      const res = await fetch("/api/airline");
      if (!res.ok) return;
      overview = await res.json();
      renderProfile();
      renderLive();
      renderStats();
    } catch (_) {
      /* ignore */
    }
  }

  async function saveProfile(ev) {
    if (ev) ev.preventDefault();
    const name = ($("#al-name") && $("#al-name").value.trim()) || "";
    if (!name) {
      setStatus("Enter an airline name", "err");
      return;
    }
    const body = {
      name: name,
      code: ($("#al-code") && $("#al-code").value.trim()) || null,
      callsign: ($("#al-callsign") && $("#al-callsign").value.trim()) || null,
      color: ($("#al-color") && $("#al-color").value) || "#3b82f6",
      motto: ($("#al-motto") && $("#al-motto").value.trim()) || null,
    };
    try {
      const res = await fetch("/api/airline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        throw new Error(
          (data.detail && (typeof data.detail === "string" ? data.detail : data.detail[0])) ||
            data.error ||
            "Save failed"
        );
      }
      editingProfile = false;
      setStatus("Airline saved — " + (data.profile && data.profile.name), "ok");
      await refreshOverview();
      await refreshLogbook();
    } catch (err) {
      setStatus(err.message || "Could not save airline", "err");
    }
  }

  async function startFlight() {
    prefillFromPlan();
    const body = {
      dep_icao: ($("#al-dep") && $("#al-dep").value.trim().toUpperCase()) || null,
      dest_icao: ($("#al-dest") && $("#al-dest").value.trim().toUpperCase()) || null,
      flight_number: ($("#al-fn") && $("#al-fn").value.trim().toUpperCase()) || null,
    };
    try {
      const res = await fetch("/api/airline/flight/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const detail = data.detail;
        throw new Error(
          typeof detail === "string" ? detail : data.error || "Could not start flight"
        );
      }
      setStatus(
        "Flight " +
          ((data.active && data.active.flight_number) || "") +
          " started — connect MSFS to track",
        "ok"
      );
      await refreshOverview();
    } catch (err) {
      setStatus(err.message || "Start flight failed", "err");
    }
  }

  function fillEndModal(active) {
    const a = active || {};
    const fn = $("#al-end-fn");
    const route = $("#al-end-route");
    const block = $("#al-end-block");
    const air = $("#al-end-air");
    const nm = $("#al-end-nm");
    const alt = $("#al-end-alt");
    const gs = $("#al-end-gs");
    const landing = $("#al-end-landing");
    const phase = $("#al-end-phase");
    if (fn) fn.textContent = a.flight_number || "—";
    if (route)
      route.textContent =
        (a.dep_icao || "????") + " → " + (a.dest_icao || "????");
    if (block) block.textContent = fmtDuration(a.block_time_s);
    if (air) air.textContent = fmtDuration(a.airborne_time_s);
    if (nm)
      nm.textContent =
        (a.distance_nm != null ? a.distance_nm : 0) + " NM";
    if (alt)
      alt.textContent =
        a.max_alt_ft != null ? Math.round(a.max_alt_ft) + " ft" : "—";
    if (gs)
      gs.textContent =
        a.max_gs_kt != null ? Math.round(a.max_gs_kt) + " kt" : "—";
    if (landing) landing.textContent = fmtLandingFpm(a.landing_fpm);
    if (phase) phase.textContent = phaseLabel(a.phase);
  }

  function setEndModalBusy(busy) {
    const logBtn = $("#btn-al-end-log");
    const discardBtn = $("#btn-al-end-discard");
    if (logBtn) logBtn.disabled = !!busy;
    if (discardBtn) discardBtn.disabled = !!busy;
  }

  function openEndModal() {
    const modal = $("#al-end-modal");
    if (!modal) return;
    fillEndModal(overview && overview.active);
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    modal.removeAttribute("hidden");
    setEndModalBusy(false);
  }

  function closeEndModal() {
    const modal = $("#al-end-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("hidden", "");
    setEndModalBusy(false);
  }

  async function endFlight() {
    // Refresh so the summary uses the latest tracked stats
    await refreshOverview();
    if (!hasActive()) {
      setStatus("No flight in progress", "err");
      return;
    }
    openEndModal();
  }

  async function logEndedFlight() {
    setEndModalBusy(true);
    try {
      const res = await fetch("/api/airline/flight/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : data.error || "End failed"
        );
      }
      const f = data.flight || {};
      closeEndModal();
      setStatus(
        "Logged " +
          (f.flight_number || "flight") +
          " · " +
          (f.distance_nm || 0) +
          " NM · " +
          fmtDuration(f.block_time_s),
        "ok"
      );
      await refreshOverview();
      await refreshLogbook();
    } catch (err) {
      setEndModalBusy(false);
      setStatus(err.message || "End flight failed", "err");
    }
  }

  async function discardEndedFlight() {
    setEndModalBusy(true);
    try {
      const res = await fetch("/api/airline/flight/discard", { method: "POST" });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : data.error || "Discard failed"
        );
      }
      const f = data.flight || {};
      closeEndModal();
      setStatus(
        "Discarded " +
          (f.flight_number || "flight") +
          " — not added to logbook",
        "ok"
      );
      await refreshOverview();
      await refreshLogbook();
    } catch (err) {
      setEndModalBusy(false);
      setStatus(err.message || "Discard failed", "err");
    }
  }

  async function cancelFlight() {
    if (!confirm("Cancel this flight and log it as cancelled?")) return;
    try {
      const res = await fetch("/api/airline/flight/cancel", { method: "POST" });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : data.error || "Cancel failed"
        );
      }
      closeEndModal();
      setStatus("Flight cancelled and logged", "ok");
      await refreshOverview();
      await refreshLogbook();
    } catch (err) {
      setStatus(err.message || "Cancel failed", "err");
    }
  }

  async function resetAirline() {
    if (
      !confirm(
        "Delete your airline and clear the logbook? This cannot be undone."
      )
    )
      return;
    try {
      const res = await fetch("/api/airline?wipe_logbook=true", { method: "DELETE" });
      if (!res.ok) throw new Error("Reset failed");
      editingProfile = true;
      const name = $("#al-name");
      if (name) name.value = "";
      setStatus("Airline reset", "ok");
      await refreshOverview();
      await refreshLogbook();
    } catch (err) {
      setStatus(err.message || "Reset failed", "err");
    }
  }

  function bind() {
    $("#btn-airline-collapse")?.addEventListener("click", function () {
      setAirlineCollapsed(true);
    });
    $("#btn-airline-open")?.addEventListener("click", function () {
      setAirlineCollapsed(false);
    });

    $("#airline-profile-form")?.addEventListener("submit", saveProfile);
    $("#btn-al-edit")?.addEventListener("click", function () {
      editingProfile = true;
      renderProfile();
    });
    $("#btn-al-cancel-edit")?.addEventListener("click", function () {
      editingProfile = false;
      renderProfile();
    });
    $("#btn-al-reset")?.addEventListener("click", resetAirline);
    $("#btn-al-start")?.addEventListener("click", startFlight);
    $("#btn-al-end")?.addEventListener("click", endFlight);
    $("#btn-al-cancel")?.addEventListener("click", cancelFlight);
    $("#btn-al-end-log")?.addEventListener("click", logEndedFlight);
    $("#btn-al-end-discard")?.addEventListener("click", discardEndedFlight);
    document.querySelectorAll("[data-al-end-close]").forEach(function (el) {
      el.addEventListener("click", closeEndModal);
    });
    document.querySelectorAll("[data-al-log-close]").forEach(function (el) {
      el.addEventListener("click", closeLogModal);
    });
    $("#btn-al-log-delete")?.addEventListener("click", function () {
      if (selectedLogId) deleteLogFlight(selectedLogId, { fromModal: true });
    });
    $("#btn-al-log-more")?.addEventListener("click", function () {
      refreshLogbook({ append: true });
    });

    // Logbook list: open detail or delete (event delegation)
    $("#al-logbook-list")?.addEventListener("click", function (e) {
      const del = e.target.closest("[data-delete-id]");
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        deleteLogFlight(del.getAttribute("data-delete-id"));
        return;
      }
      const item = e.target.closest(".al-log-item[data-flight-id]");
      if (!item) return;
      const id = item.getAttribute("data-flight-id");
      const f = id && logbookById[id];
      if (f) openLogModal(f);
    });
    $("#al-logbook-list")?.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const item = e.target.closest(".al-log-item[data-flight-id]");
      if (!item) return;
      e.preventDefault();
      const id = item.getAttribute("data-flight-id");
      const f = id && logbookById[id];
      if (f) openLogModal(f);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const logModal = $("#al-log-modal");
      if (logModal && logModal.classList.contains("is-open")) {
        closeLogModal();
        return;
      }
      const modal = $("#al-end-modal");
      if (modal && modal.classList.contains("is-open")) closeEndModal();
    });

    // Uppercase ICAO fields
    ["#al-dep", "#al-dest", "#al-fn", "#al-code"].forEach(function (sel) {
      $(sel)?.addEventListener("input", function (e) {
        const t = e.target;
        const start = t.selectionStart;
        t.value = t.value.toUpperCase();
        try {
          t.setSelectionRange(start, start);
        } catch (_) {}
      });
    });
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      refreshOverview();
    }, 2000);
  }

  // Boot
  bind();
  try {
    if (localStorage.getItem("navapron_airline_collapsed") === "1") {
      setAirlineCollapsed(true, { persist: false, quiet: true });
    }
  } catch (_) {}
  refreshOverview().then(refreshLogbook);
  startPoll();
})();
