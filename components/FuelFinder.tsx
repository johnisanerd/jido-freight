import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import AppLayout from "@/components/AppLayout";
import DashboardHeader from "@/components/DashboardHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Fuel, MapPin, Navigation, Loader2, TrendingDown, Droplets,
  Star, ChevronDown, ChevronUp, DollarSign, Map, ExternalLink,
  Gauge, ArrowRight
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import MapboxMap, { MapboxMarker } from "@/components/MapboxMap";
import { useGeolocation } from "@/hooks/useGeolocation";

// ── Chain definitions ───────────────────────────────────────────────────────
const CHAINS = [
  {
    id: "pilot", name: "Pilot Flying J", shortName: "Pilot",
    keywords: ["pilot", "flying j", "flyingj"],
    color: "#003087", logo: (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#003087] rounded">
        <div className="text-white font-black text-xs leading-none tracking-tight">PILOT</div>
      </div>
    ),
  },
  {
    id: "loves", name: "Love's", shortName: "Love's",
    keywords: ["love's", "loves", "love travel"],
    color: "#e31837", logo: (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#e31837] rounded">
        <div className="text-white font-black">♥</div>
      </div>
    ),
  },
  {
    id: "ta", name: "TA Travel Centers", shortName: "TA",
    keywords: ["ta travel", "travel centers of america", "tca", "ta "],
    color: "#005b96", logo: (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#005b96] rounded">
        <div className="text-white font-black text-xs">TA</div>
      </div>
    ),
  },
  {
    id: "petro", name: "Petro", shortName: "Petro",
    keywords: ["petro"],
    color: "#c8102e", logo: (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#c8102e] rounded">
        <div className="text-white font-black text-[10px]">PETRO</div>
      </div>
    ),
  },
];

