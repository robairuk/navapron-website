/**
 * NavApron changelog loader (runtime).
 *
 * DO NOT edit release notes here by hand.
 * Use:  Edit Changelog.bat   (or tools/edit_changelog.py)
 *
 * Source of truth: frontend/changelog.json
 */
(function (global) {
  global.NAVAPRON_CHANGELOG = global.NAVAPRON_CHANGELOG || [];

  function apply(data) {
    if (Array.isArray(data)) {
      global.NAVAPRON_CHANGELOG = data;
    }
  }

  // Prefer JSON so a simple editor can save without JS syntax errors
  try {
    fetch("/changelog.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("no json");
        return r.json();
      })
      .then(apply)
      .catch(function () {
        /* keep empty array — What's New will say to use the editor */
      });
  } catch (e) {
    /* ignore */
  }
})(typeof window !== "undefined" ? window : globalThis);
