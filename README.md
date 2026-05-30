# Justin & Ashley · Seoul — Jun 7–11

A single-page, fully-editable food-trip map for our 5 days in Seoul. Made for Ashley.

🍜 **Live:** _https://<your-username>.github.io/seoul-food-trip/_ (filled in after first push)

## What it is

- Interactive Leaflet map with one pin per stop, colored by day.
- Scrollable list of every day, every meal, with cost subtotals and walking distances.
- Reservation tracker: each stop has a reservation URL + status (none / needs booking / booked) and the header nags you about anything still unbooked.
- Korea-friendly quick links: every stop has Naver, Kakao, Google, and a "Copy 한국어" button for taxis.
- 100% client-side. No keys, no build step, GitHub Pages-ready.

## How to edit (from your phone or laptop)

- **Move a pin:** drag the marker on the map.
- **Reorder a day:** drag the row up/down in the list. Drop it into another day's section to move it there.
- **Edit details:** tap a row → tap ✏️ Edit. Change name, Korean name, time, day, cost, reservation status/URL, hours, lat/lng, blurb.
- **Add a place:** tap **+ Add place** to search by name (OpenStreetMap), or **📍 Drop pin** to tap the map.
- **Delete:** open the stop's sheet → 🗑 Delete.
- **Reservations:** open a stop → tap **🔗 Reserve** to open the booking site, then tap the status button to cycle none → needs booking → booked.
- **Mark visited:** open a stop → "Mark visited". Visited stops show struck-through in the list.

## Backup & sync

Data lives in **localStorage**, which is per-browser/per-device. So:

- **Export JSON** — downloads a backup of the entire itinerary including all notes and reservation status.
- **Import JSON** — restores from a backup. Use this to move edits from laptop → phone or vice versa.
- **Reset to default** — restores the original seed plan.

## Files

```
seoul-food-trip/
├── index.html        # markup + CDN links
├── styles.css        # mobile-first styling
├── app.js            # all logic
├── data.js           # seed itinerary
└── README.md
```

Plain HTML/CSS/JS. No bundler, no framework, no API keys. Map tiles are from OpenStreetMap, geocoding is OpenStreetMap Nominatim.

## Redeploy after edits

```bash
git add -A
git commit -m "update"
git push
```

GitHub Pages picks it up in 1–2 minutes.

## Local development

```bash
cd seoul-food-trip
python -m http.server 8000
# open http://localhost:8000
```

(or `npx serve`)

## Suggested fits for the swap-in ideas

- **Bamdokkaebi Night Market (Han River food trucks)** → Sun Jun 7 (Day 1) **if** the seasonal schedule confirms (Fri–Sun evenings, spring–autumn). It's the cool one.
- **Saeseoul (rooftop bar)** → Day 3 nightcap after Ikseon BBQ — it's a 1-minute walk away.
- **Charles H. (Four Seasons speakeasy)** or **Jongno Pocha Street (orange-tent stalls)** → Day 2 central nightcap, both walkable from Euljiro.
- **Zest** + **Le Chamber** (Cheongdam pair) → pair with a Gangnam splurge night (Day 4 Wed, after Mingles backups like Mosu, Soigné, Allen, Evett).
- **Bar Cham** → Day 4 Seochon nightcap (closed Tuesdays only — Wed is fine).
- **Slow Brew** → anytime you want makgeolli & jeon instead of cocktails.

## Notes & gotchas

- **Nominatim policy:** searches are debounced to ≥1s and limited to 5 results. If a search returns nothing, drop a pin instead.
- **Tiles + geocoding need internet.** Your saved data and the app shell work offline.
- **Cash for markets, T-money for subway, Naver/Kakao > Google for directions in Korea.**
