# SFPE — Sensor Fusion Proximity Engine
## Task Tracker | Branch: `feature/sfpe-gps-reduction`

> **How to use this file:**
> - Each task has a `Status`, `Pre-Conditions` (must be true before starting), and `Post-Conditions` (must be verified before marking done).
> - Status values: `PENDING` → `IN PROGRESS` → `AWAITING APPROVAL` → `DONE` / `BLOCKED`
> - User must approve each task before the next one begins.

---

## Phase 1 — Core Dead Reckoning Engine (Post Check-In GPS Elimination)

---

### TASK-01: Create `DeadReckoningService.ts`
**Status:** `PENDING`

**What it does:**
Calculates a new lat/lng coordinate from a known anchor position using step count + compass heading. This is the mathematical core of the entire system.

**Pre-Conditions:**
- [ ] SFPE design document reviewed and approved by user
- [ ] Branch `feature/sfpe-gps-reduction` is active
- [ ] No changes to existing GPS or CheckIn logic in this task

**Deliverables:**
- `src/services/DeadReckoningService.ts`
- Exports: `calculateNewPosition(anchor, steps, heading, strideM)` → `{lat, lng}`
- Exports: `haversineDistance(lat1, lng1, lat2, lng2)` → meters
- Unit-testable pure functions (no React Native dependencies)

**Post-Conditions (Approval Checklist):**
- [ ] Function returns correct lat/lng when given known inputs
- [ ] Haversine distance tested against known coordinate pairs
- [ ] TypeScript compiles with no errors
- [ ] User has reviewed and approved the output

---

### TASK-02: Create `GridEngine.ts`
**Status:** `PENDING`

**What it does:**
Generates a coordinate grid around a mosque's center point. Marks each cell as inside or outside the radius. Determines which cell a given lat/lng falls in.

**Pre-Conditions:**
- [ ] TASK-01 is `DONE`
- [ ] `DeadReckoningService.ts` is importable

**Deliverables:**
- `src/services/GridEngine.ts`
- Exports: `generateGrid(centerLat, centerLng, radiusM, cellSizeM)` → `GridCell[][]`
- Exports: `getCellForPosition(grid, lat, lng)` → `GridCell | null`
- Exports: `isInsideRadius(cell)` → `boolean`

**Post-Conditions (Approval Checklist):**
- [ ] Grid correctly marks cells inside/outside a circle
- [ ] Cell lookup returns correct cell for a given position
- [ ] Edge case: position exactly on boundary handled
- [ ] TypeScript compiles with no errors
- [ ] User has reviewed and approved

---

### TASK-03: Create `MotionClassifier.ts`
**Status:** `PENDING`

**What it does:**
Reads accelerometer and step counter to classify current motion as: `WALKING`, `VEHICLE`, or `STATIONARY`. Determines stride length, and for vehicle mode estimates speed category (bike vs car).

**Pre-Conditions:**
- [ ] TASK-01 is `DONE`
- [ ] `react-native-sensors` is installed and working

**Deliverables:**
- `src/services/MotionClassifier.ts`
- Exports: `classifyMotion(stepDelta, accelMagnitude)` → `MotionState`
- Exports: `getStrideLength(motionState)` → meters
- Types: `MotionState = 'WALKING' | 'VEHICLE_BIKE' | 'VEHICLE_CAR' | 'STATIONARY'`

**Post-Conditions (Approval Checklist):**
- [ ] Walking detected correctly from step delta
- [ ] Stationary detected when steps = 0 and accel is low
- [ ] Vehicle mode detected when steps = 0 and accel shows vibration
- [ ] TypeScript compiles with no errors
- [ ] User has reviewed and approved

---

### TASK-04: Create `AnchorManager.ts`
**Status:** `PENDING`

**What it does:**
Manages the "last known good position" (anchor). Provides anchor from: home place coords → WiFi/cell network fix → GPS (last resort). Triggers re-anchoring every 300m of estimated travel.

**Pre-Conditions:**
- [ ] TASK-01 is `DONE`
- [ ] TASK-03 is `DONE`

**Deliverables:**
- `src/services/AnchorManager.ts`
- Exports: `getInitialAnchor(places)` → `{lat, lng}` (uses home place or saved place nearest to alarm time)
- Exports: `requestNetworkAnchor()` → `Promise<{lat, lng}>` (WiFi/cell, not GPS)
- Exports: `shouldReAnchor(distanceTraveledM)` → `boolean`

**Post-Conditions (Approval Checklist):**
- [ ] Returns home coords when user has a saved home place
- [ ] Network position request uses `enableHighAccuracy: false`
- [ ] Re-anchor triggers at correct distance threshold
- [ ] TypeScript compiles with no errors
- [ ] User has reviewed and approved

---

## Phase 2 — Place Fingerprinting (Auto Floor Detection)

---

### TASK-05: Create `PlaceFingerprinter.ts`
**Status:** `PENDING`

**What it does:**
When a user saves a new place, silently reads barometric pressure and altitude. Stores this as a "floor fingerprint" with the place. Future check-ins compare live sensor readings to this fingerprint to confirm the user is on the correct floor/elevation.

**Pre-Conditions:**
- [ ] Phase 1 (TASK-01 to TASK-04) all `DONE`
- [ ] `react-native-sensors` barometer confirmed working
- [ ] Place add/edit flow identified in codebase

