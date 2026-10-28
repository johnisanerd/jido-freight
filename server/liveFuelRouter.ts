import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";

// ── Schemas ──────────────────────────────────────────────────────────────────
const FuelPriceSchema = z.object({
  stationName: z.string(),
  address: z.string(),
  dieselPrice: z.number(),
  defPrice: z.number().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  lastUpdated: z.string().optional(),
  chain: z.string().optional(),
});

type FuelPrice = z.infer<typeof FuelPriceSchema>;

// ── In-memory cache ──────────────────────────────────────────────────────────
const priceCache = new Map<string, { prices: FuelPrice[]; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cacheKey(location: string, radiusMiles: number) {
  return `${location.toLowerCase().trim()}|${radiusMiles}`;
}

// ── Mock data (fallback when Apify scraper is not configured) ────────────────
function getMockPrices(location: string, radiusMiles: number): FuelPrice[] {
  const loc = location.toLowerCase();
  // Generate some realistic-looking stations
  const chains = [
    { name: "Pilot Flying J", keywords: ["pilot", "flying j"] },
    { name: "Love's Travel Stop", keywords: ["love's", "loves"] },
    { name: "Petro Stopping Center", keywords: ["petro", "tca"] },
    { name: "TA Travel Center", keywords: ["ta", "travel centers of america"] },
  ];

  // Random seed based on location string for reproducibility within a session
  const seed = loc.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const pseudoRand = (i: number) => ((seed * 9301 + i * 49297) % 233280) / 233280;

  const basePrice = 3.50 + pseudoRand(0) * 1.50; // $3.50–$5.00
  const stations: FuelPrice[] = [];

  chains.forEach((chain, ci) => {
    const price = basePrice + pseudoRand(ci + 1) * 0.40 - 0.20;
    stations.push({
      stationName: `${chain.name} #${100 + ci}`,
      address: `${Math.floor(100 + pseudoRand(ci + 10) * 900)} Trucker Dr, ${location}`,
      dieselPrice: parseFloat(price.toFixed(2)),
      defPrice: parseFloat((price * 0.45 + pseudoRand(ci + 20) * 0.15).toFixed(2)),
      latitude: 34.0 + pseudoRand(ci + 30) * 0.5,
      longitude: -118.0 + pseudoRand(ci + 40) * 0.5,
      lastUpdated: new Date().toISOString(),
      chain: chain.keywords[0],
    });
  });

  return stations;
}

// ── Router ───────────────────────────────────────────────────────────────────
export const liveFuelRouter = router({
  /**
   * Fetch live fuel prices for a location.
   * Uses Apify fuel prices scraper when configured, falls back to mock data.
   */
  fetchPrices: publicProcedure
    .input(
      z.object({
        location: z.string().min(1),
        radiusMiles: z.number().min(5).max(500).default(100),
      })
    )
    .mutation(async ({ input }) => {
      const key = cacheKey(input.location, input.radiusMiles);

      // Check cache first
      const cached = priceCache.get(key);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return { prices: cached.prices, cached: true };
      }

      const apifyToken = process.env.APIFY_API_TOKEN || process.env.VITE_APIFY_API_TOKEN;
      let prices: FuelPrice[];

      if (apifyToken) {
        try {
          prices = await scrapeWithApify(input.location, input.radiusMiles, apifyToken);
        } catch (err) {
          console.warn("[liveFuel] Apify scrape failed, falling back to mock:", err);
          prices = getMockPrices(input.location, input.radiusMiles);
        }
      } else {
        console.info("[liveFuel] No Apify token — using mock data");
        prices = getMockPrices(input.location, input.radiusMiles);
      }

      // Update cache
      priceCache.set(key, { prices, fetchedAt: Date.now() });
      return { prices, cached: false };
    }),

  /**
   * Get cached prices without triggering a new scrape.
   */
  getCached: publicProcedure
    .input(
      z.object({
        location: z.string().min(1),
        radiusMiles: z.number().min(5).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const key = cacheKey(input.location, input.radiusMiles);
      const cached = priceCache.get(key);
      if (cached) {
        return { prices: cached.prices };
      }
      return { prices: [] };
    }),
});

// ── Apify Scraper ────────────────────────────────────────────────────────────
async function scrapeWithApify(
  location: string,
  radiusMiles: number,
  apiToken: string
): Promise<FuelPrice[]> {
  // Apify fuel prices actor — uses the "johnvc/fuelprices" actor
  const response = await fetch(
    `https://api.apify.com/v2/acts/johnvc~fuelprices/runs?token=${apiToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search: location,
        fuel: 4, // diesel
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Apify API returned ${response.status}`);
  }

  const run = await response.json();
  const runId = run.data?.id;
  if (!runId) throw new Error("No run ID from Apify");

  // Poll for results
  const resultUrl = `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${apiToken}`;
  let attempts = 0;
  while (attempts < 20) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(resultUrl);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.filter((item: any) => item.distance == null || item.distance <= radiusMiles).map((item: any) => ({
          stationName: item.stationName || item.name || "Unknown Station",
          address: item.address || [item.address_line1, item.address_locality, item.address_region].filter(Boolean).join(", "),
          dieselPrice: parseFloat(item.dieselPrice || item.price || item.price_credit || item.price_cash || 0),
          defPrice: item.defPrice ? parseFloat(item.defPrice) : undefined,
          latitude: item.latitude ? parseFloat(item.latitude) : undefined,
          longitude: item.longitude ? parseFloat(item.longitude) : undefined,
          lastUpdated: item.lastUpdated || item.price_credit_postedTime || item.price_cash_postedTime || new Date().toISOString(),
          chain: item.chain || undefined,
        })).filter((p: FuelPrice) => p.dieselPrice > 0);
      }
    }
    attempts++;
  }

  throw new Error("Apify scrape timed out");
}
