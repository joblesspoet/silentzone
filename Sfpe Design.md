# Sensor Fusion Proximity Engine (SFPE)
### Design Document — SilentZone GPS Reduction Feature

---

## What Problem Does This Solve?

SilentZone currently relies on continuous GPS polling to detect when a user enters or exits a mosque's geofence. GPS is power-hungry, slow to acquire indoors, and unnecessary once a user is in a known state. The SFPE replaces all mid-journey and post-check-in GPS with on-device sensors (step counter, magnetometer, barometer), using GPS or WiFi positioning only as an **occasional anchor**.

---

## Does It Actually Work? — The Honest Answer

Yes — **with the right expectations per scenario.** The table below shows exactly when GPS is needed:

| Moment | GPS Needed? | Alternative |
|--------|-------------|-------------|
| App first launch / onboarding | ✅ Once (existing) | — |
| Alarm fires, tracking begins | ❌ | Use home/office saved coords as anchor |
| User traveling to mosque | ❌ mostly | Dead reckoning from anchor |
| Check-in confirmation | ⚠️ WiFi/cell only | One low-cost network position fix |
| User inside mosque | ❌ | Grid + sensors |
| Checkout (exit or end time) | ❌ | Grid boundary or alarm |

> **Verdict:** GPS is reduced to zero for most sessions. A single WiFi/cell network position is used to confirm check-in in ambiguous cases (not GPS satellite — instant & free on battery).

---

## Use Case 1: User Near Mosque (≤ 500m)

This is the **ideal case** and most common for daily prayers.

```
ALARM FIRES (prayer in 30 mins)
        │
        ▼
Anchor = Home coordinates (already stored in Realm)
        │
        ▼
User walks → Step counter counts steps + Magnetometer gives heading
        │
   Every 30 steps:
   new_position = anchor + (steps × 0.75m × heading_vector)
        │
   distance_to_mosque ≤ radius?
        │
   YES →  WiFi/Cell quick confirm (20-50m accuracy, ~0ms battery) → CHECK IN ✅
        │
   INSIDE MOSQUE:
   Grid monitors movement → EXIT grid → CHECKOUT 🚪
```

**Does WiFi positioning work for check-in confirmation?**
Yes. Android's network location provider (NOT GPS) gives 20-50m accuracy instantly using nearby WiFi access points and cell towers. At a mosque with radius ≥ 75m, this is more than enough to confirm presence.

**GPS dependency: ZERO in ideal case.**

---

## Use Case 2: User Far Away (> 500m, walking)

Dead reckoning drift compounds over distance. Strategy: use **WiFi/cell re-anchoring** at waypoints.

```
Home anchor (0m)
     │
     ├── Dead reckoning: 0–300m  (drift ≤ 5m, fine)
     │
WiFi/Cell re-anchor at ~300m         ← instant, free on battery
     │
     ├── Dead reckoning: 300–600m
     │
WiFi/Cell re-anchor at ~600m
     │
     └── Entering mosque radius → check-in ✅
```

**Re-anchor trigger:** Every 300m of estimated travel (step count × stride), request one network position. Not GPS — just WiFi/cell. Takes < 1 second, uses no satellite power.

**GPS dependency: ZERO. Network positioning used every ~300m.**

---

## Use Case 3: User Traveling by Vehicle (Bike or Car)

Step counter will read near-zero while in a vehicle. The system detects this:

```
MotionClassifier:
  steps_per_second ≈ 0  AND  accelerometer shows vibration pattern
        │
        ▼
  MODE = VEHICLE
        │
  Use time × estimated speed to project distance:
  Bike ≈ 15 km/h, Car ≈ 40 km/h
        │
  WiFi/Cell re-anchor every ~300m estimated distance
        │
  Within mosque radius → request ONE WiFi/cell confirm → CHECK IN ✅
```

**Note:** Vehicle mode relies more heavily on periodic WiFi/cell fixes since step-based dead reckoning doesn't apply. Still no GPS.

---

## Use Case 4: Mosque on a Different Floor (Indoor)

When a mosque is inside an office building on a specific floor, horizontal geofencing alone is not enough. The barometer solves this.

```
Place model includes:
{
  radius: 50,         // horizontal (same as outdoor)
  floor: 3,           // target floor number
  floorPressure: 1011.30  // barometric pressure at that floor
                          // (calibrated once when user first visits)
}

CHECK-IN = horizontal within radius  AND  barometer ≈ floorPressure (±1.5 hPa)
```

**Floor calibration:** First time user visits, app asks "Are you at the prayer area now?" → records barometer reading → saved forever.

**After that:** Zero GPS. Barometer + horizontal proximity = complete check-in signal.

---

## Feature 3: Full Session Visualization

This is the most exciting user-facing feature. Every prayer session is recorded as a visual journey:

### What Gets Recorded
```typescript
interface SessionTrail {
  sessionId: string;
  placeId: string;
  
  // Journey to mosque
  journeyPoints: TrailPoint[];    // from home → mosque entry
  
  // Inside mosque
  indoorPoints: TrailPoint[];     // movement inside radius
  
  timestamps: {
    alarmFired: Date;
    journeyStarted: Date;
    checkedIn: Date;
    checkedOut: Date;
  };
  
  stats: {
    totalStepsToMosque: number;
    totalDistanceMeters: number;
    timeInsideMosque: number;      // minutes
    transportMode: 'walk' | 'bike' | 'car';
    stationaryDuration: number;    // minutes spent still (praying)
  };
}

interface TrailPoint {
  relX: number;       // meters east/west from anchor
  relY: number;       // meters north/south from anchor
  heading: number;    // degrees
  stepCount: number;
  timestamp: Date;
  isStationary: boolean;
}
```

