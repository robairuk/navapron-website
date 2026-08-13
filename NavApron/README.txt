NavApron — MSFS companion
=========================

WHAT IT IS
  Free desktop companion for Microsoft Flight Simulator: home hub, taxi charts,
  gate-to-gate journey planning, flight plans (incl. SimBrief import), SIDs/STARs,
  and live aircraft via SimConnect — all on one map.

  • Home screen: Full journey · Taxi · Flight plan · Departure · Arrival
  • Interactive surface charts (taxiways, runways, stands/gates with numbers)
  • Taxi-out clearance routing and taxi-in after landing
  • Enroute flight plans + save/load; open SimBrief & import latest OFP
  • Load both dep and dest airports for gate-to-gate
  • Departure SID / Arrival STAR planning
  • Connect MSFS: live plane, Follow, Follow plan (active leg), use aircraft as start
  • Airline panel (right): create airline, start/end flights, logbook & career stats
  • Keep window on top; layer filters; Fit chart / Fit all

SAFETY / WINDOWS WARNINGS
  NavApron is safe freeware for sim use — not a virus.
  Windows SmartScreen or antivirus may warn about an "unknown publisher"
  because the app is not code-signed yet (common for small desktop tools).
  That is a false positive. Only download from the official link.
  If SmartScreen appears: More info → Run anyway (when you trust the source).

REQUIREMENTS
  - Windows 10/11
  - Microsoft Edge (for fallback window) and ideally WebView2 Runtime for the
      native NavApron window + taskbar logo.
  - If the console mentions "Python.Runtime.Loader.Initialize" / pythonnet:
      that is the desktop host bridge, NOT a missing WebView2 install.
      NavApron still runs in Edge/Chrome app mode (browser icon) — fully usable.
      To improve native WebView odds: install VC++ x64 redistributable
      https://aka.ms/vs/17/release/vc_redist.x64.exe
      and use the latest NavApron zip. Optional log: navapron_pythonnet.log
      next to NavApron.exe.
  - Internet connection (airport charts + first-time data download)
  - For live aircraft: MSFS on the same PC, with a flight loaded
  - For SimBrief: free account + username; use Generate & import (or import latest OFP)

HOW TO RUN
  1. Unzip this folder anywhere
  2. Double-click NavApron.exe
  3. A black console may open — you can minimize it; the map window is the app
  4. Close the map window (or press Enter in the console) to quit
  5. Home screen: click a mode (Full journey / Taxi / …) to open the map
     If Keep on top is on, turn it off to put NavApron behind other windows

UPDATES
  Home screen → "Check for updates" (or Updates in the sidebar).
  If the publisher configured an update feed, NavApron can download the next
  zip and install it for you. Your data folder (airline logbook, layouts) is kept.
  Manual update still works: download the new zip and replace the old folder
  (or overwrite files) while keeping your data folder if you want.

FIRST LAUNCH
  On first run NavApron downloads free airport/navaid databases.
  This needs internet and may take a minute.

TIPS
  - Use a second monitor next to MSFS; enable Keep on top if you like
    (works best with MSFS windowed or borderless — exclusive fullscreen cannot
     be covered by any app). Keep on top only applies in NavApron.exe
  - Hide the left sidebar (« Hide or [ key) for more map; Menu tab or ] to show
  - Hide the airline panel (Hide ») — Airline tab on the map edge reopens it
  - Full journey: taxi out (+ SID, same runway) → plan → taxi in / STAR (layers stay on the map)
  - Flight plan: Show plan, or SimBrief Generate & import (auto-pulls after you click Generate)
  - Load both airports so dep + dest charts appear together
  - Connect MSFS for live aircraft (same PC, flight loaded)
  - Follow plan: highlights the current path segment and keeps map on A/C + next fixes
  - Airline: create airline → Start flight → fly in MSFS → End flight to fill logbook
  - Click Refresh on an airport to reload stands/gates from OpenStreetMap
  - Gate numbers appear when you zoom in on the apron

SUPPORT
  Buy me a coffee: https://buymeacoffee.com/robair

CREDITS
  Surface maps: OpenStreetMap
  Airports/navaids: OurAirports
  SimBrief OFPs: generated on SimBrief (Navigraph); imported by username
  SID/STAR tracks are approximate for sim use only (not official AIP)