**Deliverables:**
- `src/services/PlaceFingerprinter.ts`
- Exports: `captureFingerprint()` → `Promise<PlaceFingerprint>`
- Exports: `matchesFingerprint(stored, live, toleranceHPa)` → `boolean`
- Type: `PlaceFingerprint = { pressureHPa, altitudeM, capturedAt }`
- Modify: Place save flow to call `captureFingerprint()` automatically

**Post-Conditions (Approval Checklist):**
- [ ] Fingerprint captured silently on place save (no user prompt)
- [ ] Fingerprint match within ±1.5 hPa tolerance
- [ ] Realm schema updated with new fields
- [ ] User has reviewed and approved

---

## Phase 3 — Trail Recording & Session Visualization

---

### TASK-06: Create `TrailRecorder.ts`
**Status:** `PENDING`

**What it does:**
Records every movement update (relative X/Y position, heading, step count, timestamp) during an active session. Stores journey-to-mosque trail and inside-mosque trail separately. Persists to Realm.

**Pre-Conditions:**
- [ ] TASK-01 through TASK-04 all `DONE`
- [ ] Realm schema design approved

**Deliverables:**
- `src/services/TrailRecorder.ts`
- `src/models/SessionTrail.ts` (Realm schema)
- Exports: `startSession(placeId, anchorLat, anchorLng)` → `sessionId`
- Exports: `recordPoint(sessionId, lat, lng, heading, isStationary)`
- Exports: `endSession(sessionId, checkoutReason)`
- Exports: `getSessionTrail(sessionId)` → `SessionTrail`

**Post-Conditions (Approval Checklist):**
- [ ] Points recorded in real time during session
- [ ] Stationary clusters correctly flagged (steps=0 for >2 min)
- [ ] Journey vs indoor points stored separately
- [ ] Session persists correctly to Realm
- [ ] User has reviewed and approved

---

### TASK-07: Build Session Visualization UI
**Status:** `PENDING`

**What it does:**
Displays the recorded trail as a visual 2D path on a custom grid (no map tiles needed). Shows: journey path to mosque, entry point, indoor movement, praying spot (stationary cluster), exit point, plus session stats.

**Pre-Conditions:**
- [ ] TASK-06 is `DONE`
- [ ] At least one real session recorded with trail data

**Deliverables:**
- `src/screens/SessionJourneyScreen.tsx`
- `src/components/TrailCanvas.tsx` (SVG or Canvas-based 2D renderer)
- Session stats card: steps, distance, time inside, stationary duration
- Accessible from place detail or notification history

**Post-Conditions (Approval Checklist):**
- [ ] Path renders correctly from trail data
- [ ] Stationary cluster shown as glowing dot
- [ ] Entry/exit points marked
- [ ] Stats card shows correct values
- [ ] Works with no internet connection (no map tiles)
- [ ] User has visually reviewed and approved the UI

---

## Phase 4 — Integration & GPS Handoff

---

### TASK-08: Integrate SFPE into `CheckInService.ts`
**Status:** `PENDING`

**What it does:**
Wires all SFPE components into the existing check-in/checkout flow. Replaces GPS polling post-check-in with grid monitoring. Adds GPS as last-resort fallback only.

**Pre-Conditions:**
- [ ] TASK-01 through TASK-06 all `DONE`
- [ ] Existing `CheckInService.ts` and `GPSManager.ts` fully understood
- [ ] No regressions in existing alarm/check-in behaviour

**Deliverables:**
- Modify: `src/services/CheckInService.ts`
- Modify: `src/services/GPSManager.ts` (add fallback-only mode)
- Modify: `src/services/LocationService.ts` (use AnchorManager instead of GPS for start)

**Post-Conditions (Approval Checklist):**
- [ ] Check-in triggers correctly via SFPE (no GPS)
- [ ] Checkout triggers when grid boundary crossed
- [ ] Checkout triggers on end time (existing behaviour preserved)
- [ ] GPS fallback activates only when SFPE confidence is low
- [ ] Full end-to-end test: alarm → travel → check-in → inside → checkout
- [ ] User has reviewed logs and approved

---

## Sensor Library Installation

### TASK-00: Install & Verify `react-native-sensors`
**Status:** `PENDING`

**Pre-Conditions:**
- [ ] Branch `feature/sfpe-gps-reduction` is active
- [ ] Current app builds and runs without errors

**Deliverables:**
- `react-native-sensors` installed and linked
- Barometer, Accelerometer, Magnetometer, StepCounter confirmed accessible on test device
- Small test log showing live sensor readings

**Post-Conditions (Approval Checklist):**
- [ ] `npm install react-native-sensors` succeeds
- [ ] Android `build.gradle` permissions updated
- [ ] Live readings confirmed from all 4 sensors on physical device
- [ ] User has approved to proceed

---

## Task Order Summary

```
TASK-00 (Install sensors)
    ↓
TASK-01 (DeadReckoning math)
    ↓
TASK-02 (GridEngine)   TASK-03 (MotionClassifier)   
    ↓                       ↓
TASK-04 (AnchorManager) ←──┘
    ↓
TASK-05 (PlaceFingerprinter)    TASK-06 (TrailRecorder)
    ↓                                   ↓
TASK-08 (CheckInService integration) ←─┘
    ↓
TASK-07 (Visualization UI)  ← last, depends on real data
```
