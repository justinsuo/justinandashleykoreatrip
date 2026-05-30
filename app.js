/* ============================================================
 * Justin & Ashley · Seoul — app.js
 * Vanilla JS. Leaflet + SortableJS via CDN. localStorage persistence.
 * ============================================================ */

const STORAGE_KEY = "seoul-eats-itinerary-v1";
const DARK_KEY = "seoul-eats-dark";
const SCHEMA_VERSION = 1;

// Type -> emoji
const TYPE_EMOJI = {
  bbq: "🥩", market: "🍢", cafe: "☕", bar: "🍺",
  noodles: "🍜", soup: "🍲", seafood: "🦀", dessert: "🍧",
  park: "🌳", splurge: "⭐", other: "📍"
};
const TYPE_OPTIONS = Object.keys(TYPE_EMOJI);

// Reservation status -> {emoji, label}
const RES_STATUS = {
  none:   { emoji: "",   label: "No reservation needed", short: "" },
  needed: { emoji: "⚠️", label: "Reservation needed",   short: "needs booking" },
  booked: { emoji: "✅", label: "Reservation booked",   short: "booked" }
};
const RES_OPTIONS = Object.keys(RES_STATUS);

// ----------- State -----------
let state = null;                 // { meta, days, stops, tripNotes, dayNotes, version }
let map = null;
let markers = {};                 // id -> Leaflet marker
let dayLayers = {};               // day -> L.LayerGroup
let polylines = {};               // day -> polyline
let selectedStopId = null;
let dropPinMode = false;
let hiddenDays = new Set();       // days currently toggled off
let searchTimer = null;

// ----------- Persistence -----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.stops)) {
        return parsed;
      } else if (parsed && parsed.stops) {
        // Older save: try to upgrade by re-seeding meta/days but keeping stops.
        if (confirm("Saved data is from an older version. Reset to default plan?")) {
          return freshState();
        }
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
    dayNotes: {} // day -> string
  };
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
  return state.stops.filter(s => s.day === day).sort((a, b) => a.order - b.order);
}
function haversineKm(a, b) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}
function walkMin(km) { return Math.round(km * 12); }

function renderReservationBlock(s) {
  const status = s.reservation_status || "none";
  const info = RES_STATUS[status];
  const url = s.reservation_url || "";
  // Style the block based on status
  const bg = status === "booked" ? "rgba(47,158,68,0.10)"
           : status === "needed" ? "rgba(232,89,12,0.10)"
           : "var(--bg-elev)";
  const border = status === "booked" ? "rgba(47,158,68,0.45)"
               : status === "needed" ? "rgba(232,89,12,0.45)"
               : "var(--border)";
  const reserveBtn = url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener" class="primary" style="padding:8px 12px;border-radius:8px;text-decoration:none;background:var(--accent);color:white;font-weight:600;font-size:13px;">🔗 Reserve</a>`
    : "";
  const statusBtn = `<button id="res-toggle" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--bg-elev);color:var(--fg);font-size:13px;font-weight:600;">
      ${info.emoji || "🪑"} ${status === "none" ? "Mark as needed" : (status === "needed" ? "Mark booked" : "Booked — undo")}
    </button>`;
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin-bottom:10px;
                background:${bg};border:1px solid ${border};border-radius:10px;">
      <div style="flex:1;min-width:120px;font-size:13px;">
        <strong>${info.emoji || "🪑"} Reservation:</strong> ${escapeHtml(info.label)}
      </div>
      ${reserveBtn}
      ${statusBtn}
    </div>
  `;
}

function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

// ----------- Map setup -----------
function setupMap() {
  map = L.map("map", { zoomControl: true }).setView(state.meta.center, state.meta.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  map.on("click", (e) => {
    if (dropPinMode) finishDropPin(e.latlng);
  });
}

function makePinIcon(color, emoji, orderBadge) {
  const orderHtml = orderBadge ? `<span class="pin-order">${orderBadge}</span>` : "";
  return L.divIcon({
    className: "",
    html: `<div class="pin" style="--pin-color:${color};position:relative;">
             <span class="pin-emoji">${emoji}</span>
             ${orderHtml}
           </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28]
  });
}