function detectChain(name: string) {
  const lower = name.toLowerCase();
  return CHAINS.find((c) => c.keywords.some((k) => lower.includes(k))) ?? null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toFixed(2);

// ── Component ────────────────────────────────────────────────────────────────
export default function FuelFinder() {
  const [, navigate] = useLocation();
  const [radius, setRadius] = useState(100);
  const { geo, coords: currentLocation, retry: retryLocation } = useGeolocation(true);
  const [locationQuery, setLocationQuery] = useState("");
  const [mpg, setMpg] = useState("");
  const [showOtherStops, setShowOtherStops] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const hasAutoSearched = useRef(false);
  const radiusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPricesMutation = trpc.liveFuel.fetchPrices.useMutation({});
  const cachedQuery = trpc.liveFuel.getCached.useQuery(
    { location: locationQuery || "United States", radiusMiles: radius },
    { enabled: !!locationQuery }
  );

  const prices = fetchPricesMutation.data?.prices ?? cachedQuery.data?.prices ?? [];

  const handleRouteHere = (stopName: string, address: string) => {
    navigate(`/navigation?dest=${encodeURIComponent(address || stopName)}`);
  };

  const doSearch = useCallback(
    (query: string, rad: number) => {
      if (!query.trim()) return;
      fetchPricesMutation.mutate({ location: query.trim(), radiusMiles: rad });
    },
    [fetchPricesMutation]
  );

  const handleSearch = useCallback(() => {
    if (!locationQuery.trim()) { toast.error("Enter a city, ZIP, or address"); return; }
    doSearch(locationQuery, radius);
  }, [locationQuery, radius, doSearch]);

  // GPS auto-search (once)
  useEffect(() => {
    if (geo.status === "success" && currentLocation && !hasAutoSearched.current) {
      hasAutoSearched.current = true;
      const coordStr = `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`;
      setLocationQuery(coordStr);
      doSearch(coordStr, radius);
    }
  }, [geo.status, currentLocation, radius, doSearch]);

  // Radius auto-search (debounced)
  useEffect(() => {
    if (!hasAutoSearched.current && !locationQuery) return;
    if (radiusTimer.current) clearTimeout(radiusTimer.current);
    radiusTimer.current = setTimeout(() => {
      doSearch(locationQuery || "United States", radius);
    }, 400);
    return () => { if (radiusTimer.current) clearTimeout(radiusTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  // ── Computed ───────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (!prices.length) return [];
    return [...prices].sort((a, b) => a.dieselPrice - b.dieselPrice);
  }, [prices]);

  const best = sorted[0] ?? null;
  const nextBest = sorted[1] ?? null;
  const worst = sorted[sorted.length - 1] ?? null;

  // How much cheaper is the best vs #2?
  const beat = best && nextBest
    ? (nextBest.dieselPrice - best.dieselPrice).toFixed(2)
    : null;

  // Savings vs the most expensive (150gal tank)
  const maxSave = best && worst
    ? ((worst.dieselPrice - best.dieselPrice) * 150).toFixed(2)
    : null;

  // Per-mile savings with custom MPG
  const customSave = best && worst && mpg
    ? (((worst.dieselPrice - best.dieselPrice) * 500) / Number(mpg)).toFixed(2)
    : null;

  const chain = best ? detectChain(best.stationName) : null;

  // Other stops (excluding the best)
  const otherStops = useMemo(() => sorted.slice(1), [sorted]);

  // Map markers
  const mapMarkers = useMemo<MapboxMarker[]>(() => {
    const m: MapboxMarker[] = [];
    if (currentLocation)
      m.push({ id: "me", lat: currentLocation.lat, lng: currentLocation.lng, icon: "truck", popup: "You" });
    sorted.forEach((s, i) => {
      if (s.latitude && s.longitude)
        m.push({
          id: `f-${i}`, lat: s.latitude, lng: s.longitude,
          icon: "fuel", color: i === 0 ? "#22c55e" : undefined,
          popup: `<b>${s.stationName}</b><br>$${fmt(s.dieselPrice)}/gal`,
        });
    });
    return m;
  }, [currentLocation, sorted]);

  const mapCenter = useMemo<[number, number]>(
    () => currentLocation ? [currentLocation.lng, currentLocation.lat] : [-98.5795, 39.8283],
    [currentLocation?.lat, currentLocation?.lng]
  );

  const isLoading = fetchPricesMutation.isPending;
  const hasPrice = best !== null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <DashboardHeader title="Cheapest Fuel" showNotifications={false} />

      <div className="p-4 space-y-3 pb-24">

        {/* ═══════════════════════════════════════════════════════════════
            SEARCH BAR
           ═══════════════════════════════════════════════════════════════ */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text" placeholder="City, ZIP or address..."
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-8 bg-background border-border text-sm h-10"
            />
          </div>
          <Button onClick={handleSearch} disabled={isLoading} className="bg-accent hover:bg-accent/90 text-white px-4 h-10">
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : "Find"}
          </Button>
        </div>

        {/* GPS status hint */}
        {(!hasPrice || isLoading) && geo.status !== "success" && (
          <p className="text-xs text-muted-foreground text-center">
            {geo.status === "loading" ? "Getting your location..."
             : geo.status === "denied" ? "GPS blocked — enter a location above"
             : geo.status === "unavailable" ? "GPS unavailable"
             : "Enter a city or allow GPS to find the cheapest diesel near you"}
          </p>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            LOADING
           ═══════════════════════════════════════════════════════════════ */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={40} className="animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">Finding the cheapest diesel...</p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            🔥 CHEAPEST FUEL — THE WHOLE PAGE
           ═══════════════════════════════════════════════════════════════ */}
        {!isLoading && hasPrice && (
          <>
            {/* ── THE PRICE ── */}
            <Card className="relative overflow-hidden border-2 border-green-500 shadow-lg shadow-green-500/10 bg-gradient-to-b from-green-500/5 to-transparent">
              {/* Glow badge */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-green-500 via-emerald-400 to-green-500" />

              <div className="p-5 pt-6 text-center">
                {/* Chain logo */}
                {chain && (
                  <div className="w-10 h-10 rounded-lg overflow-hidden mx-auto mb-3 shadow-md">
                    {chain.logo}
                  </div>
                )}

                <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mb-1">
                  Cheapest Diesel
                </p>

                {/* MASSIVE price */}
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-6xl font-black text-green-500 tracking-tight">
                    ${fmt(best.dieselPrice)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">per gallon</p>

                {/* Station name + address */}
                <h2 className="font-bold text-foreground mt-3">{best.stationName}</h2>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-0.5">
                  <MapPin size={10} />
                  {best.address}
                </p>

                {/* DEF */}
                {best.defPrice != null && best.defPrice > 0 && (
                  <div className="inline-flex items-center gap-1 mt-2 text-xs font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/30 px-2.5 py-1 rounded-full">
                    <Droplets size={12} />
                    DEF ${fmt(best.defPrice)}/gal
                  </div>
                )}

                {/* Last updated */}
                {best.lastUpdated && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Updated {new Date(best.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}

                {/* ── ROUTE BUTTON ── */}
                <Button
                  className="w-full mt-4 bg-green-500 hover:bg-green-600 text-white font-bold text-sm h-11"
                  onClick={() => handleRouteHere(best.stationName, best.address)}
                >
                  <Navigation size={16} className="mr-2" />
                  Route to Cheapest Fuel
                </Button>
              </div>
            </Card>

            {/* ── SAVINGS CONTEXT ── */}
            <Card className="p-3 bg-accent/5 border-accent/20">
              <div className="grid grid-cols-2 gap-3 text-center">
                {/* Beats #2 */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Beats #2 by</p>
                  <p className="text-xl font-black text-accent">
                    {beat ? `$${beat}` : "—"}
                  </p>
                  <p className="text-[9px] text-muted-foreground">per gallon</p>
                </div>

                {/* Save per fill */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Save per Fill</p>
                  <p className="text-xl font-black text-accent">
                    {maxSave ? `$${maxSave}` : "—"}
                  </p>
                  <p className="text-[9px] text-muted-foreground">150 gal tank</p>
                </div>
              </div>

              {/* Price range bar */}
              {worst && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>${fmt(best.dieselPrice)} · Cheapest</span>
                    <span>${fmt(worst.dieselPrice)} · Priciest</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 rounded-full"
                      style={{ width: `${((best.dieselPrice - best.dieselPrice) / (worst.dieselPrice - best.dieselPrice || 1)) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-center mt-1">
                    <div
                      className="h-3 w-3 bg-green-500 rounded-full border-2 border-white shadow"
                      style={{ marginLeft: `${((best.dieselPrice - best.dieselPrice) / (worst.dieselPrice - best.dieselPrice || 1)) * 100 - 2}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Custom MPG */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                <Gauge size={12} className="text-muted-foreground" />
                <Input
                  type="number" placeholder="Your MPG (e.g. 6.5)"
                  value={mpg} onChange={(e) => setMpg(e.target.value)}
                  className="flex-1 h-7 text-xs bg-background border-border"
                />
                {customSave && (
                  <span className="text-xs font-bold text-accent whitespace-nowrap">Save ${customSave}/500mi</span>
                )}
              </div>
            </Card>

            {/* ── MAP (collapsed) ── */}
            <button
              onClick={() => setShowMap(!showMap)}
              className="w-full flex items-center justify-between px-3 py-2 bg-card/50 rounded-lg border border-border/50 text-xs text-muted-foreground"
            >
              <span className="flex items-center gap-1.5">
                <Map size={13} />
                {showMap ? "Hide Map" : "Show Map"}
              </span>
              {showMap ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showMap && (
              <div className="w-full h-44 rounded-xl overflow-hidden border border-border shadow-sm">
                <MapboxMap
                  center={mapCenter}
                  zoom={currentLocation ? 10 : 4}
                  markers={mapMarkers}
                  showTraffic={false}
                  className="w-full h-full"
                />
              </div>
            )}

            {/* ── OTHER STOPS (collapsed) ── */}
            {otherStops.length > 0 && (
              <>
                <button
                  onClick={() => setShowOtherStops(!showOtherStops)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-card/50 rounded-lg border border-border/50 text-xs text-muted-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <TrendingDown size={13} />
                    {showOtherStops
                      ? "Hide Other Options"
                      : `${otherStops.length} more stop${otherStops.length !== 1 ? "s" : ""} nearby`}
                  </span>
                  {showOtherStops ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showOtherStops && (
                  <div className="space-y-1.5">
                    {/* Radius adjust */}
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[10px] text-muted-foreground">Radius:</span>
                      <input
                        type="range" min="10" max="250" step="10" value={radius}
                        onChange={(e) => setRadius(Number(e.target.value))}
                        className="flex-1 h-1 bg-background rounded-lg accent-accent"
                      />
                      <span className="text-[10px] font-bold text-accent w-9 text-right">{radius}mi</span>
                    </div>

                    {otherStops.map((s, i) => {
                      const ch = detectChain(s.stationName);
                      const hasDef = s.defPrice != null && s.defPrice > 0;
                      const diff = s.dieselPrice - best.dieselPrice;
                      return (
                        <Card key={i} className="p-2.5 border-border/50">
                          <div className="flex items-center gap-2.5">
                            {/* Rank */}
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-muted text-muted-foreground flex-shrink-0">
                              {i + 2}
                            </span>

                            {/* Logo */}
                            <div className="w-7 h-7 rounded overflow-hidden flex-shrink-0 shadow-sm">
                              {ch ? ch.logo : (
                                <div className="w-full h-full bg-muted flex items-center justify-center">
                                  <Fuel size={12} className="text-muted-foreground" />
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground text-xs truncate">{s.stationName}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{s.address}</p>
                              {hasDef && (
                                <span className="text-[9px] text-blue-500 font-medium flex items-center gap-0.5">
                                  <Droplets size={8} /> DEF ${fmt(s.defPrice!)}
                                </span>
                              )}
                            </div>

                            {/* Price + diff */}
                            <div className="text-right flex-shrink-0">
                              <div className="font-black text-sm text-accent">${fmt(s.dieselPrice)}</div>
                              <div className="text-[9px] text-red-500 font-medium">+${fmt(diff)}</div>
                            </div>

                            {/* Route */}
                            <Button
                              size="sm"
                              className="bg-accent hover:bg-accent/90 text-white h-7 w-7 p-0 flex-shrink-0"
                              onClick={() => handleRouteHere(s.stationName, s.address)}
                            >
                              <Navigation size={11} />
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            IDLE STATE
           ═══════════════════════════════════════════════════════════════ */}
        {!isLoading && !hasPrice && !locationQuery && (
          <div className="text-center py-20">
            <Fuel size={56} className="mx-auto mb-4 text-muted-foreground/20" />
            <h2 className="text-lg font-bold text-foreground">Find the Cheapest Diesel</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Enter a city or allow GPS to instantly find the cheapest diesel near you
            </p>
            {geo.status === "denied" && (
              <Button size="sm" variant="outline" className="mt-4" onClick={retryLocation}>
                <MapPin size={14} className="mr-1" /> Allow GPS
              </Button>
            )}
            <div className="mt-6 flex justify-center gap-4">
              {["Los Angeles", "Dallas", "Chicago", "Atlanta"].map(city => (
                <button
                  key={city}
                  onClick={() => { setLocationQuery(city); doSearch(city, radius); }}
                  className="text-xs text-muted-foreground hover:text-accent underline"
                >
                  {city}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            NO RESULTS
           ═══════════════════════════════════════════════════════════════ */}
        {!isLoading && !hasPrice && locationQuery && (
          <div className="text-center py-16">
            <Fuel size={40} className="mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No fuel stops found</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different location or expand the radius</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
