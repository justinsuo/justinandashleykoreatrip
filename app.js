/* ============================================================
 * Justin & Ashley · Seoul — app.js
 * Tabs (Itinerary | Map | Trip info) · Card grid w/ photos
 * Leaflet + SortableJS via CDN · localStorage persistence
 * ============================================================ */

const STORAGE_KEY = "seoul-eats-itinerary-v1";
const DARK_KEY = "seoul-eats-dark";
const SCHEMA_VERSION = 2;   // bumped: adds michelin field + image_url + new Michelin backups

// Type -> emoji
const TYPE_EMOJI = {
  bbq: "🥩", market: "🛒", cafe: "☕", bar: "🍸",
  streetfood: "🍢",
  noodles: "🍜", soup: "🍲", seafood: "🦀", dessert: "🍧",
  park: "🌳", splurge: "⭐", other: "📍"
};
const TYPE_OPTIONS = Object.keys(TYPE_EMOJI);
// Pretty labels for per-type subsections in the Ideas tray
const TYPE_LABEL = {
  bbq: "BBQ", market: "Markets", cafe: "Cafés", bar: "Bars",
  streetfood: "Street food", noodles: "Noodles", soup: "Soups",
  seafood: "Seafood", dessert: "Desserts", park: "Parks",
  splurge: "Splurges", other: "Other"
};
// Subsection order in the Ideas tray (after Michelin)
const IDEAS_TYPE_ORDER = [
  "streetfood", "bar", "bbq", "noodles", "soup", "market",
  "cafe", "seafood", "dessert", "park", "splurge", "other"
];

// Slots — Breakfast → Lunch → Dinner → Bar rhythm
const SLOT_LABEL = {
  breakfast: "🍳 Breakfast",
  lunch:     "🍱 Lunch",
  dinner:    "🍽 Dinner",
  bar:       "🍸 Bar",
  cafe:      "☕ Café",
  snack:     "🍢 Snack",
  sight:     "🌳 Sight"
};
const SLOT_OPTIONS = Object.keys(SLOT_LABEL);
const CORE_SLOTS = ["breakfast", "lunch", "dinner", "bar"]; // expected on Days 1–4
const SLOT_ORDER_RANK = { breakfast: 1, lunch: 2, cafe: 3, sight: 4, snack: 5, dinner: 6, bar: 7 };

// Reservation status meta
const RES_STATUS = {
  none:     { emoji: "🪑", label: "No reservation needed (market / street food)", short: "" },
  unlikely: { emoji: "🪑", label: "Reservation not likely needed — walk-in usually fine", short: "walk-in OK" },
  needed:   { emoji: "⚠️", label: "Reservation needed — book ahead",   short: "needs booking" },
  booked:   { emoji: "✅", label: "Reservation booked",                short: "booked" }
};
const RES_OPTIONS = Object.keys(RES_STATUS);

// ----------- State -----------
let state = null;
let map = null;
let mapInitialized = false;
let markers = {};
let dayLayers = {};
let polylines = {};
let selectedStopId = null;
let dropPinMode = false;
let hiddenDays = new Set();
let searchTimer = null;
let activeTab = "stops";   // stops | map | info
let migrationSnapshot = null;  // for the Undo button on the migration banner

// ----------- Persistence + migration -----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.stops) && Array.isArray(parsed.days)) {
        return migrateState(parsed);
      }
    }
  } catch (e) { console.warn("loadState failed:", e); }
  return freshState();
}

function freshState() {
  const seed = window.SEED_ITINERARY;
  return {
    version: SCHEMA_VERSION,
    meta: { ...seed.meta },
    days: JSON.parse(JSON.stringify(seed.days)),
    stops: JSON.parse(JSON.stringify(seed.stops)),
    tripNotes: "",
    dayNotes: {}
  };
}

// Merge new seed stops into existing saved data without losing user edits.
function migrateState(saved) {
  const seed = window.SEED_ITINERARY;
  const next = JSON.parse(JSON.stringify(saved));
  const savedVersion = next.version || 1;

  // Patch michelin field, image_url, unavailable, reservation_url onto existing stops
  // when the seed knows them but the saved copy doesn't (these are non-destructive
  // upgrades — they only fill in missing fields).
  const patched = [];
  for (const seedStop of seed.stops) {
    const existing = next.stops.find(s => s.id === seedStop.id);
    if (existing) {
      let didPatch = false;
      if (seedStop.michelin && !existing.michelin) { existing.michelin = seedStop.michelin; didPatch = true; }
      if (seedStop.image_url) {
        // Replace if missing OR if it's an old auto-seeded Unsplash URL (legacy
        // generic stock photos). User-pasted URLs (anything else) stay.
        const isLegacy = !existing.image_url ||
          /^https:\/\/images\.unsplash\.com\//.test(existing.image_url);
        if (isLegacy) { existing.image_url = seedStop.image_url; didPatch = true; }
      }
      if (seedStop.reservation_url && !existing.reservation_url) {
        existing.reservation_url = seedStop.reservation_url; didPatch = true;
      }
      // Patch reservation_status only when user hasn't acted on it
      // (missing or still "none"). Never overwrite "needed" or "booked".
      if (seedStop.reservation_status &&
          (!existing.reservation_status || existing.reservation_status === "none") &&
          existing.reservation_status !== seedStop.reservation_status) {
        existing.reservation_status = seedStop.reservation_status; didPatch = true;
      }
      if (seedStop.unavailable && existing.unavailable === undefined) {
        existing.unavailable = seedStop.unavailable; didPatch = true;
      }
      // Patch slot only if missing (don't trample user-edited slot)
      if (seedStop.slot && !existing.slot) {
        existing.slot = seedStop.slot; didPatch = true;
      }
      if (didPatch) patched.push(seedStop.id);
    }
  }

  // Seed meta.recipient + meta.trip_note if missing (don't trample user edits)
  let noteSeeded = false;
  if (seed.meta) {
    if (seed.meta.recipient && !next.meta.recipient) { next.meta.recipient = seed.meta.recipient; }
    if (seed.meta.trip_note && !next.meta.trip_note) {
      next.meta.trip_note = seed.meta.trip_note;
      noteSeeded = true;
    }
  }

  // Detect Section C layout drift — stops whose seed day/slot/time differs
  // from saved. If any drift exists, offer "Apply new layout?" in the banner.
  const layoutDrift = [];
  for (const seedStop of seed.stops) {
    const existing = next.stops.find(s => s.id === seedStop.id);
    if (!existing) continue;
    if (seedStop.day !== existing.day || (seedStop.slot && seedStop.slot !== existing.slot)
        || (seedStop.time && seedStop.time !== existing.time)) {
      layoutDrift.push({
        id: seedStop.id,
        seedDay: seedStop.day, seedSlot: seedStop.slot, seedTime: seedStop.time, seedOrder: seedStop.order
      });
    }
  }

  // Add new seed stops that don't exist yet (by id).
  const existingIds = new Set(next.stops.map(s => s.id));
  const added = [];
  const addedMichelin = [];
  const addedByType = {}; // non-michelin counts, keyed by type
  for (const seedStop of seed.stops) {
    if (!existingIds.has(seedStop.id)) {
      next.stops.push(JSON.parse(JSON.stringify(seedStop)));
      added.push(seedStop.id);
      if (seedStop.michelin) {
        addedMichelin.push(seedStop.id);
      } else {
        const t = seedStop.type || "other";
        addedByType[t] = (addedByType[t] || 0) + 1;
      }
    }
  }

  // Merge any seed days that aren't in saved data (so newly-added scheduled
  // stops always have a day group to render in).
  const existingDayNums = new Set(next.days.map(d => d.day));
  for (const seedDay of seed.days) {
    if (!existingDayNums.has(seedDay.day)) {
      next.days.push(JSON.parse(JSON.stringify(seedDay)));
    }
  }

  next.version = SCHEMA_VERSION;

  if (added.length || patched.length || noteSeeded || layoutDrift.length) {
    migrationSnapshot = {
      prev: saved,
      addedIds: added,
      addedMichelinIds: addedMichelin,
      addedByType,
      patchedIds: patched,
      noteSeeded,
      layoutDrift
    };
  }

  return next;
}