### What the User Sees

```
┌──────────────────────────────────────────┐
│  Friday Prayer — Feb 21, 2026            │
│  Fajr • 05:32 AM                        │
├──────────────────────────────────────────┤
│                                          │
│  [Journey Map: relative 2D path]         │
│                                          │
│  🏠 ─────────────────────── 🕌          │
│     ╰──╮  ╭────────╮                    │  ← path taken
│        ╰──╯        ╰───────►            │
│                          ↑              │
│                     [check-in]          │
│                                         │
│  Inside Mosque:                         │
│         ●●●●                            │  ← glowing stationary
│        ●   ●                            │     cluster = praying spot
│        ●●●●                             │
│                                         │
├──────────────────────────────────────────┤
│  📍 367 steps  •  275m  •  8 min walk  │
│  🕌 Inside 42 min  •  🚶 Stationary 38 min │
│  🚀 Checkout: walked out north exit     │
└──────────────────────────────────────────┘
```

**Key insight:** The visualization is in **relative coordinates** — not a real map. It's a grid showing *movement relative to the entry point*. No internet, no map tiles, no GPS needed to render it.

---

## Architecture: SFPE Components

```
┌──────────────────────────────────────────────────────┐
│              SFPE (Sensor Fusion Proximity Engine)    │
│                                                       │
│  ┌─────────────────┐    ┌──────────────────────────┐ │
│  │  AnchorManager  │    │    MotionClassifier       │ │
│  │  (home/WiFi/GPS)│    │  (walk/bike/car/still)   │ │
│  └────────┬────────┘    └─────────────┬────────────┘ │
│           │                           │               │
│  ┌────────▼───────────────────────────▼────────────┐ │
│  │              PositionEstimator                   │ │
│  │  anchor + (steps × stride × heading) = new pos  │ │
│  └───────────────────────┬──────────────────────────┘ │
│                          │                            │
│           ┌──────────────┼──────────────┐            │
│           │              │              │            │
│  ┌────────▼───┐  ┌───────▼─────┐  ┌────▼──────────┐ │
│  │ GridEngine │  │FloorDetector│  │ TrailRecorder │ │
│  │(inside?    │  │(barometer   │  │(stores path   │ │
│  │ exit?)     │  │ floor match)│  │ for display)  │ │
│  └────────────┘  └─────────────┘  └───────────────┘ │
│                          │                            │
│  ┌───────────────────────▼──────────────────────────┐ │
│  │              ProximityDecider                     │ │
│  │    horizontal ✓  +  floor ✓  =  CHECK IN/OUT    │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## GPS Dependency Summary

| Scenario | GPS Used | Network Pos Used | Sensors Used |
|----------|----------|-----------------|--------------|
| Near mosque (≤500m walk) | ❌ Never | Once at check-in | ✅ Always |
| Far mosque (>500m walk) | ❌ Never | Every ~300m travel | ✅ Always |
| Vehicle travel | ❌ Never | Every ~300m travel | ✅ Accel/magneto |
| Indoor/multi-floor | ❌ Never | Once at check-in | ✅ Barometer |
| GPS fallback (all fails) | ✅ Last resort | — | — |

> **Battery impact:** Network positioning uses ~2% of GPS battery cost. Sensor reads (step counter, magnetometer) use ~5-10% of GPS battery cost. This feature could reduce total location-related battery drain by **85-90%**.

---

## Data Model Changes

### New: `SessionTrail` (new Realm schema)
Stores the complete journey + indoor movement per session.

### Modified: `Place`
Add optional `floor`, `floorPressure`, `radius` (if not already stored).

### New: `SFPEConfig` (app preferences)
```typescript
{
  reAnchorEveryMeters: 300,     // how often to request network fix
  gridCellSizeMeters: 5,        // resolution of indoor grid
  strideLength: 0.75,           // meters per step (tunable per user)
  vehicleSpeedWalk: 1.5,        // m/s threshold to distinguish walk
  vehicleSpeedBike: 4.0,        // m/s threshold to distinguish bike
}
```

---

## What We Are NOT Doing

- ❌ Building a full INS (too expensive, ship-grade hardware)
- ❌ Replacing GPS for long outdoor navigation (too much drift)
- ❌ Continuous sensor polling in background (kills battery — we use periodic reads)
- ❌ Removing GPS from the codebase entirely (it stays as the last fallback)

---

## Recommended Implementation Order

1. **Phase 1 — Core Engine:** `DeadReckoningService.ts` + `GridEngine.ts`  
   → Replaces post-check-in GPS polling immediately. Low risk, highest impact.

2. **Phase 2 — Pre Check-In Tracking:** `MotionClassifier.ts` + `AnchorManager.ts`  
   → Replaces pre-check-in GPS scanning. Medium complexity.

3. **Phase 3 — Indoor Support:** `FloorDetector.ts` (barometer)  
   → Handles office/building mosque use case. Low risk, requires user calibration UX.

4. **Phase 4 — Visualization:** `TrailRecorder.ts` + Session Journey UI  
   → The wow feature. Built last because it depends on Phase 1 & 2 data.