function rebuildMarkers() {
  // Clear
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
    marker.on("click", () => selectStop(s.id));
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

  // Polylines per scheduled day
  state.days.forEach(d => { if (d.day !== 0) drawDayPolyline(d.day); });
}

function drawDayPolyline(day) {
  if (polylines[day]) { map.removeLayer(polylines[day]); delete polylines[day]; }
  if (hiddenDays.has(day)) return;
  if (day === 0) return;
  const pts = stopsForDay(day).map(s => [s.lat, s.lng]);
  if (pts.length < 2) return;
  const color = dayMeta(day).color;
  polylines[day] = L.polyline(pts, { color, weight: 3, opacity: 0.55, dashArray: "6 8" }).addTo(map);
}

function fitTo(stops) {
  if (!stops || !stops.length) return;
  const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
}

// ----------- Render: sidebar -----------
function renderLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  state.days.forEach(d => {
    const id = "lg-" + d.day;
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" id="${id}" ${hiddenDays.has(d.day) ? "" : "checked"} />
      <span class="swatch" style="background:${d.color}"></span>
      <span>${d.day === 0 ? "Ideas" : "D" + d.day}</span>
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
    const group = document.querySelector(`.day-group[data-day="${day}"]`);
    if (group) group.classList.add("collapsed");
  } else {
    if (dayLayers[day]) dayLayers[day].addTo(map);
    drawDayPolyline(day);
    const group = document.querySelector(`.day-group[data-day="${day}"]`);
    if (group) group.classList.remove("collapsed");
  }
}