let saveTimer = null;
function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.error("Save failed:", e); toast("Couldn't save — storage full?"); }
  }, 200);
}

// ----------- Helpers -----------
function uid(prefix = "stop") {
  return prefix + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}
function fmtKRW(n) {
  if (!n && n !== 0) return "";
  return "₩" + Math.round(n).toLocaleString("en-US");
}
function dayMeta(day) {
  return state.days.find(d => d.day === day) || { color: "#888", title: "Day " + day, date: "", weekday: "" };
}
function stopsForDay(day) {
  const ss = state.stops.filter(s => s.day === day);
  if (day === 0) {
    // Ideas tray: keep manual ordering
    return ss.sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  // Scheduled days: sort by time, fall back to slot rhythm, then order
  return ss.sort((a, b) => {
    const at = (a.time || "").trim();
    const bt = (b.time || "").trim();
    if (at && bt) return at.localeCompare(bt);
    if (at && !bt) return -1;
    if (!at && bt) return 1;
    const ar = SLOT_ORDER_RANK[a.slot] || 99;
    const br = SLOT_ORDER_RANK[b.slot] || 99;
    if (ar !== br) return ar - br;
    return (a.order || 0) - (b.order || 0);
  });
}
function haversineKm(a, b) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}
function walkMin(km) { return Math.round(km * 12); }
function stars(n) { return "★".repeat(n || 0); }

// Pull "CLOSED ..." / "WEEKENDS ONLY" / "OPEN DAILY" hints out of a blurb so the
// schedule pill on each card warns me before I drag a bar into the wrong night.
function parseSchedule(blurb) {
  if (!blurb) return null;
  const closed = blurb.match(/CLOSED\s+([^.,;]+)/i);
  if (closed) return { kind: "closed", label: "Closed " + closed[1].trim().replace(/\s+/g, " ") };
  if (/WEEKENDS\s+ONLY/i.test(blurb)) return { kind: "weekends", label: "Weekends only" };
  if (/OPEN\s+DAILY/i.test(blurb)) return { kind: "daily", label: "Open daily" };
  return null;
}

function lighten(hex, amount = 0.5) {
  const m = /^#?([a-f\d]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  let r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
  r = Math.round(r + (255 - r) * amount);
  g = Math.round(g + (255 - g) * amount);
  b = Math.round(b + (255 - b) * amount);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function toast(msg, ms = 2400) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }

// ----------- Map -----------
function setupMap() {
  if (mapInitialized) return;
  map = L.map("map", { zoomControl: true }).setView(state.meta.center, state.meta.zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  map.on("click", (e) => { if (dropPinMode) finishDropPin(e.latlng); });
  mapInitialized = true;
}

function makePinIcon(color, emoji, orderBadge) {
  const orderHtml = orderBadge ? `<span class="pin-order">${orderBadge}</span>` : "";
  return L.divIcon({
    className: "",
    html: `<div class="pin" style="--pin-color:${color};position:relative;">
             <span class="pin-emoji">${emoji}</span>
             ${orderHtml}
           </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28]
  });
}

function rebuildMarkers() {
  if (!map) return;
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  Object.values(dayLayers).forEach(g => map.removeLayer(g));
  dayLayers = {};
  Object.values(polylines).forEach(p => map.removeLayer(p));
  polylines = {};

  state.days.forEach(d => {
    dayLayers[d.day] = L.layerGroup();
    if (!hiddenDays.has(d.day)) dayLayers[d.day].addTo(map);
  });

  state.stops.forEach(s => {
    const meta = dayMeta(s.day);
    const emoji = TYPE_EMOJI[s.type] || TYPE_EMOJI.other;
    const orderBadge = s.day === 0 ? "" : String(s.order);
    const marker = L.marker([s.lat, s.lng], {
      icon: makePinIcon(meta.color, emoji, orderBadge),
      draggable: true,
      title: s.name
    });
    marker.on("click", () => { selectStop(s.id); });
    marker.on("dragend", (e) => {
      const ll = e.target.getLatLng();
      s.lat = ll.lat; s.lng = ll.lng;
      saveState();
      drawDayPolyline(s.day);
      toast(`Moved “${s.name}”`);
    });
    markers[s.id] = marker;
    marker.addTo(dayLayers[s.day]);
  });

  state.days.forEach(d => { if (d.day !== 0) drawDayPolyline(d.day); });
}

function drawDayPolyline(day) {
  if (!map) return;
  if (polylines[day]) { map.removeLayer(polylines[day]); delete polylines[day]; }
  if (hiddenDays.has(day) || day === 0) return;
  const pts = stopsForDay(day).map(s => [s.lat, s.lng]);
  if (pts.length < 2) return;
  const color = dayMeta(day).color;
  polylines[day] = L.polyline(pts, { color, weight: 3, opacity: 0.55, dashArray: "6 8" }).addTo(map);
}

function fitTo(stops) {
  if (!map || !stops || !stops.length) return;
  const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
}

// ----------- Legend -----------
function renderLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  state.days.forEach(d => {
    const id = "lg-" + d.day;
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" id="${id}" ${hiddenDays.has(d.day) ? "" : "checked"} />
      <span class="swatch" style="background:${d.color}"></span>
      <span>${d.day === 0 ? "Ideas" : "Day " + d.day}</span>
    `;
    label.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) hiddenDays.delete(d.day); else hiddenDays.add(d.day);
      applyDayVisibility(d.day);
    });
    el.appendChild(label);
  });
}

function applyDayVisibility(day) {
  if (hiddenDays.has(day)) {
    if (dayLayers[day]) map.removeLayer(dayLayers[day]);
    if (polylines[day]) { map.removeLayer(polylines[day]); delete polylines[day]; }
    document.querySelectorAll(`.day-group[data-day="${day}"]`).forEach(el => el.classList.add("collapsed"));
  } else {
    if (dayLayers[day]) dayLayers[day].addTo(map);
    drawDayPolyline(day);
    document.querySelectorAll(`.day-group[data-day="${day}"]`).forEach(el => el.classList.remove("collapsed"));
  }
}

// ----------- Card grid -----------
function renderDayList() {
  const root = document.getElementById("day-list");
  root.innerHTML = "";
  state.days.forEach(d => {
    const group = buildDayGroup(d);
    root.appendChild(group);
  });
}

