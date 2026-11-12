import { describe, expect, it } from "vitest";
import {
  PresenceTracker,
  checkLoad,
  decideArrival,
  decideDeparture,
  distanceM,
  normalizeEpc,
  type EngineContext,
  type EngineParcel,
} from "./verification";

const HUB = { lat: 28.5011, lng: 77.0838 };
const STOP_A = { lat: 28.4950, lng: 77.0890 }; // Cyber City
const STOP_B = { lat: 28.4683, lng: 77.0645 }; // Sector 29

function parcel(id: string, over: Partial<EngineParcel> = {}): EngineParcel {
  return {
    id,
    epc: `E2801170000002${id.padStart(10, "0")}`.slice(0, 24).toUpperCase(),
    trackingId: `SRG-${id}`,
    vehicleId: "VAN-01",
    routeId: "R1",
    status: "assigned",
    inVehicleId: null,
    ...STOP_A,
    ...over,
  };
}

function ctx(parcels: EngineParcel[], over: Partial<EngineContext> = {}): EngineContext {
  return {
    vehicleId: "VAN-01",
    routeStatus: "loading",
    location: HUB,
    parcelsByEpc: new Map(parcels.map((p) => [p.epc, p])),
    geofenceM: 150,
    ...over,
  };
}

describe("distanceM", () => {
  it("is ~0 for identical points and symmetric", () => {
    expect(distanceM(HUB, HUB)).toBeCloseTo(0, 5);
    expect(distanceM(HUB, STOP_A)).toBeCloseTo(distanceM(STOP_A, HUB), 6);
  });
  it("matches a known distance within 1%", () => {
    // ~0.01 deg latitude ≈ 1112 m
    const d = distanceM({ lat: 28.5, lng: 77 }, { lat: 28.51, lng: 77 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1124);
  });
});

describe("PresenceTracker", () => {
  it("debounces read misses shorter than the absence timeout", () => {
    const t = new PresenceTracker(5000);
    expect(t.ingest(["e2 80 aa"], 0).arrived).toEqual(["E280AA"]);
    expect(t.ingest([], 3000).departed).toEqual([]);
    expect(t.ingest(["E280AA"], 4000).arrived).toEqual([]);
    expect(t.ingest([], 8000).departed).toEqual([]);
    expect(t.ingest([], 9001).departed).toEqual([{ epc: "E280AA", lastSeen: 4000 }]);
    expect(t.present()).toEqual([]);
  });
});

describe("decideArrival", () => {
  it("marks an assigned parcel as loaded", () => {
    const p = parcel("1");
    expect(decideArrival(p.epc, ctx([p]), 1)[0].kind).toBe("loaded");
  });
  it("flags a parcel assigned to another vehicle", () => {
    const p = parcel("2", { vehicleId: "VAN-02" });
    expect(decideArrival(p.epc, ctx([p]), 1)[0].kind).toBe("wrong_vehicle");
  });
  it("flags unknown tags", () => {
    expect(decideArrival("DEADBEEF", ctx([]), 1)[0].kind).toBe("unknown_tag");
  });
  it("flags a delivered parcel that is still in the cargo", () => {
    const p = parcel("3", { status: "delivered" });
    expect(decideArrival(p.epc, ctx([p]), 1)[0].kind).toBe("delivered_but_present");
  });
  it("re-detects a parcel that was flagged as removed", () => {
    const p = parcel("4", { status: "exception" });
    expect(decideArrival(p.epc, ctx([p]), 1)[0].kind).toBe("redetected");
  });
});

describe("decideDeparture", () => {
  it("treats removal before the route starts as a normal hub unload", () => {
    const p = parcel("5", { status: "loaded", inVehicleId: "VAN-01" });
    expect(decideDeparture(p.epc, 0, ctx([p]), 1)[0].kind).toBe("unloaded_at_hub");
  });
  it("accepts removal inside the parcel's own destination geofence", () => {
    const p = parcel("6", { status: "in_transit", inVehicleId: "VAN-01" });
    const near = { lat: STOP_A.lat + 0.0005, lng: STOP_A.lng }; // ~55 m
    const d = decideDeparture(p.epc, 0, ctx([p], { routeStatus: "in_progress", location: near }), 1);
    expect(d[0].kind).toBe("left_at_stop");
  });
  it("raises unauthorized removal away from any stop", () => {
    const p = parcel("7", { status: "in_transit", inVehicleId: "VAN-01" });
    const d = decideDeparture(p.epc, 0, ctx([p], { routeStatus: "in_progress", location: HUB }), 1);
    expect(d[0].kind).toBe("unauthorized_removal");
  });
  it("detects a parcel dropped at another customer's stop", () => {
    const a = parcel("8", { status: "in_transit", ...STOP_A });
    const b = parcel("9", { status: "in_transit", ...STOP_B });
    const d = decideDeparture(a.epc, 0, ctx([a, b], { routeStatus: "in_progress", location: STOP_B }), 1, [a, b]);
    expect(d[0].kind).toBe("wrong_stop");
  });
  it("clears a foreign parcel when it leaves", () => {
    const p = parcel("10", { vehicleId: "VAN-03" });
    expect(decideDeparture(p.epc, 0, ctx([p]), 1)[0].kind).toBe("wrong_vehicle_cleared");
  });
});

describe("checkLoad", () => {
  it("reports missing and extra tags", () => {
    const a = parcel("11");
    const b = parcel("12");
    const r = checkLoad([a, b], [a.epc, "ABCDEF"]);
    expect(r.missing.map((p) => p.id)).toEqual(["12"]);
    expect(r.extraEpcs).toEqual(["ABCDEF"]);
    expect(r.passed).toBe(false);
    expect(r.rate).toBe(50);
  });
  it("passes when everything is present and ignores delivered parcels", () => {
    const a = parcel("13");
    const b = parcel("14", { status: "delivered" });
    const r = checkLoad([a, b], [normalizeEpc(a.epc.toLowerCase())]);
    expect(r.passed).toBe(true);
    expect(r.expected).toBe(1);
  });
});