function renderDayList() {
  const root = document.getElementById("day-list");
  root.innerHTML = "";
  state.days.forEach(d => {
    const stops = stopsForDay(d.day);
    const group = document.createElement("section");
    group.className = "day-group";
    group.dataset.day = d.day;
    if (hiddenDays.has(d.day)) group.classList.add("collapsed");

    const subtotal = stops.reduce((sum, s) => sum + (Number(s.cost_krw) || 0), 0);

    const head = document.createElement("div");
    head.className = "day-head";
    head.innerHTML = `
      <span class="day-bar" style="background:${d.color}"></span>
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

    const list = document.createElement("ul");
    list.className = "stop-list";
    list.dataset.day = d.day;

    stops.forEach((s, idx) => {
      const nextStop = stops[idx + 1];
      const li = document.createElement("li");
      li.className = "stop-row";
      li.dataset.id = s.id;
      if (s.id === selectedStopId) li.classList.add("active");
      if (s.done) li.classList.add("done");

      const distMeta = nextStop ? (() => {
        const km = haversineKm(s, nextStop);
        const min = walkMin(km);
        const subway = km > 1.5 ? " (subway faster)" : "";
        return `→ ${km.toFixed(1)} km · ~${min} min walk${subway}`;
      })() : "";

      const resBadge = s.reservation_status && s.reservation_status !== "none"
        ? `<span title="${RES_STATUS[s.reservation_status].label}" style="margin-right:4px;">${RES_STATUS[s.reservation_status].emoji}</span>`
        : "";
      li.innerHTML = `
        <div class="order-badge" style="background:${d.color}">${d.day === 0 ? "💡" : s.order}</div>
        <div class="emoji">${TYPE_EMOJI[s.type] || TYPE_EMOJI.other}</div>
        <div class="midcol">
          <div class="name">${resBadge}${escapeHtml(s.name)}</div>
          <div class="meta">${s.time ? s.time + " · " : ""}${escapeHtml(s.area || "")}${distMeta ? " · " + distMeta : ""}</div>
        </div>
        <div class="right">
          <div>${s.cost_krw ? fmtKRW(s.cost_krw) : ""}</div>
          <button class="edit-btn" title="Edit" aria-label="Edit">✏️</button>
        </div>
      `;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".edit-btn")) {
          openEditForm(s.id);
        } else {
          selectStop(s.id);
        }
      });
      list.appendChild(li);
    });

    if (!stops.length) {
      const empty = document.createElement("li");
      empty.className = "stop-row";
      empty.style.opacity = "0.55";
      empty.innerHTML = `<div></div><div class="emoji">·</div><div class="midcol"><div class="meta">Drag a stop here or use + Add place.</div></div><div></div>`;
      list.appendChild(empty);
    }

    group.appendChild(list);

    // Day notes + per-day fit
    const foot = document.createElement("div");
    foot.className = "day-foot";
    const noteVal = (state.dayNotes && state.dayNotes[d.day]) || "";
    foot.innerHTML = `
      <textarea placeholder="Notes for ${d.day === 0 ? "ideas" : "day " + d.day}…">${escapeHtml(noteVal)}</textarea>
      <button class="iconbtn" data-fit="${d.day}" title="Fit map to this day">🎯</button>
    `;
    foot.querySelector("textarea").addEventListener("input", (e) => {
      state.dayNotes[d.day] = e.target.value;
      saveState();
    });
    foot.querySelector("button").addEventListener("click", () => {
      const ss = stopsForDay(d.day);
      if (!ss.length) return;
      if (hiddenDays.has(d.day)) {
        hiddenDays.delete(d.day);
        applyDayVisibility(d.day);
        const cb = document.getElementById("lg-" + d.day);
        if (cb) cb.checked = true;
      }
      fitTo(ss);
    });
    group.appendChild(foot);

    root.appendChild(group);

    // Sortable per list
    if (window.Sortable) {
      new Sortable(list, {
        group: "stops",
        animation: 140,
        delay: 120,
        delayOnTouchOnly: true,
        touchStartThreshold: 5,
        ghostClass: "sortable-ghost",
        chosenClass: "sortable-chosen",
        onEnd: handleSortEnd
      });
    }
  });
}

function handleSortEnd(evt) {
  const id = evt.item.dataset.id;
  const fromDay = parseInt(evt.from.dataset.day, 10);
  const toDay = parseInt(evt.to.dataset.day, 10);
  const stop = state.stops.find(s => s.id === id);
  if (!stop) return;
  stop.day = toDay;
  // Recompute order from current DOM in both lists
  reorderFromDom(toDay);
  if (fromDay !== toDay) reorderFromDom(fromDay);
  saveState();
  renderAll();
}

function reorderFromDom(day) {
  const list = document.querySelector(`.stop-list[data-day="${day}"]`);
  if (!list) return;
  const ids = [...list.querySelectorAll(".stop-row")].map(li => li.dataset.id).filter(Boolean);
  ids.forEach((id, idx) => {
    const s = state.stops.find(x => x.id === id);
    if (s) s.order = idx + 1;
  });
}

function renderTotals() {
  const total = state.stops
    .filter(s => s.day !== 0)
    .reduce((sum, s) => sum + (Number(s.cost_krw) || 0), 0);
  const ideasTotal = state.stops
    .filter(s => s.day === 0)
    .reduce((sum, s) => sum + (Number(s.cost_krw) || 0), 0);
  const needBooking = state.stops.filter(s => s.reservation_status === "needed").length;
  const booked = state.stops.filter(s => s.reservation_status === "booked").length;
  const el = document.getElementById("totals");
  el.innerHTML = `
    <div>
      <div style="font-size:11px;color:var(--fg-soft);">Scheduled total</div>
      <div class="trip-total">${fmtKRW(total)}</div>
      ${needBooking ? `<div style="font-size:11px;color:var(--accent);margin-top:4px;">⚠️ ${needBooking} still need${needBooking === 1 ? "s" : ""} booking</div>` : ""}
      ${booked ? `<div style="font-size:11px;color:#2F9E44;margin-top:2px;">✅ ${booked} booked</div>` : ""}
    </div>
    <div style="text-align:right;font-size:11px;color:var(--fg-soft);">
      <div>${state.stops.filter(s=>s.day!==0).length} scheduled · ${state.stops.filter(s=>s.day===0).length} ideas</div>
      <div>Ideas pool: ${fmtKRW(ideasTotal)}</div>
    </div>
  `;
}

function renderAll() {
  renderLegend();
  renderDayList();
  renderTotals();
  rebuildMarkers();
  document.getElementById("title").textContent = state.meta.title;
  document.getElementById("subtitle").textContent = state.meta.subtitle;
  document.getElementById("trip-notes").value = state.tripNotes || "";
}

// ----------- Select / detail -----------
function selectStop(id) {
  selectedStopId = id;
  document.querySelectorAll(".stop-row").forEach(r => r.classList.toggle("active", r.dataset.id === id));
  const s = state.stops.find(x => x.id === id);
  if (!s) return;
  const m = markers[id];
  // Make sure its day layer is visible
  if (hiddenDays.has(s.day)) {
    hiddenDays.delete(s.day);
    applyDayVisibility(s.day);
    const cb = document.getElementById("lg-" + s.day);
    if (cb) cb.checked = true;
  }
  if (m) {
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15), { animate: true });
    m.openPopup && m.openPopup();
  }
  // Scroll row into view
  const row = document.querySelector(`.stop-row[data-id="${id}"]`);
  if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

  const sheet = document.getElementById("sheet-content");
  sheet.innerHTML = `
    <div class="detail-head">
      <div class="detail-emoji" style="background:${meta.color}">${TYPE_EMOJI[s.type] || TYPE_EMOJI.other}</div>
      <div style="flex:1;min-width:0;">
        <div class="detail-name">${escapeHtml(s.name)}</div>
        ${s.name_ko ? `<div class="detail-name-ko">${escapeHtml(s.name_ko)}</div>` : ""}
        <div class="detail-meta">
          ${s.day === 0 ? "💡 Ideas tray" : "Day " + s.day + (meta.date ? " · " + meta.weekday + " " + meta.date : "")}
          ${s.time ? " · " + s.time : ""}
          ${s.area ? " · " + escapeHtml(s.area) : ""}
          ${s.cost_krw ? " · " + fmtKRW(s.cost_krw) : ""}
        </div>
      </div>
      <button class="iconbtn" id="sheet-close" aria-label="Close">✕</button>
    </div>
    ${s.blurb ? `<div class="detail-blurb">${escapeHtml(s.blurb)}</div>` : ""}
    ${s.hours ? `<div class="detail-meta" style="margin-bottom:6px;">🕒 ${escapeHtml(s.hours)}</div>` : ""}
    ${renderReservationBlock(s)}
    <div class="detail-quicklinks">
      <a href="${naverUrl}" target="_blank" rel="noopener" class="primary">Naver</a>
      <a href="${kakaoUrl}" target="_blank" rel="noopener">Kakao</a>
      <a href="${googleUrl}" target="_blank" rel="noopener">Google</a>
      <a href="${directionsUrl}" target="_blank" rel="noopener">Directions</a>
      <button id="copy-ko">📋 Copy 한국어</button>
    </div>
    <div class="detail-stop-notes">
      <textarea id="stop-notes" placeholder="Stop notes (hours, who to ask for, what to order)…">${escapeHtml(s.notes || "")}</textarea>
    </div>
    <div class="detail-actions">
      <button id="btn-done" class="${s.done ? "primary" : ""}">${s.done ? "✅ Visited" : "Mark visited"}</button>
      <button id="btn-edit" class="primary">✏️ Edit</button>
      <button id="btn-delete" class="danger">🗑 Delete</button>
    </div>
  `;
  sheet.querySelector("#sheet-close").addEventListener("click", closeSheet);
  // Reservation interactions
  const resToggle = sheet.querySelector("#res-toggle");
  if (resToggle) {
    resToggle.addEventListener("click", () => {
      // Cycle: needed -> booked -> needed (or none -> needed -> booked -> none)
      const cur = s.reservation_status || "none";
      const next = cur === "none" ? "needed" : (cur === "needed" ? "booked" : "none");
      s.reservation_status = next;
      saveState();
      renderDayList();
      openDetailSheet(id);
      toast("Status: " + RES_STATUS[next].label);
    });
  }

  sheet.querySelector("#copy-ko").addEventListener("click", () => {
    navigator.clipboard.writeText(s.name_ko || s.name).then(
      () => toast("Korean name copied — show your driver."),
      () => toast("Copy failed.")
    );
  });
  sheet.querySelector("#stop-notes").addEventListener("input", (e) => {
    s.notes = e.target.value; saveState();
  });
  sheet.querySelector("#btn-done").addEventListener("click", () => {
    s.done = !s.done; saveState(); renderDayList(); openDetailSheet(id);
  });
  sheet.querySelector("#btn-edit").addEventListener("click", () => openEditForm(id));
  sheet.querySelector("#btn-delete").addEventListener("click", () => {
    if (!confirm(`Delete “${s.name}”?`)) return;
    state.stops = state.stops.filter(x => x.id !== id);
    selectedStopId = null;
    saveState();
    renderAll();
    closeSheet();
    toast("Deleted.");
  });

  showSheet();
}

function openEditForm(id, options = {}) {
  const isNew = options.isNew === true;
  const s = isNew ? options.stop : state.stops.find(x => x.id === id);
  if (!s) return;

  const dayOpts = state.days
    .slice()
    .sort((a, b) => a.day - b.day)
    .map(d => `<option value="${d.day}" ${d.day === s.day ? "selected" : ""}>${d.day === 0 ? "Ideas (unscheduled)" : "Day " + d.day + " — " + d.title}</option>`)
    .join("");
  const typeOpts = TYPE_OPTIONS.map(t => `<option value="${t}" ${t === s.type ? "selected" : ""}>${TYPE_EMOJI[t]} ${t}</option>`).join("");

  const sheet = document.getElementById("sheet-content");
  sheet.innerHTML = `
    <h3 style="margin-bottom:10px;">${isNew ? "Add a stop" : "Edit stop"}</h3>
    <div class="form-row">
      <label>Name</label>
      <input id="f-name" type="text" value="${escapeAttr(s.name || "")}" />
    </div>
    <div class="form-row">
      <label>Korean name (한국어)</label>
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
      <label>Area / neighborhood</label>
      <input id="f-area" type="text" value="${escapeAttr(s.area || "")}" />
    </div>
    <div class="form-row">
      <label>Hours (optional)</label>
      <input id="f-hours" type="text" value="${escapeAttr(s.hours || "")}" placeholder="e.g. 11:00–22:00, closed Sun" />
    </div>
    <div class="form-grid2">
      <div class="form-row">
        <label>Reservation status</label>
        <select id="f-res-status">
          ${RES_OPTIONS.map(k => `<option value="${k}" ${(s.reservation_status || "none") === k ? "selected" : ""}>${RES_STATUS[k].emoji} ${RES_STATUS[k].label}</option>`).join("")}
        </select>
      </div>
      <div class="form-row">
        <label>Reservation URL</label>
        <input id="f-res-url" type="url" placeholder="https://..." value="${escapeAttr(s.reservation_url || "")}" />
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
    const updated = {
      ...s,
      name: sheet.querySelector("#f-name").value.trim() || "Untitled",
      name_ko: sheet.querySelector("#f-name-ko").value.trim(),
      day: parseInt(sheet.querySelector("#f-day").value, 10),
      type: sheet.querySelector("#f-type").value,
      time: sheet.querySelector("#f-time").value.trim(),
      cost_krw: parseInt(sheet.querySelector("#f-cost").value, 10) || 0,
      area: sheet.querySelector("#f-area").value.trim(),
      hours: sheet.querySelector("#f-hours").value.trim(),
      reservation_status: sheet.querySelector("#f-res-status").value,
      reservation_url: sheet.querySelector("#f-res-url").value.trim(),
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
        // If day changed, append to end of new day
        if (state.stops[idx].day !== updated.day) {
          updated.order = (stopsForDay(updated.day).length || 0) + 1;
        }
        state.stops[idx] = updated;
        // Re-pack orders in the (possibly old) day
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

function reorderDayInState(day) {
  const ss = state.stops.filter(s => s.day === day).sort((a, b) => a.order - b.order);
  ss.forEach((s, i) => s.order = i + 1);
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
  document.getElementById("droppin-banner").classList.remove("hidden");
  document.getElementById("map").style.cursor = "crosshair";
  // On mobile, show map
  document.getElementById("layout").classList.remove("list-only");
  document.getElementById("layout").classList.add("map-only");
}
function cancelDropPin() {
  dropPinMode = false;
  document.getElementById("droppin-banner").classList.add("hidden");
  document.getElementById("map").style.cursor = "";
  document.getElementById("layout").classList.remove("map-only");
}
function finishDropPin(latlng) {
  cancelDropPin();
  // Pick day = lowest visible scheduled day with current selection, or 0
  const defaultDay = selectedStopId
    ? (state.stops.find(s => s.id === selectedStopId)?.day ?? 0)
    : 0;
  const draft = {
    id: uid(),
    day: defaultDay,
    order: 999,
    time: "",
    type: "other",
    name: "New stop",
    name_ko: "",
    area: "",
    lat: latlng.lat,
    lng: latlng.lng,
    cost_krw: 0,
    blurb: ""
  };
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
    searchTimer = setTimeout(() => doSearch(q), 1100); // ≥1s debounce
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
            li.textContent = "No results. Try “📍 Drop pin” instead.";
            li.style.color = "var(--fg-faint)";
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
                id: uid(),
                day: 0,
                order: 999,
                time: "",
                type: "other",
                name: it.display_name.split(",")[0].trim(),
                name_ko: "",
                area: (it.display_name.split(",")[1] || "").trim(),
                lat: parseFloat(it.lat),
                lng: parseFloat(it.lon),
                cost_krw: 0,
                blurb: ""
              };
              map.setView([draft.lat, draft.lng], 16);
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
  a.download = "seoul-eats-" + new Date().toISOString().slice(0, 10) + ".json";
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
      state = {
        version: SCHEMA_VERSION,
        meta: parsed.meta || state.meta,
        days: parsed.days,
        stops: parsed.stops,
        tripNotes: parsed.tripNotes || "",
        dayNotes: parsed.dayNotes || {}
      };
      saveState(); renderAll();
      toast("Imported.");
    } catch (err) {
      console.error(err);
      alert("Couldn't import — file doesn't look like a Seoul Eats backup.");
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

  document.getElementById("btn-view-toggle").addEventListener("click", () => {
    const layout = document.getElementById("layout");
    if (layout.classList.contains("map-only")) {
      layout.classList.remove("map-only");
      layout.classList.add("list-only");
      document.getElementById("btn-view-toggle").textContent = "🗺️";
    } else if (layout.classList.contains("list-only")) {
      layout.classList.remove("list-only");
      document.getElementById("btn-view-toggle").textContent = "📋";
    } else {
      layout.classList.add("map-only");
      document.getElementById("btn-view-toggle").textContent = "📋";
    }
    setTimeout(() => map.invalidateSize(), 200);
  });

  document.getElementById("trip-notes").addEventListener("input", (e) => {
    state.tripNotes = e.target.value; saveState();
  });
}

// ----------- Escaping -----------
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }

// ----------- Boot -----------
function boot() {
  state = loadState();
  const darkPref = localStorage.getItem(DARK_KEY);
  if (darkPref === "1") setDark(true);
  setupMap();
  renderAll();
  wireUp();
  setupSearch();
  // Make sure Leaflet sizes correctly after CSS settles
  setTimeout(() => map.invalidateSize(), 80);
}

document.addEventListener("DOMContentLoaded", boot);