function buildDayGroup(d) {
  const group = document.createElement("section");
  group.className = "day-group";
  group.dataset.day = d.day;
  group.style.setProperty("--day-color", d.color);
  if (hiddenDays.has(d.day)) group.classList.add("collapsed");

  const stops = stopsForDay(d.day);
  const subtotal = stops.reduce((sum, s) => sum + (Number(s.cost_krw) || 0), 0);

  const head = document.createElement("div");
  head.className = "day-head";
  head.innerHTML = `
    <div class="day-number">${d.day === 0 ? "💡" : d.day}</div>
    <div style="flex:1;min-width:0;">
      <div class="day-title">${escapeHtml(d.title)}</div>
      <div class="day-sub">${d.date ? d.weekday + " · " + d.date : "Unscheduled tray"} · ${stops.length} stop${stops.length === 1 ? "" : "s"}</div>
    </div>
    <div class="day-cost">${subtotal ? fmtKRW(subtotal) : ""}</div>
  `;
  head.addEventListener("click", () => {
    if (hiddenDays.has(d.day)) hiddenDays.delete(d.day); else hiddenDays.add(d.day);
    applyDayVisibility(d.day);
    const cb = document.getElementById("lg-" + d.day);
    if (cb) cb.checked = !hiddenDays.has(d.day);
  });
  group.appendChild(head);

  // Day 0 is special: Michelin first, then per-type subsections.
  if (d.day === 0) {
    const michelin = stops.filter(s => s.michelin)
      .sort((a, b) => (b.michelin || 0) - (a.michelin || 0));

    if (michelin.length) {
      const sh = document.createElement("div");
      sh.className = "subsection-head";
      sh.textContent = "⭐ Michelin stars — Mingles backups";
      group.appendChild(sh);
      group.appendChild(buildStopList(d, michelin, "michelin"));
    }

    // Bucket non-Michelin by type, then render each type as its own subsection
    // in IDEAS_TYPE_ORDER. Anything with an unknown type falls into "other".
    const byType = {};
    for (const s of stops) {
      if (s.michelin) continue;
      const t = TYPE_EMOJI[s.type] ? s.type : "other";
      (byType[t] = byType[t] || []).push(s);
    }
    const typesPresent = IDEAS_TYPE_ORDER.filter(t => byType[t] && byType[t].length);
    // Append any types not in IDEAS_TYPE_ORDER at the end (defensive)
    Object.keys(byType).forEach(t => { if (!typesPresent.includes(t)) typesPresent.push(t); });

    typesPresent.forEach(t => {
      const sh = document.createElement("div");
      sh.className = "subsection-head";
      sh.textContent = `${TYPE_EMOJI[t] || "📍"} ${TYPE_LABEL[t] || t}`;
      group.appendChild(sh);
      group.appendChild(buildStopList(d, byType[t], "type-" + t));
    });
  } else {
    group.appendChild(buildStopList(d, stops, "scheduled"));
  }

  // Day notes
  // Missing-slot hints — Days 1–4 only (Day 5 exempt; departure day)
  if (d.day >= 1 && d.day <= 4) {
    const haveSlots = new Set(stopsForDay(d.day).map(s => s.slot).filter(Boolean));
    const missing = CORE_SLOTS.filter(slot => !haveSlots.has(slot));
    if (missing.length) {
      const hints = document.createElement("div");
      hints.className = "slot-hints";
      hints.innerHTML = missing.map(slot =>
        `<button class="slot-hint" data-add-slot="${slot}" data-day="${d.day}">➕ Add ${SLOT_LABEL[slot]}</button>`
      ).join("");
      hints.addEventListener("click", (e) => {
        const btn = e.target.closest(".slot-hint");
        if (!btn) return;
        addStopForSlot(parseInt(btn.dataset.day, 10), btn.dataset.addSlot);
      });
      group.appendChild(hints);
    }
  }

  const noteVal = (state.dayNotes && state.dayNotes[d.day]) || "";
  const foot = document.createElement("div");
  foot.className = "day-foot";
  foot.innerHTML = `
    <textarea placeholder="Notes for ${d.day === 0 ? "ideas" : "day " + d.day}…">${escapeHtml(noteVal)}</textarea>
  `;
  foot.querySelector("textarea").addEventListener("input", (e) => {
    state.dayNotes[d.day] = e.target.value; saveState();
  });
  group.appendChild(foot);

  return group;
}

// Open the Add form pre-filled for a day + slot
function addStopForSlot(day, slot) {
  const defaultTimes = { breakfast: "09:00", lunch: "12:30", dinner: "19:00", bar: "22:00" };
  const defaultTypes = { breakfast: "cafe", lunch: "noodles", dinner: "bbq", bar: "bar" };
  const draft = {
    id: uid(), day, order: 999, slot,
    time: defaultTimes[slot] || "",
    type: defaultTypes[slot] || "other",
    name: "", name_ko: "", area: "",
    lat: state.meta.center[0], lng: state.meta.center[1],
    cost_krw: 0, blurb: "", reservation_status: "unlikely"
  };
  openEditForm(null, { isNew: true, stop: draft });
}

function buildStopList(d, stops, subkind) {
  const ul = document.createElement("ul");
  ul.className = "stop-list";
  ul.dataset.day = d.day;
  ul.dataset.subkind = subkind;
  if (!stops.length) {
    ul.classList.add("empty-tray");
    ul.innerHTML = `<div>Drag a stop here, or use + Add place.</div>`;
    return ul;
  }
  stops.forEach((s, idx) => {
    ul.appendChild(buildStopCard(s, d, idx, stops));
  });
  if (window.Sortable) {
    new Sortable(ul, {
      group: "stops",
      animation: 160,
      delay: 140,
      delayOnTouchOnly: true,
      touchStartThreshold: 6,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      filter: ".unavailable",
      preventOnFilter: false,
      // Auto-scroll the panel when dragging near its top/bottom edges.
      // SortableJS expects an Element, true (auto-detect parent), or false —
      // a function isn't supported, so pass the panel element directly.
      scroll: document.getElementById("panel-stops") || true,
      forceAutoScrollFallback: true,   // use Sortable's own RAF loop (more reliable than browser auto-scroll)
      scrollSensitivity: 120,           // pixels from edge before scroll kicks in
      scrollSpeed: 22,                  // pixels per frame
      bubbleScroll: true,
      onMove: (evt) => !evt.dragged.classList.contains("unavailable"),
      onEnd: handleSortEnd
    });
  }
  return ul;
}

