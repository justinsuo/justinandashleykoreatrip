// Seed itinerary for Seoul Eats · Jun 7–11
// Day 0 = unscheduled "Ideas / swap-in" tray.
window.SEED_ITINERARY = {
  meta: {
    title: "Justin & Ashley · Seoul",
    subtitle: "Jun 7–11 · a food-first trip for Ashley, from Justin",
    center: [37.5563, 126.9869],
    zoom: 12,
    currency: "KRW"
  },
  days: [
    { day: 1, date: "2026-06-07", weekday: "Sun", title: "Arrival → Hongdae & Yeonnam", color: "#E8590C" },
    { day: 2, date: "2026-06-08", weekday: "Mon", title: "Old Seoul: Gwangjang + Euljiro", color: "#2F9E44" },
    { day: 3, date: "2026-06-09", weekday: "Tue", title: "Seongsu cafés + Seoul Forest → Ikseon BBQ", color: "#1971C2" },
    { day: 4, date: "2026-06-10", weekday: "Wed", title: "Markets + seafood feast", color: "#9C36B5" },
    { day: 5, date: "2026-06-11", weekday: "Thu", title: "Last bites & food souvenirs", color: "#E03131" },
    { day: 0, date: "", weekday: "", title: "💡 Ideas / swap-in", color: "#868E96" }
  ],
  stops: [
    // ---------- DAY 1 ----------
    { id: "pungnyeon",  day: 1, order: 1, time: "19:00", type: "bbq",
      name: "Pungnyeon Sutbul Galbi", name_ko: "연남 풍년숯불갈비", area: "Yeonnam-dong",
      lat: 37.5630532, lng: 126.9253417, cost_krw: 35000, place_id: "ChIJjZCiz-6YfDURXdhw0OBS_oo",
      blurb: "First-night charcoal pork belly & galbi. 5.0★, family-run, real charcoal smokiness. Pair with soju." },
    { id: "hongdae-chimaek", day: 1, order: 2, time: "21:30", type: "bar",
      name: "BBQ Chicken & Beer (Hongdae)", name_ko: "BBQ치킨 홍대로데오점", area: "Hongdae",
      lat: 37.5523919, lng: 126.9213509, cost_krw: 25000, place_id: "ChIJB-rU19qYfDURFwGzBMnK7B8",
      blurb: "Chimaek nightcap — Korean fried chicken + cold beer, open very late. Any Hongdae chicken+beer spot works." },

    // ---------- DAY 2 ----------
    { id: "eulji-myeonok", day: 2, order: 1, time: "11:30", type: "noodles",
      name: "Eulji Myeonok", name_ko: "을지면옥", area: "Euljiro",
      lat: 37.5736809, lng: 126.9885769, cost_krw: 14000, place_id: "ChIJgamxSgCjfDURXl5INU25Y88",
      blurb: "Pyongyang-style mul naengmyeon (cold buckwheat noodles). CLOSED SUNDAYS, sells out — arrive by 12:30." },
    { id: "gwangjang", day: 2, order: 2, time: "13:00", type: "market",
      name: "Gwangjang Market", name_ko: "광장시장", area: "Jongno",
      lat: 37.5700398, lng: 126.9996036, cost_krw: 15000, place_id: "ChIJm3V0fu2ifDURRJ8IMUijVtY",
      blurb: "Graze: bindaetteok (mung-bean pancake), mayak gimbap, yukhoe (raw beef), tteokbokki. Cash. Netflix-famous kalguksu too." },
    { id: "manseon-hof", day: 2, order: 3, time: "19:00", type: "bar",
      name: "Manseon Hof (Nogari Alley)", name_ko: "만선호프", area: "Euljiro",
      lat: 37.5671948, lng: 126.991811, cost_krw: 20000, place_id: "ChIJn6hVByKjfDURx-hGevo1qx4",
      blurb: "Euljiro beer-hall alley — dried pollack (nogari) + draft, plastic stools in the street. Vibe + beer, skip the chicken." },

    // ---------- DAY 3 ----------
    { id: "onion-seongsu", day: 3, order: 1, time: "10:00", type: "cafe",
      name: "Cafe Onion Seongsu", name_ko: "어니언 성수", area: "Seongsu-dong",
      lat: 37.5447328, lng: 127.0582091, cost_krw: 12000, place_id: "ChIJHb1ypJWkfDURb2d4XCjLluM",
      blurb: "Brunch in a brutalist former factory. Pandoro + salt bread. Go ~9–10am to beat crowds." },
    { id: "daelim", day: 3, order: 2, time: "12:30", type: "cafe",
      name: "Daelim Changgo", name_ko: "대림창고", area: "Seongsu-dong",
      lat: 37.5418384, lng: 127.0564636, cost_krw: 12000, place_id: "ChIJi_M445OkfDURBV_ePY2qCHo",
      blurb: "Giant red-brick warehouse gallery-café — the icon of Seongsu. Coffee + cake, cinematic industrial space." },
    { id: "seoul-forest", day: 3, order: 3, time: "14:00", type: "park",
      name: "Seoul Forest Park", name_ko: "서울숲", area: "Seongdong-gu",
      lat: 37.5443878, lng: 127.0374424, cost_krw: 0, place_id: "ChIJK_b0UX2jfDURmkYPvmWYm90",
      blurb: "Optional easy stroll to walk off the coffee. Relaxed, not touristy — your one bit of green." },
    { id: "gowoondon", day: 3, order: 4, time: "19:00", type: "bbq",
      name: "Gowoondon (Ikseon-dong BBQ)", name_ko: "고운돈", area: "Ikseon-dong",
      lat: 37.5730622, lng: 126.9899923, cost_krw: 28000, place_id: "ChIJJawtZQCjfDURYKP2MnwsfQk",
      reservation_url: "https://www.catchtable.co.kr/", reservation_status: "needed",
      blurb: "Hanok-courtyard pork BBQ. 4.9★. Fills fast — arrive ~5–6pm or book via Catch Table. They fry rice/noodles for you at the end." },

    // ---------- DAY 4 ----------
    { id: "tongin", day: 4, order: 1, time: "12:00", type: "market",
      name: "Tongin Market (coin dosirak)", name_ko: "통인시장", area: "Seochon",
      lat: 37.5807649, lng: 126.9706756, cost_krw: 8000, place_id: "ChIJYxd6fL6ifDURy7wm894BUcQ",
      blurb: "Buy brass coins, fill a lunch tray from the stalls. Fun and cheap. Closes ~5pm." },
    { id: "tosokchon", day: 4, order: 2, time: "13:30", type: "soup",
      name: "Tosokchon Samgyetang", name_ko: "토속촌 삼계탕", area: "Seochon",
      lat: 37.5777786, lng: 126.9715909, cost_krw: 20000, place_id: "ChIJb5OOGL6ifDURU29ID3t8aOA",
      blurb: "5-min walk away — Seoul's famous ginseng chicken soup. Do instead of (or after) Tongin for a sit-down." },
    { id: "noryangjin", day: 4, order: 3, time: "18:30", type: "seafood",
      name: "Noryangjin Fisheries Market", name_ko: "노량진수산시장", area: "Noryangjin",
      lat: 37.5149717, lng: 126.9386342, cost_krw: 50000, place_id: "ChIJOTEaKmiffDURNTst1Jzcm_c",
      blurb: "Pick king crab/abalone/sashimi/live octopus downstairs, AGREE PRICE FIRST, eat it cooked upstairs. Cash. The big one." },

    // ---------- DAY 5 ----------
    { id: "london-bagel", day: 5, order: 1, time: "09:00", type: "cafe",
      name: "London Bagel Museum (Anguk)", name_ko: "런던베이글뮤지엄 안국점", area: "Anguk / Bukchon",
      lat: 37.5791826, lng: 126.986152, cost_krw: 12000, place_id: "ChIJKw66zRCjfDURuaw9qYPdI-k",
      reservation_url: "https://app.tablemanager.io/", reservation_status: "needed",
      blurb: "Open-run bakery — get on the queue app early, or arrive ~8:30am. Potato-cheese & Bricklane bagels. Onion Anguk is 2 min away." },
    { id: "myeongdong", day: 5, order: 2, time: "18:00", type: "market",
      name: "Myeongdong Night Market", name_ko: "명동 야시장", area: "Myeongdong",
      lat: 37.5616685, lng: 126.9858438, cost_krw: 15000, place_id: "ChIJqb-ne_CifDURR-yH8a3sjXM",
      blurb: "Late-flight option: street-food crawl (tornado potato, hotteok, egg bread) + edible souvenirs. Stalls ~5pm+." },

    // ---------- IDEAS / SWAP-IN (day 0) ----------
    { id: "onion-anguk", day: 0, order: 1, time: "", type: "cafe",
      name: "Cafe Onion Anguk", name_ko: "어니언 안국", area: "Anguk / Bukchon",
      lat: 37.5776235, lng: 126.9865541, cost_krw: 12000, place_id: "ChIJLXL2BvijfDURmTrYFPQIGUc",
      blurb: "Backup for the Day 5 bagel — hanok-courtyard café, famous pandoro." },
    { id: "jeong-daepo", day: 0, order: 2, time: "", type: "bbq",
      name: "Jeong Daepo (Mapo BBQ)", name_ko: "정대포", area: "Mapo",
      lat: 37.541983, lng: 126.9511176, cost_krw: 30000, place_id: "ChIJqfTTJaeYfDURTvox_bUC6Mk",
      blurb: "Anthony Bourdain's Mapo charcoal BBQ — egg moat round the grill. Swap into any dinner slot." },
    { id: "mingles", day: 0, order: 3, time: "", type: "splurge",
      name: "Mingles (3 Michelin stars)", name_ko: "밍글스", area: "Cheongdam / Gangnam",
      lat: 37.5253386, lng: 127.0441452, cost_krw: 250000, place_id: "ChIJjXuM24mjfDURSwmouRnxNlM",
      reservation_url: "https://www.catchtable.co.kr/", reservation_status: "needed",
      blurb: "One splurge night: modern Korean tasting menu. Book weeks ahead via Catch Table. CLOSED Mon & Sun (so Day 4 Wed works)." }
  ]
};
