/**
 * NavApron — zip auto-update UI (feed = version.json on your website)
 */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let lastCheck = null;
  let pollTimer = null;
  let busy = false;

  function setStatus(text, mode) {
    if (typeof window.setStatus === "function") {
      window.setStatus(text, mode);
      return;
    }
    const el = $("#status-text");
    const dot = $("#status-dot");
    if (el) el.textContent = text;
    if (dot) {
      dot.classList.remove("busy", "err");
      if (mode === "busy") dot.classList.add("busy");
      if (mode === "err") dot.classList.add("err");
    }
  }

  function openModal() {
    const modal = $("#update-modal");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    modal.removeAttribute("hidden");
  }

  function closeModal() {
    const modal = $("#update-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("hidden", "");
    stopProgressPoll();
  }

  function setBadge(show) {
    const badge = $("#hub-update-badge");
    if (badge) badge.classList.toggle("hidden", !show);
  }

  function fillUi(data, opts) {
    const quiet = !!(opts && opts.quiet);
    const line = $("#update-status-line");
    const localEl = $("#update-local-ver");
    const remoteEl = $("#update-remote-ver");
    const notes = $("#update-notes");
    const installBtn = $("#btn-update-install");
    const sub = $("#update-sub");

    const local =
      (data && (data.local_version || (data.ok && data.local_version))) ||
      (typeof window.NAVAPRON_VERSION === "string" ? window.NAVAPRON_VERSION : "—");
    if (localEl) localEl.textContent = local || "—";

    if (!data) {
      if (line) line.textContent = "Not checked yet.";
      if (remoteEl) remoteEl.textContent = "—";
      if (installBtn) installBtn.classList.add("hidden");
      return;
    }

    if (data.feed_url === null || data.feed_configured === false) {
      if (line)
        line.textContent =
          "Update feed is not set. Rebuild NavApron or check https://navapron.com/version.json";
      if (remoteEl) remoteEl.textContent = "—";
      if (notes)
        notes.textContent =
          "The app expects version.json on navapron.com (see UPDATE-HOSTING.md).";
      if (installBtn) installBtn.classList.add("hidden");
      setBadge(false);
      if (!quiet) setStatus("Update feed not configured", "err");
      return;
    }

    if (data.ok === false && data.error) {
      if (line) line.textContent = "Could not check: " + data.error;
      if (remoteEl) remoteEl.textContent = data.remote_version || "—";
      if (notes) notes.textContent = "";
      if (installBtn) installBtn.classList.add("hidden");
      if (!quiet) setStatus("Update check failed", "err");
      return;
    }

    if (remoteEl) remoteEl.textContent = data.remote_version || "—";
    if (sub && data.feed_url) {
      sub.textContent = "Feed: " + data.feed_url;
    }

    if (data.update_available) {
      if (line)
        line.textContent =
          "A newer build is available (" +
          (data.remote_version || "?") +
          "). Your airline logbook and layouts are kept.";
      if (notes) notes.textContent = data.notes || "";
      if (installBtn) {
        installBtn.classList.remove("hidden");
        installBtn.disabled = false;
        installBtn.textContent = "Download & install";
      }
      setBadge(true);
      if (!quiet) setStatus("Update available: " + (data.remote_version || ""), "ok");
    } else {
      if (line) line.textContent = "You are on the latest version.";
      if (notes) notes.textContent = data.notes || "";
      if (installBtn) installBtn.classList.add("hidden");
      setBadge(false);
      if (!quiet) setStatus("NavApron is up to date", "ok");
    }
  }

  function stopProgressPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    const wrap = $("#update-progress-wrap");
    if (wrap) wrap.classList.add("hidden");
  }

  function startProgressPoll() {
    stopProgressPoll();
    const wrap = $("#update-progress-wrap");
    const bar = $("#update-progress-bar");
    if (wrap) wrap.classList.remove("hidden");
    pollTimer = setInterval(async function () {
      try {
        const res = await fetch("/api/update/status");
        const st = await res.json();
        if (bar && st.progress != null) {
          bar.style.width = Math.round((st.progress || 0) * 100) + "%";
        }
        if (!st.downloading && pollTimer) {
          /* keep bar until install finishes */
        }
      } catch (_) {
        /* ignore */
      }
    }, 400);
  }

  async function checkUpdates(opts) {
    const quiet = !!(opts && opts.quiet);
    const open = !!(opts && opts.open);
    /** Auto-open dialog when a newer version is found (launch check). */
    const openIfAvailable = !!(opts && opts.openIfAvailable);
    if (busy) return lastCheck;
    busy = true;
    if (open) openModal();
    const line = $("#update-status-line");
    if (line && !quiet) line.textContent = "Checking…";
    if (!quiet) setStatus("Checking for updates…", "busy");
    try {
      const res = await fetch("/api/update/check", { method: "POST" });
      const data = await res.json();
      lastCheck = data;
      fillUi(data, { quiet: quiet && !data.update_available });
      if (data.update_available) {
        setBadge(true);
        setStatus("Update available: " + (data.remote_version || ""), "ok");
        if (openIfAvailable && !open) {
          openModal();
          fillUi(data, { quiet: false });
        }
      } else if (quiet && data.ok !== false) {
        // Launch check: stay quiet when already current
        setBadge(false);
      }
      return data;
    } catch (err) {
      const fail = { ok: false, error: err.message || "Network error" };
      lastCheck = fail;
      if (!quiet) fillUi(fail, { quiet: false });
      return fail;
    } finally {
      busy = false;
    }
  }

  /**
   * On every launch: check navapron.com for a newer zip.
   * Opens the update dialog only when an update is available.
   * Retries a few times if the local API is still starting.
   */
  async function autoCheckOnLaunch() {
    const maxAttempts = 6;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        // Ensure local server is up before calling update check
        const health = await fetch("/api/health");
        if (!health.ok) throw new Error("not ready");
        await checkUpdates({ quiet: true, open: false, openIfAvailable: true });
        return;
      } catch (_) {
        await new Promise(function (r) {
          setTimeout(r, 1000);
        });
      }
    }
  }

  async function installUpdate() {
    if (busy) return;
    busy = true;
    const installBtn = $("#btn-update-install");
    const line = $("#update-status-line");
    if (installBtn) {
      installBtn.disabled = true;
      installBtn.textContent = "Downloading…";
    }
    if (line)
      line.textContent =
        "Downloading zip… then NavApron will install and restart. Leave this window open.";
    setStatus("Downloading update…", "busy");
    startProgressPoll();
    try {
      // Phase 1 — download & stage (can take a while on large zips)
      const dlRes = await fetch("/api/update/download", { method: "POST" });
      const dl = await dlRes.json().catch(function () {
        return {};
      });
      if (!dlRes.ok || dl.ok === false) {
        throw new Error(
          typeof dl.detail === "string"
            ? dl.detail
            : dl.error || "Download failed"
        );
      }
      if (!dl.staged) {
        stopProgressPoll();
        if (line)
          line.textContent = dl.message || "Nothing to install (already up to date).";
        if (installBtn) {
          installBtn.disabled = false;
          installBtn.textContent = "Download & install";
        }
        setStatus(dl.message || "Already up to date", "ok");
        busy = false;
        return;
      }

      // Phase 2 — apply (launches installer script, then app exits)
      if (installBtn) installBtn.textContent = "Installing…";
      if (line)
        line.textContent =
          "Download complete. Installing and restarting NavApron…";
      setStatus("Installing update — restarting…", "busy");

      const apRes = await fetch("/api/update/apply", { method: "POST" });
      const ap = await apRes.json().catch(function () {
        return {};
      });
      if (!apRes.ok || ap.ok === false) {
        throw new Error(
          typeof ap.detail === "string"
            ? ap.detail
            : ap.error || "Install/restart failed"
        );
      }

      if (line)
        line.textContent =
          ap.message ||
          "Installing… this window should close and NavApron will reopen.";
      if (installBtn) installBtn.textContent = "Restarting…";

      // If still open after ~12s, apply script may have failed — point at log
      setTimeout(function () {
        if (line)
          line.textContent =
            "Still open? Close NavApron fully, then run NavApron.exe again. " +
            "If it failed, open _update_log.txt next to NavApron.exe.";
        if (installBtn) {
          installBtn.disabled = false;
          installBtn.textContent = "Retry install";
        }
        busy = false;
        stopProgressPoll();
      }, 12000);
    } catch (err) {
      stopProgressPoll();
      if (line) line.textContent = err.message || "Update failed";
      if (installBtn) {
        installBtn.disabled = false;
        installBtn.textContent = "Download & install";
      }
      setStatus(err.message || "Update failed", "err");
      busy = false;
    }
  }

  function bind() {
    $("#btn-check-updates-hub")?.addEventListener("click", function () {
      checkUpdates({ open: true, quiet: false });
    });
    $("#btn-check-updates")?.addEventListener("click", function () {
      checkUpdates({ open: true, quiet: false });
    });
    $("#btn-update-recheck")?.addEventListener("click", function () {
      checkUpdates({ open: true, quiet: false });
    });
    $("#btn-update-install")?.addEventListener("click", function () {
      installUpdate();
    });
    document.querySelectorAll("[data-update-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const modal = $("#update-modal");
      if (modal && modal.classList.contains("is-open")) closeModal();
    });
    $("#hub-update-badge")?.addEventListener("click", function () {
      checkUpdates({ open: true, quiet: false });
    });
  }

  bind();
  // Auto-check as soon as the app is up (every launch)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(autoCheckOnLaunch, 800);
    });
  } else {
    setTimeout(autoCheckOnLaunch, 800);
  }
})();