function buildStopCard(s, d, idx, stopsInDay) {
  const li = document.createElement("li");
  li.className = "stop-card";
  li.dataset.id = s.id;
  if (s.id === selectedStopId) li.classList.add("active");
  if (s.done) li.classList.add("done");
  if (s.unavailable) li.classList.add("unavailable");

  // Color seeds for gradient fallback (in case image_url fails)
  li.style.setProperty("--card-color", d.color);
  li.style.setProperty("--card-color-dark", lighten(d.color, -0.2) || d.color);

  const emoji = TYPE_EMOJI[s.type] || TYPE_EMOJI.other;
  const dayLabel = d.day === 0 ? "💡 Idea" : `Day ${d.day}`;
  const orderBadge = d.day === 0 ? "" : `<span class="order-num" style="color:${d.color}">${s.order}</span>`;
  const starPill = s.michelin
    ? `<span class="stars-pill">${stars(s.michelin)} Michelin</span>`
    : "";
  const resStatus = s.reservation_status || "none";
  const resInfo = RES_STATUS[resStatus];
  const resPill = resStatus !== "none"
    ? `<span class="res-pill ${resStatus}">${resInfo.emoji} ${resInfo.short}</span>`
    : "";

  // Hero with image + fallback
  const heroImg = s.image_url
    ? `<img src="${escapeAttr(s.image_url)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" referrerpolicy="no-referrer" />
       <div class="hero-emoji" style="display:none;background:linear-gradient(135deg, ${d.color}, ${lighten(d.color, -0.25) || d.color});">${emoji}</div>`
    : `<div class="hero-emoji" style="background:linear-gradient(135deg, ${d.color}, ${lighten(d.color, -0.25) || d.color});">${emoji}</div>`;

  // Reservation button on the card
  let bookBtn = "";
  if (s.reservation_url) {
    const isBooked = resStatus === "booked";
    bookBtn = `<a href="${escapeAttr(s.reservation_url)}" target="_blank" rel="noopener" class="book-btn ${isBooked ? "booked" : ""}" data-no-open="1">
                 ${isBooked ? "✅ Booked" : "🔗 Book"}
               </a>`;
  }

  // Distance to next stop in same day (scheduled only)
  let distMeta = "";
  if (d.day !== 0 && stopsInDay[idx + 1]) {
    const nextStop = stopsInDay[idx + 1];
    const km = haversineKm(s, nextStop);
    const min = walkMin(km);
    distMeta = `<span class="dot">·</span><span>→ ${km.toFixed(1)} km / ${min} min</span>`;
  }

  const slotLabel = s.slot ? SLOT_LABEL[s.slot] : null;
  const slotPill = slotLabel
    ? `<span class="slot-pill slot-${s.slot}">${slotLabel}</span>`
    : "";

  // Day-pill text differs slightly: order badge only on scheduled days
  const dayPillHtml = `<span class="day-pill" style="background:${d.color};color:white;">${orderBadge ? orderBadge + " " : ""}${dayLabel}</span>`;

  li.innerHTML = `
    <div class="card-hero" style="--day-color:${d.color}">
      ${heroImg}
    </div>
    <div class="card-body">
      <div class="card-header">
        ${dayPillHtml}
        ${slotPill}
        ${starPill || resPill}
      </div>
      <div class="card-name">
        <span style="font-size:18px;">${emoji}</span>
        <span>${escapeHtml(s.name)}</span>
      </div>
      ${s.name_ko ? `<div class="card-name-ko">${escapeHtml(s.name_ko)}</div>` : ""}
      <div class="card-meta">
        <label class="time-chip ${s.time ? "" : "empty"}" data-no-open="1" title="Click to set time">
          <span class="time-icon">⏰</span>
          <input type="time" data-no-open="1" value="${escapeAttr(s.time || "")}" />
          ${s.time ? "" : `<span class="time-placeholder">Set time</span>`}
        </label>
        ${s.area ? `<span>📍 ${escapeHtml(s.area)}</span>` : ""}
        ${s.cost_krw ? `<span class="card-cost">${fmtKRW(s.cost_krw)}</span>` : ""}
        ${(() => {
          const sched = parseSchedule(s.blurb);
          if (!sched) return "";
          const icon = sched.kind === "closed" ? "⚠️" : sched.kind === "weekends" ? "📅" : "🕒";
          return `<span class="sched-pill sched-${sched.kind}">${icon} ${escapeHtml(sched.label)}</span>`;
        })()}
        ${distMeta}
      </div>
      ${s.blurb ? `<div class="card-blurb">${escapeHtml(s.blurb)}</div>` : ""}
      <div class="card-actions">
        ${bookBtn}
        ${s.name_ko ? `<button class="copy-ko-btn" data-no-open="1" title="Copy Korean name — handy for taxi drivers">📋 Copy Korean</button>` : ""}
        <button class="edit-btn" data-no-open="1" title="Edit" aria-label="Edit">✏️</button>
      </div>
    </div>
  `;

  // Wire up inline time editing on the card
  const timeInput = li.querySelector(".time-chip input[type=time]");
  if (timeInput) {
    timeInput.addEventListener("change", (e) => {
      s.time = e.target.value;
      saveState();
      // Re-render just this row's chip so the placeholder/value flip applies
      const chip = li.querySelector(".time-chip");
      if (chip) {
        chip.classList.toggle("empty", !s.time);
        const ph = chip.querySelector(".time-placeholder");
        if (s.time && ph) ph.remove();
        else if (!s.time && !ph) {
          const span = document.createElement("span");
          span.className = "time-placeholder";
          span.textContent = "Set time";
          chip.appendChild(span);
        }
      }
      toast(s.time ? `Time set to ${s.time}` : "Time cleared");
    });
    // Prevent click-to-open-detail when clicking the input
    timeInput.addEventListener("click", (e) => e.stopPropagation());
  }

  li.addEventListener("click", (e) => {
    const target = e.target.closest("[data-no-open]");
    if (target) {
      e.stopPropagation();
      if (target.classList.contains("edit-btn")) {
        openEditForm(s.id);
      } else if (target.classList.contains("copy-ko-btn")) {
        copyKorean(s);
      }
      // book-btn is an <a>, its default click navigates — let it through.
      // time-chip handles its own change event; let it bubble normally.
      return;
    }
    selectStop(s.id);
  });
  return li;
}

function copyKorean(s) {
  const text = s.name_ko || s.name;
  navigator.clipboard.writeText(text).then(
    () => toast("Copied: " + text),
    () => toast("Couldn't copy.")
  );
}

function handleSortEnd(evt) {
  const id = evt.item.dataset.id;
  const fromDay = parseInt(evt.from.dataset.day, 10);
  const toDay = parseInt(evt.to.dataset.day, 10);
  const stop = state.stops.find(s => s.id === id);
  if (!stop) return;
  stop.day = toDay;
  // Recompute orders for both lists. For day 0 we just re-pack from state since
  // ordering across the two sublists isn't meaningful.
  if (toDay === 0) reorderDayInState(0);
  else reorderFromDom(toDay);
  if (fromDay !== toDay) {
    if (fromDay === 0) reorderDayInState(0);
    else reorderFromDom(fromDay);
  }
  saveState();
  renderAll();
}

function reorderFromDom(day) {
  const list = document.querySelector(`.stop-list[data-day="${day}"]`);
  if (!list) return;
  const ids = [...list.querySelectorAll(".stop-card")].map(li => li.dataset.id).filter(Boolean);
  ids.forEach((id, idx) => {
    const s = state.stops.find(x => x.id === id);
    if (s) s.order = idx + 1;
  });
}

function reorderDayInState(day) {
  const ss = state.stops.filter(s => s.day === day).sort((a, b) => a.order - b.order);
  ss.forEach((s, i) => s.order = i + 1);
}

