# Real-Device Testing Plan: Native Alarm Chaining

To ensure the new "Native Chaining" architecture is working perfectly on your device, please follow these four testing scenarios.

## 🛠️ Step 1: Preparation
1.  Open **Settings** in the app.
2.  Ensure **"Enable Persistent Logs"** is toggled **ON**.
3.  Go to the **Info** (or Debug) screen and open **Log Viewer**.
4.  Tap **"Clear Logs"** to start with a fresh slate.

---

## 🧪 Scenario A: The "Early Bird" (Future Scheduling)
*Goal: Verify that tomorrow's alarm is correctly queued when today's prayers are over.*
1.  Add a new Place (or edit an existing one).
2.  Set a schedule for a time that has **already passed today** (e.g., if it's 23:00, set it for 12:00-13:00).
3.  **Check Logs**: Look for a line like:  
    `[AlarmService] ⏰ Set START_SILENCE for [Tomorrow's Date] at 11:50 AM`
4.  **Verification**: This confirms the app skipped today and correctly looked ahead to tomorrow.

---

## 🧪 Scenario B: The "Late Comer" (Ongoing Session)
*Goal: Verify immediate activation if joining mid-prayer.*
1.  Create a schedule that is **currently active** (e.g., if it's 14:00 now, set it for 13:30 - 14:30).
2.  **Observation**: 
    *   The phone should silence **immediately**.
    *   The Foreground Notification should change to: `📍 Inside [Place Name]`.
3.  **Check Logs**: Look for:
    *   `[LocationService] 🚀 Sync detected ongoing session for [Place]`.
    *   `[AlarmService] ⏰ Set STOP_SILENCE for [Today's Date] at 2:30 PM`.

---

## 🧪 Scenario C: The "Survivor" (Reboot Persistence)
*Goal: Verify the app resumes itself after a phone restart.*
1.  Ensure you have at least one active place with a schedule.
2.  **Restart your phone**.
3.  Unlock the phone and wait 1-2 minutes.
4.  **Verification**: 
    *   You should see a notification: `🛡️ Silent Zone Running`.
    *   Check Logs for: `[Dispatcher] 🔄 System Rebooted. Restoring engine...`.

---

## 🧪 Scenario D: The "Daisy Chain" (Self-Healing)
*Goal: Verify that firing one alarm always schedules the next.*
1.  Set a schedule to **end** in 2 minutes (e.g., if it's 14:00, set end to 14:02).
2.  Wait for the end time.
3.  **Check Logs**: After the "Stopping Silence" log, you should immediately see:
    `[LocationService] 🔄 Alarm Fired. Re-seeding chain...`  
    followed by a new `Set START_SILENCE` for tomorrow.

---

## 📤 How to share logs with me
If any of these fail or if you want me to audit the behavior:
1.  Open the **Log Viewer** in the app.
2.  Tap the **Share/Export** icon (usually in the top right).
3.  Copy the text or share it to your email, then paste the relevant parts here in our chat.
