/**
 * NavApron software version
 * ─────────────────────────────────────────────────────────────
 * Edit APP_VERSION below whenever you want the UI label to change.
 * Example: "v0.3"  →  displays as  "Beta Version: v0.3"
 *
 * APP_VERSION_PREFIX can also be changed (e.g. "Release", "RC").
 *
 * What's New / changelog:
 *   Use Edit Changelog.bat  (do not hand-edit JS for release notes)
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  global.NAVAPRON_VERSION = "v0.5.1";
  global.NAVAPRON_VERSION_PREFIX = "Beta Version";
  global.NAVAPRON_VERSION_LABEL =
    global.NAVAPRON_VERSION_PREFIX + ": " + global.NAVAPRON_VERSION;
})(typeof window !== "undefined" ? window : globalThis);