// ----------- Totals -----------
function renderTotals() {
  const total = state.stops
    .filter(s => s.day !== 0)
    .reduce((sum, s) => sum + (Number(s.cost_krw) || 0), 0);
  const ideasTotal = state.stops
    .filter(s => s.day === 0)
    .reduce((sum, s) => sum + (Number(s.cost_krw) || 0), 0);
  const needBooking = state.stops.filter(s => s.reservation_status === "needed" && !s.unavailable).length;
  const booked = state.stops.filter(s => s.reservation_status === "booked").length;
  const visited = state.stops.filter(s => s.done).length;
  const el = document.getElementById("totals");
  el.innerHTML = `
    <div>
      ${needBooking ? `<div style="font-size:12px;color:var(--persimmon);">⚠️ ${needBooking} still need${needBooking === 1 ? "s" : ""} booking</div>` : ""}
      ${booked ? `<div style="font-size:12px;color:var(--jade);margin-top:2px;">✅ ${booked} booked</div>` : ""}
      ${visited ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">🍽 ${visited} visited</div>` : ""}
    </div>
    <div style="text-align:right;font-size:11px;color:var(--ink-soft);">
      <div>${state.stops.filter(s=>s.day!==0).length} scheduled · ${state.stops.filter(s=>s.day===0).length} ideas</div>
      <div style="margin-top:2px;">Ideas pool: ${fmtKRW(ideasTotal)}</div>
    </div>
  `;
}

// ----------- Render all -----------
function renderAll() {
  renderLegend();
  renderDayList();
  renderTotals();
  rebuildMarkers();
  renderForAshleyCard();
  document.getElementById("title").innerHTML = state.meta.title.replace(/&/g, '<span class="amp">&amp;</span>');
  document.getElementById("subtitle").textContent = state.meta.subtitle;
  document.getElementById("trip-notes").value = state.tripNotes || "";
}

function renderForAshleyCard() {
  const el = document.getElementById("for-ashley-card");
  if (!el) return;
  const name = state.meta.recipient || "you";
  const note = state.meta.trip_note || "";
  el.innerHTML = `
    <h2>For ${escapeHtml(name)} 💛</h2>
    <textarea id="ashley-note" placeholder="Write something nice…">${escapeHtml(note)}</textarea>
    <div class="edit-hint">Tap to edit — saved automatically.</div>
  `;
  el.querySelector("#ashley-note").addEventListener("input", (e) => {
    state.meta.trip_note = e.target.value;
    saveState();
  });
}

// ----------- Select / detail -----------
function selectStop(id) {
  selectedStopId = id;
  document.querySelectorAll(".stop-card").forEach(c => c.classList.toggle("active", c.dataset.id === id));
  const s = state.stops.find(x => x.id === id);
  if (!s) return;
  // Make sure its day is visible
  if (hiddenDays.has(s.day)) {
    hiddenDays.delete(s.day);
    applyDayVisibility(s.day);
    const cb = document.getElementById("lg-" + s.day);
    if (cb) cb.checked = true;
  }
  openDetailSheet(id);
}

function openDetailSheet(id) {
  const s = state.stops.find(x => x.id === id);
  if (!s) return;
  const meta = dayMeta(s.day);
  const naverUrl = "https://map.naver.com/p/search/" + encodeURIComponent(s.name_ko || s.name);
  const kakaoUrl = "https://map.kakao.com/?q=" + encodeURIComponent(s.name_ko || s.name);
  const googleUrl = s.place_id
    ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s.name) + "&query_place_id=" + s.place_id
    : "https://www.google.com/maps/search/?api=1&query=" + s.lat + "," + s.lng;
  const directionsUrl = "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lng + "&travelmode=transit";

  const emoji = TYPE_EMOJI[s.type] || TYPE_EMOJI.other;
  const resStatus = s.reservation_status || "none";
  const resInfo = RES_STATUS[resStatus];

  const heroBg = `linear-gradient(135deg, ${meta.color}, ${lighten(meta.color, -0.25) || meta.color})`;
  const heroImg = s.image_url
    ? `<img src="${escapeAttr(s.image_url)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" referrerpolicy="no-referrer" /><div class="hero-emoji-big" style="display:none;background:${heroBg};">${emoji}</div>`
    : `<div class="hero-emoji-big" style="background:${heroBg};">${emoji}</div>`;

  const sheet = document.getElementById("sheet-content");

  const resBlock = `
    <div class="detail-reservation ${resStatus}">
      <div class="res-label">
        <strong>${resInfo.emoji} ${escapeHtml(resInfo.label)}</strong>
        ${s.unavailable ? `<div style="font-size:12px;color:var(--persimmon);margin-top:2px;">Currently booked — pick a backup below.</div>` : ""}
      </div>
      ${s.reservation_url ? `<a href="${escapeAttr(s.reservation_url)}" target="_blank" rel="noopener" class="book-link">${resStatus === "booked" ? "✅ Booked" : "🔗 Book now"}</a>` : ""}
      <button id="res-toggle">${resStatus === "none" ? "Mark needed" : (resStatus === "needed" ? "Mark booked" : "Undo booked")}</button>
    </div>
  `;

  const starsLine = s.michelin
    ? `<div style="color:var(--gold);font-weight:600;font-size:14px;margin-top:4px;">${stars(s.michelin)} Michelin Guide ${s.michelin === 1 ? "(1 star)" : `(${s.michelin} stars)`}</div>`
    : "";

  sheet.innerHTML = `
    <div class="detail-hero">${heroImg}</div>
    <div class="detail-head">
      <div style="flex:1;min-width:0;">
        <div class="detail-name">${escapeHtml(s.name)}</div>
        ${s.name_ko ? `<div class="detail-name-ko">${escapeHtml(s.name_ko)}</div>` : ""}
        ${starsLine}
        <div class="detail-meta">
          ${s.day === 0 ? "💡 Idea" : `Day ${s.day} · ${meta.weekday} ${meta.date}`}
          ${s.time ? ` · ${s.time}` : ""}
          ${s.area ? ` · ${escapeHtml(s.area)}` : ""}
          ${s.cost_krw ? ` · ${fmtKRW(s.cost_krw)}` : ""}
          ${s.hours ? ` · 🕒 ${escapeHtml(s.hours)}` : ""}
        </div>
      </div>
      <button class="iconbtn" id="sheet-close" aria-label="Close">✕</button>
    </div>

    ${resBlock}

    ${s.blurb ? `<div class="detail-blurb">${escapeHtml(s.blurb)}</div>` : ""}

    <div class="detail-quicklinks">
      <a href="${naverUrl}" target="_blank" rel="noopener" class="primary">🗺 Naver Map</a>
      <a href="${kakaoUrl}" target="_blank" rel="noopener">KakaoMap</a>
      <a href="${googleUrl}" target="_blank" rel="noopener">Google</a>
      <a href="${directionsUrl}" target="_blank" rel="noopener">🚇 Directions</a>
      <button id="copy-ko">📋 Copy Korean name</button>
    </div>

    <div class="detail-stop-notes">
      <textarea id="stop-notes" placeholder="Stop notes (what to order, hours, who to ask for)…">${escapeHtml(s.notes || "")}</textarea>
    </div>

    <div class="detail-actions">
      <button id="btn-done" class="${s.done ? "primary" : ""}">${s.done ? "✅ Visited" : "Mark visited"}</button>
      <button id="btn-edit" class="primary">✏️ Edit</button>
      <button id="btn-delete" class="danger">🗑 Delete</button>
    </div>
  `;

  sheet.querySelector("#sheet-close").addEventListener("click", closeSheet);
  sheet.querySelector("#copy-ko").addEventListener("click", () => copyKorean(s));
  sheet.querySelector("#stop-notes").addEventListener("input", (e) => { s.notes = e.target.value; saveState(); });
  sheet.querySelector("#res-toggle").addEventListener("click", () => {
    const cur = s.reservation_status || "none";
    const next = cur === "none" ? "needed" : (cur === "needed" ? "booked" : "none");
    s.reservation_status = next;
    saveState();
    renderDayList();
    openDetailSheet(id);
    toast("Status: " + RES_STATUS[next].label);
  });
  sheet.querySelector("#btn-done").addEventListener("click", () => {
    s.done = !s.done; saveState(); renderDayList(); renderTotals(); openDetailSheet(id);
  });
  sheet.querySelector("#btn-edit").addEventListener("click", () => openEditForm(id));
  sheet.querySelector("#btn-delete").addEventListener("click", () => {
    if (!confirm(`Delete “${s.name}”?`)) return;
    state.stops = state.stops.filter(x => x.id !== id);
    selectedStopId = null;
    saveState(); renderAll(); closeSheet();
    toast("Deleted.");
  });

  showSheet();
}

// ----------- Edit form -----------
function openEditForm(id, options = {}) {
  const isNew = options.isNew === true;
  const s = isNew ? options.stop : state.stops.find(x => x.id === id);
  if (!s) return;

  const dayOpts = state.days
    .slice().sort((a, b) => a.day - b.day)
    .map(d => `<option value="${d.day}" ${d.day === s.day ? "selected" : ""}>${d.day === 0 ? "Ideas (unscheduled)" : "Day " + d.day + " — " + d.title}</option>`)
    .join("");
  const typeOpts = TYPE_OPTIONS.map(t => `<option value="${t}" ${t === s.type ? "selected" : ""}>${TYPE_EMOJI[t]} ${t}</option>`).join("");
  const resOpts = RES_OPTIONS.map(k => `<option value="${k}" ${(s.reservation_status || "none") === k ? "selected" : ""}>${RES_STATUS[k].emoji} ${RES_STATUS[k].label}</option>`).join("");
  const slotOpts = `<option value="">— none —</option>` + SLOT_OPTIONS.map(k => `<option value="${k}" ${s.slot === k ? "selected" : ""}>${SLOT_LABEL[k]}</option>`).join("");

  const sheet = document.getElementById("sheet-content");
  sheet.innerHTML = `
    <h3 style="font-family:'Fraunces',serif;font-size:22px;font-weight:500;margin-bottom:14px;">${isNew ? "Add a stop" : "Edit stop"}</h3>
    <div class="form-row">
      <label>Name</label>
      <input id="f-name" type="text" value="${escapeAttr(s.name || "")}" />
    </div>
    <div class="form-row">
      <label>Korean name</label>
      <input id="f-name-ko" type="text" value="${escapeAttr(s.name_ko || "")}" placeholder="for Naver / Kakao / taxi" />
    </div>
    <div class="form-grid2">
      <div class="form-row">
        <label>Day</label>
        <select id="f-day">${dayOpts}</select>
      </div>
      <div class="form-row">
        <label>Type</label>
        <select id="f-type">${typeOpts}</select>
      </div>
    </div>
    <div class="form-grid2">
      <div class="form-row">
        <label>Time</label>
        <input id="f-time" type="text" placeholder="19:00" value="${escapeAttr(s.time || "")}" />
      </div>
      <div class="form-row">
        <label>Cost (₩)</label>
        <input id="f-cost" type="number" min="0" step="500" value="${s.cost_krw ?? ""}" />
      </div>
    </div>
    <div class="form-row">
      <label>Slot (Breakfast / Lunch / Dinner / Bar …)</label>
      <select id="f-slot">${slotOpts}</select>
    </div>
    <div class="form-row">
      <label>Area / neighborhood</label>
      <input id="f-area" type="text" value="${escapeAttr(s.area || "")}" />
    </div>
    <div class="form-row">
      <label>Photo URL (paste any image link)</label>
      <input id="f-image" type="url" value="${escapeAttr(s.image_url || "")}" placeholder="https://..." />
    </div>
    <div class="form-row">
      <label>Hours (optional)</label>
      <input id="f-hours" type="text" value="${escapeAttr(s.hours || "")}" placeholder="e.g. 11:00–22:00, closed Sun" />
    </div>
    <div class="form-grid2">
      <div class="form-row">
        <label>Reservation status</label>
        <select id="f-res-status">${resOpts}</select>
      </div>
      <div class="form-row">
        <label>Reservation URL</label>
        <input id="f-res-url" type="url" placeholder="https://catchtable.co.kr/..." value="${escapeAttr(s.reservation_url || "")}" />
      </div>
    </div>
    <div class="form-grid2">
      <div class="form-row">
        <label>Michelin stars (0–3)</label>
        <input id="f-michelin" type="number" min="0" max="3" step="1" value="${s.michelin || 0}" />
      </div>
      <div class="form-row">
        <label>Currently unavailable?</label>
        <select id="f-unavailable">
          <option value="false" ${!s.unavailable ? "selected" : ""}>No, bookable</option>
          <option value="true" ${s.unavailable ? "selected" : ""}>Yes, marked unavailable</option>
        </select>
      </div>
    </div>
    <div class="form-grid2">
      <div class="form-row">
        <label>Latitude</label>
        <input id="f-lat" type="number" step="any" value="${s.lat ?? ""}" />
      </div>
      <div class="form-row">
        <label>Longitude</label>
        <input id="f-lng" type="number" step="any" value="${s.lng ?? ""}" />
      </div>
    </div>
    <div class="form-row">
      <label>Blurb / notes</label>
      <textarea id="f-blurb">${escapeHtml(s.blurb || "")}</textarea>
    </div>
    <div class="form-actions">
      <button id="f-cancel">Cancel</button>
      <button id="f-save" class="primary">${isNew ? "Add" : "Save"}</button>
    </div>
  `;

  sheet.querySelector("#f-cancel").addEventListener("click", () => {
    if (isNew) closeSheet();
    else openDetailSheet(id);
  });
  sheet.querySelector("#f-save").addEventListener("click", () => {
    const michelin = parseInt(sheet.querySelector("#f-michelin").value, 10) || 0;
    const updated = {
      ...s,
      name: sheet.querySelector("#f-name").value.trim() || "Untitled",
      name_ko: sheet.querySelector("#f-name-ko").value.trim(),
      day: parseInt(sheet.querySelector("#f-day").value, 10),
      type: sheet.querySelector("#f-type").value,
      time: sheet.querySelector("#f-time").value.trim(),
      cost_krw: parseInt(sheet.querySelector("#f-cost").value, 10) || 0,
      slot: sheet.querySelector("#f-slot").value || undefined,
      area: sheet.querySelector("#f-area").value.trim(),
      image_url: sheet.querySelector("#f-image").value.trim(),
      hours: sheet.querySelector("#f-hours").value.trim(),
      reservation_status: sheet.querySelector("#f-res-status").value,
      reservation_url: sheet.querySelector("#f-res-url").value.trim(),
      michelin: michelin || undefined,
      unavailable: sheet.querySelector("#f-unavailable").value === "true",
      lat: parseFloat(sheet.querySelector("#f-lat").value),
      lng: parseFloat(sheet.querySelector("#f-lng").value),
      blurb: sheet.querySelector("#f-blurb").value.trim()
    };
    if (Number.isNaN(updated.lat) || Number.isNaN(updated.lng)) {
      toast("Lat/Lng must be numbers."); return;
    }
    if (isNew) {
      updated.id = uid();
      updated.order = (stopsForDay(updated.day).length || 0) + 1;
      state.stops.push(updated);
    } else {
      const idx = state.stops.findIndex(x => x.id === s.id);
      if (idx !== -1) {
        if (state.stops[idx].day !== updated.day) {
          updated.order = (stopsForDay(updated.day).length || 0) + 1;
        }
        state.stops[idx] = updated;
        reorderDayInState(s.day);
      }
    }
    reorderDayInState(updated.day);
    saveState();
    renderAll();
    selectStop(updated.id);
  });

  showSheet();
}

function showSheet() {
  document.getElementById("sheet").classList.remove("hidden");
  document.getElementById("sheet-backdrop").classList.remove("hidden");
}
function closeSheet() {
  document.getElementById("sheet").classList.add("hidden");
  document.getElementById("sheet-backdrop").classList.add("hidden");
}

// ----------- Drop pin -----------
function startDropPin() {
  dropPinMode = true;
  switchTab("map");
  document.getElementById("droppin-banner").classList.remove("hidden");
  document.getElementById("map").style.cursor = "crosshair";
}
function cancelDropPin() {
  dropPinMode = false;
  document.getElementById("droppin-banner").classList.add("hidden");
  document.getElementById("map").style.cursor = "";
}
function finishDropPin(latlng) {
  cancelDropPin();
  const defaultDay = selectedStopId
    ? (state.stops.find(s => s.id === selectedStopId)?.day ?? 0)
    : 0;
  const draft = {
    id: uid(), day: defaultDay, order: 999, time: "", type: "other",
    name: "New stop", name_ko: "", area: "", lat: latlng.lat, lng: latlng.lng,
    cost_krw: 0, blurb: ""
  };
  switchTab("stops");
  openEditForm(null, { isNew: true, stop: draft });
}

// ----------- Search (Nominatim) -----------
let lastSearchAt = 0;
function setupSearch() {
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");

  input.addEventListener("input", () => {
    const q = input.value.trim();
    results.innerHTML = "";
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length < 3) return;
    searchTimer = setTimeout(() => doSearch(q), 1100);
  });

  function doSearch(q) {
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - lastSearchAt));
    setTimeout(() => {
      lastSearchAt = Date.now();
      const url = "https://nominatim.openstreetmap.org/search?format=json&accept-language=en&limit=5&q=" + encodeURIComponent(q + ", Seoul");
      fetch(url, { headers: { "Accept": "application/json" } })
        .then(r => r.json())
        .then(items => {
          results.innerHTML = "";
          if (!items.length) {
            const li = document.createElement("li");
            li.textContent = "No results. Try “📍 Drop pin” on the map.";
            li.style.color = "var(--ink-faint)";
            results.appendChild(li);
            return;
          }
          items.forEach(it => {
            const li = document.createElement("li");
            li.textContent = it.display_name;
            li.addEventListener("click", () => {
              results.innerHTML = "";
              input.value = "";
              document.getElementById("searchrow").classList.add("hidden");
              const draft = {
                id: uid(), day: 0, order: 999, time: "", type: "other",
                name: it.display_name.split(",")[0].trim(),
                name_ko: "", area: (it.display_name.split(",")[1] || "").trim(),
                lat: parseFloat(it.lat), lng: parseFloat(it.lon),
                cost_krw: 0, blurb: ""
              };
              openEditForm(null, { isNew: true, stop: draft });
            });
            results.appendChild(li);
          });
        })
        .catch(err => {
          console.warn("Nominatim failed:", err);
          toast("Search failed. Drop a pin instead.");
        });
    }, wait);
  }
}

// ----------- Export / Import / Reset -----------
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "justin-ashley-seoul-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  toast("Exported JSON.");
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || !Array.isArray(parsed.stops) || !Array.isArray(parsed.days)) {
        throw new Error("Invalid shape");
      }
      if (!confirm("Replace current itinerary with the imported one?")) return;
      state = migrateState({
        version: parsed.version || 1,
        meta: parsed.meta || state.meta,
        days: parsed.days,
        stops: parsed.stops,
        tripNotes: parsed.tripNotes || "",
        dayNotes: parsed.dayNotes || {}
      });
      saveState(); renderAll();
      toast("Imported.");
    } catch (err) {
      console.error(err);
      alert("Couldn't import — file doesn't look like a valid backup.");
    }
  };
  reader.readAsText(file);
}

function resetToDefault() {
  if (!confirm("Reset to the seed plan? Your edits in this browser will be lost.")) return;
  state = freshState();
  hiddenDays.clear();
  saveState(); renderAll();
  toast("Reset to seed plan.");
}

// ----------- Dark mode -----------
function setDark(on) {
  document.body.classList.toggle("dark", on);
  try { localStorage.setItem(DARK_KEY, on ? "1" : "0"); } catch (e) {}
  document.getElementById("btn-darkmode").textContent = on ? "☀️" : "🌙";
}

// ----------- Tabs -----------
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach(t => {
    const isActive = t.id === "tab-" + tab;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive);
  });
  document.querySelectorAll(".panel").forEach(p => {
    p.classList.toggle("hidden", p.id !== "panel-" + tab);
  });
  if (tab === "map") {
    setupMap();
    rebuildMarkers();
    setTimeout(() => map && map.invalidateSize(), 80);
  } else if (tab === "calendar") {
    renderCalendar();
  }
}

// ----------- Migration banner -----------
function showMigrationBanner() {
  if (!migrationSnapshot) return;
  const { addedIds, addedMichelinIds, addedByType, patchedIds, noteSeeded, layoutDrift } = migrationSnapshot;
  const banner = document.getElementById("migration-banner");
  const text = document.getElementById("migration-text");

  // Build categorised "added" phrase
  const chunks = [];
  if (addedMichelinIds && addedMichelinIds.length) {
    chunks.push(`${addedMichelinIds.length} Michelin backup${addedMichelinIds.length === 1 ? "" : "s"}`);
  }
  if (addedByType) {
    const labelMap = { streetfood: "street food pick", bar: "night bar", bbq: "BBQ", cafe: "café", noodles: "noodle spot", soup: "soup spot", market: "market", seafood: "seafood", dessert: "dessert", park: "park", splurge: "splurge", other: "stop" };
    const namedTypes = ["bar", "streetfood", "cafe", "soup", "noodles"];
    let otherCount = 0;
    namedTypes.forEach(t => {
      if (addedByType[t]) chunks.push(`${addedByType[t]} ${labelMap[t]}${addedByType[t] === 1 ? "" : "s"}`);
    });
    Object.keys(addedByType).forEach(t => {
      if (!namedTypes.includes(t)) otherCount += addedByType[t];
    });
    if (otherCount > 0) chunks.push(`${otherCount} other stop${otherCount === 1 ? "" : "s"}`);
  }
  if (noteSeeded) chunks.push("a 💛 note");

  // Special case: exactly one new non-Michelin stop and nothing else — call it by name.
  if (addedIds.length === 1 && (!addedMichelinIds || addedMichelinIds.length === 0) && !noteSeeded && !patchedIds.length && (!layoutDrift || !layoutDrift.length)) {
    const stop = state.stops.find(s => s.id === addedIds[0]);
    const name = stop ? stop.name : "a new stop";
    text.innerHTML = `✨ Added <strong>${escapeHtml(name)}</strong> to your Ideas tray.`;
    showBannerWithButtons(false);
    return;
  }

  const parts = [];
  if (chunks.length) {
    const joined = chunks.length === 1 ? chunks[0] : chunks.slice(0, -1).join(", ") + " and " + chunks[chunks.length - 1];
    parts.push("added " + joined);
  }
  if (patchedIds.length) parts.push(`updated ${patchedIds.length} stop${patchedIds.length === 1 ? "" : "s"} with new info`);
  if (layoutDrift && layoutDrift.length) {
    parts.push(`a new Breakfast/Lunch/Dinner/Bar layout is available for ${layoutDrift.length} stop${layoutDrift.length === 1 ? "" : "s"}`);
  }
  text.textContent = "✨ " + parts.join(", and ") + ".";
  showBannerWithButtons(layoutDrift && layoutDrift.length > 0);
}

function showBannerWithButtons(showApplyLayout) {
  const banner = document.getElementById("migration-banner");
  banner.classList.remove("hidden");
  // Build buttons fresh each time
  const undoBtn = document.getElementById("btn-undo-migration");
  const dismissBtn = document.getElementById("btn-dismiss-migration");
  undoBtn.replaceWith(undoBtn.cloneNode(true));
  dismissBtn.replaceWith(dismissBtn.cloneNode(true));
  document.getElementById("btn-undo-migration").addEventListener("click", undoMigration);
  document.getElementById("btn-dismiss-migration").addEventListener("click", dismissMigration);
  // Apply-layout button: inject before the dismiss button if needed
  const existingApply = document.getElementById("btn-apply-layout");
  if (existingApply) existingApply.remove();
  if (showApplyLayout) {
    const apply = document.createElement("button");
    apply.id = "btn-apply-layout";
    apply.textContent = "Apply new layout";
    apply.style.background = "var(--persimmon)";
    apply.style.color = "white";
    apply.style.border = "none";
    apply.style.padding = "6px 12px";
    apply.style.borderRadius = "999px";
    apply.style.fontSize = "12px";
    apply.style.fontWeight = "600";
    apply.addEventListener("click", applyLayoutFromSeed);
    document.getElementById("btn-undo-migration").parentNode.insertBefore(apply, document.getElementById("btn-undo-migration"));
  }
}

function applyLayoutFromSeed() {
  if (!migrationSnapshot || !migrationSnapshot.layoutDrift) return;
  for (const drift of migrationSnapshot.layoutDrift) {
    const stop = state.stops.find(s => s.id === drift.id);
    if (!stop) continue;
    stop.day = drift.seedDay;
    if (drift.seedSlot) stop.slot = drift.seedSlot;
    if (drift.seedTime !== undefined) stop.time = drift.seedTime;
    if (drift.seedOrder !== undefined) stop.order = drift.seedOrder;
  }
  saveState();
  renderAll();
  document.getElementById("migration-banner").classList.add("hidden");
  migrationSnapshot = null;
  toast("Layout applied.");
}

function undoMigration() {
  if (!migrationSnapshot) return;
  state = JSON.parse(JSON.stringify(migrationSnapshot.prev));
  state.version = SCHEMA_VERSION;  // keep version high so migration doesn't re-run
  migrationSnapshot = null;
  saveState();
  renderAll();
  document.getElementById("migration-banner").classList.add("hidden");
  toast("Undone.");
}
function dismissMigration() {
  migrationSnapshot = null;
  document.getElementById("migration-banner").classList.add("hidden");
}

// ----------- Wire up UI -----------
function wireUp() {
  document.getElementById("btn-add").addEventListener("click", () => {
    document.getElementById("searchrow").classList.toggle("hidden");
    if (!document.getElementById("searchrow").classList.contains("hidden")) {
      document.getElementById("search-input").focus();
    }
  });
  document.getElementById("btn-search-close").addEventListener("click", () => {
    document.getElementById("searchrow").classList.add("hidden");
  });
  document.getElementById("btn-droppin").addEventListener("click", startDropPin);
  document.getElementById("btn-droppin-cancel").addEventListener("click", cancelDropPin);
  document.getElementById("btn-fit-all").addEventListener("click", () => {
    const visible = state.stops.filter(s => !hiddenDays.has(s.day));
    fitTo(visible.length ? visible : state.stops);
  });
  document.getElementById("btn-export").addEventListener("click", exportJson);
  document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("btn-reset").addEventListener("click", resetToDefault);

  document.getElementById("btn-help").addEventListener("click", () => {
    document.getElementById("help-modal").classList.remove("hidden");
    document.getElementById("help-backdrop").classList.remove("hidden");
  });
  document.getElementById("btn-help-close").addEventListener("click", () => {
    document.getElementById("help-modal").classList.add("hidden");
    document.getElementById("help-backdrop").classList.add("hidden");
  });
  document.getElementById("help-backdrop").addEventListener("click", () => {
    document.getElementById("help-modal").classList.add("hidden");
    document.getElementById("help-backdrop").classList.add("hidden");
  });

  document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);

  document.getElementById("btn-darkmode").addEventListener("click", () => {
    setDark(!document.body.classList.contains("dark"));
  });

  document.getElementById("btn-save").addEventListener("click", openSnapshotsModal);
  document.getElementById("btn-snapshots-close").addEventListener("click", closeSnapshotsModal);
  document.getElementById("snapshots-backdrop").addEventListener("click", closeSnapshotsModal);
  document.getElementById("btn-save-snapshot").addEventListener("click", saveCurrentSnapshot);

  document.getElementById("tab-stops").addEventListener("click", () => switchTab("stops"));
  document.getElementById("tab-calendar").addEventListener("click", () => switchTab("calendar"));
  document.getElementById("tab-map").addEventListener("click", () => switchTab("map"));
  document.getElementById("tab-info").addEventListener("click", () => switchTab("info"));

  document.getElementById("trip-notes").addEventListener("input", (e) => {
    state.tripNotes = e.target.value; saveState();
  });
}

// ----------- Calendar tab -----------
function renderCalendar() {
  const root = document.getElementById("calendar-grid");
  if (!root) return;
  const scheduledDays = state.days.filter(d => d.day !== 0).sort((a, b) => a.day - b.day);
  root.innerHTML = "";

  scheduledDays.forEach(d => {
    const col = document.createElement("section");
    col.className = "cal-col";
    col.style.setProperty("--day-color", d.color);

    const stops = stopsForDay(d.day);
    const subtotal = stops.reduce((s, x) => s + (Number(x.cost_krw) || 0), 0);

    const head = document.createElement("header");
    head.className = "cal-col-head";
    head.innerHTML = `
      <div class="cal-day-num">${d.day}</div>
      <div class="cal-day-meta">
        <div class="cal-weekday">${escapeHtml(d.weekday || "")}</div>
        <div class="cal-date">${escapeHtml(d.date || "")}</div>
      </div>
      <div class="cal-day-title">${escapeHtml(d.title)}</div>
      <div class="cal-day-cost">${subtotal ? fmtKRW(subtotal) : ""}</div>
    `;
    col.appendChild(head);

    if (!stops.length) {
      const empty = document.createElement("div");
      empty.className = "cal-empty";
      empty.textContent = "Nothing planned yet.";
      col.appendChild(empty);
    }
    stops.forEach(s => {
      const row = document.createElement("div");
      row.className = "cal-row";
      if (s.done) row.classList.add("done");
      const emoji = TYPE_EMOJI[s.type] || TYPE_EMOJI.other;
      const slot = s.slot ? SLOT_LABEL[s.slot] : "";
      const resStatus = s.reservation_status || "none";
      const resPill = (resStatus === "needed" || resStatus === "booked")
        ? `<span class="cal-res cal-res-${resStatus}">${RES_STATUS[resStatus].emoji}</span>` : "";
      row.innerHTML = `
        <div class="cal-time">${escapeHtml(s.time || "—")}</div>
        <div class="cal-card">
          <div class="cal-card-top">
            ${slot ? `<span class="cal-slot">${slot}</span>` : ""}
            ${resPill}
          </div>
          <div class="cal-name"><span class="cal-emoji">${emoji}</span> ${escapeHtml(s.name)}</div>
          <div class="cal-sub">${escapeHtml(s.area || "")}${s.cost_krw ? " · " + fmtKRW(s.cost_krw) : ""}</div>
        </div>
      `;
      row.addEventListener("click", () => {
        switchTab("stops");
        setTimeout(() => selectStop(s.id), 100);
      });
      col.appendChild(row);
    });

    root.appendChild(col);
  });
}

// ----------- Snapshots (named saved states) -----------
const SNAPSHOTS_KEY = "seoul-eats-snapshots";

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function persistSnapshots(snaps) {
  try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snaps)); }
  catch (e) { toast("Couldn't save snapshot — storage full?"); }
}

function openSnapshotsModal() {
  document.getElementById("snapshots-backdrop").classList.remove("hidden");
  document.getElementById("snapshots-modal").classList.remove("hidden");
  document.getElementById("snapshot-name").value = "";
  renderSnapshotsList();
}
function closeSnapshotsModal() {
  document.getElementById("snapshots-backdrop").classList.add("hidden");
  document.getElementById("snapshots-modal").classList.add("hidden");
}

function saveCurrentSnapshot() {
  const input = document.getElementById("snapshot-name");
  const name = (input.value || "").trim() || `Save · ${new Date().toLocaleString()}`;
  const snaps = loadSnapshots();
  snaps.unshift({
    id: uid("snap"),
    name,
    timestamp: Date.now(),
    stopCount: state.stops.length,
    data: JSON.parse(JSON.stringify(state))
  });
  // Keep at most 20 snapshots so we don't blow up storage
  if (snaps.length > 20) snaps.length = 20;
  persistSnapshots(snaps);
  input.value = "";
  renderSnapshotsList();
  toast(`Saved as "${name}"`);
}

function restoreSnapshot(id) {
  const snaps = loadSnapshots();
  const snap = snaps.find(s => s.id === id);
  if (!snap) return;
  if (!confirm(`Restore "${snap.name}"? This replaces your current plan (you can save the current one first).`)) return;
  state = JSON.parse(JSON.stringify(snap.data));
  saveState();
  renderAll();
  closeSnapshotsModal();
  toast(`Restored "${snap.name}"`);
}

function deleteSnapshot(id) {
  const snaps = loadSnapshots().filter(s => s.id !== id);
  persistSnapshots(snaps);
  renderSnapshotsList();
}

function renderSnapshotsList() {
  const list = document.getElementById("snapshots-list");
  const snaps = loadSnapshots();
  if (!snaps.length) {
    list.innerHTML = `<li class="snapshot-empty">No saved snapshots yet. Save the current plan above.</li>`;
    return;
  }
  list.innerHTML = snaps.map(s => {
    const when = new Date(s.timestamp).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
    return `
      <li class="snapshot-item" data-id="${s.id}">
        <div class="snap-info">
          <div class="snap-name">${escapeHtml(s.name)}</div>
          <div class="snap-meta">${when} · ${s.stopCount} stops</div>
        </div>
        <div class="snap-actions">
          <button class="snap-restore" data-restore="${s.id}">Restore</button>
          <button class="snap-delete" data-delete="${s.id}" title="Delete snapshot">🗑</button>
        </div>
      </li>
    `;
  }).join("");
  list.querySelectorAll("[data-restore]").forEach(b => {
    b.addEventListener("click", () => restoreSnapshot(b.dataset.restore));
  });
  list.querySelectorAll("[data-delete]").forEach(b => {
    b.addEventListener("click", () => deleteSnapshot(b.dataset.delete));
  });
}

// ----------- Boot -----------
function boot() {
  state = loadState();
  // If we migrated, persist immediately so a reload doesn't re-trigger.
  if (migrationSnapshot) saveState();
  const darkPref = localStorage.getItem(DARK_KEY);
  if (darkPref === "1") setDark(true);
  renderAll();
  wireUp();
  setupSearch();
  if (migrationSnapshot) showMigrationBanner();
}

document.addEventListener("DOMContentLoaded", boot);
