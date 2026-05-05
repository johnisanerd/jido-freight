# 🚛 JIDO FREIGHT — PRO Trucker Companion

Full-stack trucker app with fuel prices, parking finder, and road alerts.

## Structure

```
jido-freight/
├── components/
│   ├── FuelFinder.tsx          ← Cheapest diesel by chain (Pilot, Love's, Petro, TA)
│   ├── ParkingFinder.tsx       ← Truck parking with live spaces, amenities, logs
│   ├── RoadAlerts.tsx          ← Crowdsourced road hazards
│   ├── MapboxMap.tsx           ← Shared map (markers, routes, traffic)
│   └── SplashScreen.tsx        ← Branded boot screen
├── server/
│   ├── appRouter.ts            ← Central tRPC router (20+ sub-routers)
│   ├── mapboxRouter.ts         ← Mapbox directions + geocoding
│   ├── mapboxService.ts        ← Raw Mapbox API calls
│   ├── liveFuelRouter.ts       ← ⭐ NEW — Apify GasBuddy scraper + mock fallback
│   ├── fuelParkingRouter.ts    ← ⭐ NEW — Nearby parking + parking logs
│   ├── alertsReviewsRouter.ts  ← ⭐ NEW — Road hazard CRUD + voting
│   └── _core/                  ← tRPC setup, auth, DB, env
├── hooks/
│   └── useGeolocation.ts       ← GPS hook (discriminated union, retry)
├── tests/
│   └── mapboxService.test.ts   ← Vitest tests
├── env.ts                      ← Environment config
└── data.csv                    ← API usage tracking
```

## Backend Routers (written fresh)

| Router | Front-End Page | What It Does |
|--------|---------------|--------------|
| `liveFuelRouter` | FuelFinder | Apify GasBuddy scraping → fuel prices; falls back to seeded mock data when no Apify token |
| `fuelParkingRouter` | ParkingFinder | Nearby parking with Haversine distance, parking logs with check-in/out |
| `alertsReviewsRouter` | RoadAlerts | Report/get/upvote/downvote road hazards, auto-verify at 10 upvotes, auto-remove at 5 downvotes |

## Known Issues to Fix

1. **FuelFinder double API call** on GPS load — fires `fetchPrices` twice
2. **Stale radius** — radius slider doesn't trigger re-fetch without manual search
3. **TA/Petro chain card** — TravelCenters of America should be its own card, not lumped with Petro
4. **DEF pricing** — shown in code but not prominent in the UI
5. **`defPrice` potentially undefined** — FuelFinder renders `stop.defPrice.toFixed(2)` which crashes if null
