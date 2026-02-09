
import notifee, {
  AndroidImportance,
  TriggerType,
  AndroidCategory,
  AlarmType,
} from '@notifee/react-native';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';

export const ALARM_ACTIONS = {
  START_MONITORING: 'START_MONITORING',
  START_SILENCE: 'START_SILENCE',
  STOP_SILENCE: 'STOP_SILENCE',
};

class AlarmService {
  /**
   * Schedule individual alarms for all schedules in a place (Next occurrence only)
   * Optimized to schedule only the next upcoming occurrence for each schedule
   */
  async scheduleAlarmsForPlace(place: any) {
    // CRITICAL: Always cancel existing alarms first to ensure clean state
    await this.cancelAlarmsForPlace(place.id);

    if (!place.schedules || place.schedules.length === 0) {
      Logger.info(`[AlarmService] No schedules for ${place.name}, skipping alarm setup`);
      return;
    }

    let alarmsScheduled = 0;
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    
    // Fetch once to minimize system bridge traffic
    const triggerNotifications = await notifee.getTriggerNotifications();
    const existingIds = new Set(triggerNotifications.map(tn => tn.notification.id));

    Logger.info(`[AlarmService] Refreshing 48-hour alarm buffer for ${place.name} (found ${existingIds.size} existing triggers)`);

    // Loop through each user-defined schedule (e.g., 5 prayers)
    for (let i = 0; i < place.schedules.length; i++) {
        // Seed Today
        await this.schedulePrayerSurgically(place, i, now, existingIds);
        // Seed Tomorrow
        await this.schedulePrayerSurgically(place, i, tomorrow, existingIds);
    }
    
    // The original logic for scheduling individual alarms and verification is replaced by the surgical calls.
    // The `alarmsScheduled` variable is no longer directly incremented here.
    // The `verifyScheduledAlarms` call is also removed from here as surgical scheduling handles idempotency.
  }

  /**
   * Helper to schedule a single alarm
   */
  async scheduleSingleAlarm(
      id: string, 
      timestamp: number, 
      placeId: string, 
      action: string,
      title: string, 
      body: string,
      extraData?: object,
      existingIds?: Set<string | undefined>
  ) {
      try {
        // --- CHECK-BEFORE-SET OPTIMIZATION ---
        if (existingIds ? existingIds.has(id) : (await notifee.getTriggerNotifications()).some(tn => tn.notification.id === id)) {
            // Suppress logs for redundant healing checks to keep console clean
            return;
        }

        const isSilent = (extraData as any)?.silent === 'true';
        
        await notifee.createTriggerNotification(
          {
            id,
            title,
            body,
            data: {
              action, // START_MONITORING or START_SILENCE or STOP_SILENCE
              placeId,
              scheduledTime: new Date(timestamp).toISOString(),
              ...extraData
            },
            android: {
              channelId: CONFIG.CHANNELS.ALERTS,
              importance: AndroidImportance.MIN, // CRITICAL: Stop Android from showing trigger preview
              category: AndroidCategory.ALARM,
              groupId: 'com.qybirx.silentzone.group',
              smallIcon: 'ic_launcher',
              largeIcon: 'ic_launcher',
              color: '#8B5CF6',
              autoCancel: true, // Allow user to dismiss
              ongoing: false,   // Don't pin it
              loopSound: false,
              pressAction: {
                id: 'default',
                launchActivity: 'default',
              },
              // CRITICAL: Full screen intent ensures app wakes up even when killed
              fullScreenAction: {
                id: 'default',
                launchActivity: 'default',
              },
            },
          },
          {
            type: TriggerType.TIMESTAMP,
            timestamp,
            alarmManager: {
              allowWhileIdle: true,
              type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
            },
          }
        );
        Logger.info(`[AlarmService] ✅ Alarm set: ${action} @ ${new Date(timestamp).toLocaleTimeString()} (ID: ${id})${isSilent ? ' [SILENT]' : ''}`);
      } catch (error) {
        Logger.error(`[AlarmService] Failed to schedule alarm ${id}:`, error);
      }
  }

  /**
   * Cancel all alarms for a specific place
   */
  async cancelAlarmsForPlace(placeId: string, scheduleCount: number = 10) {
    // Cancel alarms for today (day-0) and tomorrow (day-1) for each schedule index
    for (let i = 0; i < scheduleCount; i++) {
        const types = ['monitor', 'start', 'end'];
        // The IDs now use date string instead of dayOffset
        const today = new Date();
        const tomorrow = new Date(today.getTime() + 86400000);
        const todayStr = today.toISOString().split('T')[0];
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        for (const type of types) {
             const idDay0 = `place-${placeId}-sched-${i}-date-${todayStr}-type-${type}`;
             const idDay1 = `place-${placeId}-sched-${i}-date-${tomorrowStr}-type-${type}`;
             try { await notifee.cancelTriggerNotification(idDay0); } catch (e) {}
             try { await notifee.cancelTriggerNotification(idDay1); } catch (e) {}
        }
    }
    Logger.info(`[AlarmService] Cancelled alarms for place ${placeId}`);
  }

  /**
   * CANCEL surgical triggers for a specific prayer slot
   */
  async cancelPrayerSurgically(placeId: string, prayerIndex: number, date: Date) {
    const dateStr = date.toISOString().split('T')[0];
    const types = ['monitor', 'start', 'end'];
    
    for (const type of types) {
      const id = `place-${placeId}-sched-${prayerIndex}-date-${dateStr}-type-${type}`;
      try {
        await notifee.cancelTriggerNotification(id);
      } catch (e) {}
    }
  }

  /**
   * SCHEDULE surgical triggers for a specific prayer slot
   * Sets T-15 (Notify), T-5 (Monitor), and End-time (Cleanup)
   */
  async schedulePrayerSurgically(place: any, prayerIndex: number, targetDate: Date, existingIds?: Set<string | undefined>) {
    const schedule = place.schedules[prayerIndex];
    if (!schedule) return;

    const [startHour, startMin] = schedule.startTime.split(':').map(Number);
    const [endHour, endMin] = schedule.endTime.split(':').map(Number);

    // 1. Calculate the exact times for THIS target date
    const startTime = new Date(targetDate);
    startTime.setHours(startHour, startMin, 0, 0);

    const endTime = new Date(startTime);
    // If end time is before start time, it's an overnight schedule (e.g. 23:00 to 01:00)
    const endTotal = endHour * 60 + endMin;
    const startTotal = startHour * 60 + startMin;
    
    endTime.setHours(endHour, endMin, 0, 0);
    if (endTotal < startTotal) {
      endTime.setDate(endTime.getDate() + 1);
    }

    const dateStr = targetDate.toISOString().split('T')[0]; // Use date string for ID
    const alarmBaseData = {
      placeId: place.id,
      prayerIndex,
      dateStr,
    };

    // --- TRIGGER 1: NOTIFY (T-15) ---
    const notifyTime = startTime.getTime() - (15 * 60 * 1000);
    if (notifyTime > Date.now()) {
      await this.scheduleSingleAlarm(
        `place-${place.id}-sched-${prayerIndex}-date-${dateStr}-type-monitor`,
        notifyTime,
        place.id,
        ALARM_ACTIONS.START_MONITORING,
        'Location Monitoring',
        '', // Suppress body
        { ...alarmBaseData, subType: 'notify', silent: 'true' },
        existingIds
      );
    }

    // --- TRIGGER 2: MONITOR START (T-5) ---
    const monitorStartTime = startTime.getTime() - (5 * 60 * 1000);
    if (monitorStartTime > Date.now()) {
      await this.scheduleSingleAlarm(
        `place-${place.id}-sched-${prayerIndex}-date-${dateStr}-type-start`,
        monitorStartTime,
        place.id,
        ALARM_ACTIONS.START_SILENCE,
        'Start Monitoring', // Silent
        'Geofencing going to start', // Silent
        { ...alarmBaseData, subType: 'monitor', silent: 'true' },
        existingIds
      );
    }

    // --- TRIGGER 3: END & HEAL (End Time) ---
    if (endTime.getTime() > Date.now()) {
      await this.scheduleSingleAlarm(
        `place-${place.id}-sched-${prayerIndex}-date-${dateStr}-type-end`,
        endTime.getTime(),
        place.id,
        ALARM_ACTIONS.STOP_SILENCE,
        'End Monitoring', // Silent
        'Geofencing going to end', // Silent
        { ...alarmBaseData, subType: 'cleanup', silent: 'true' },
        existingIds
      );
    }

    Logger.info(`[AlarmService] Surgical setup for ${place.name} (interval #${prayerIndex}) for ${targetDate.toLocaleDateString()}`);
  }

  /**
   * GAP-FILLING RESTORE (For Reboots)
   * Only sets what is needed based on current time.
   */
  async restoreGapsOnBoot(places: any[]) {
  if (places.length === 0) return;
  
  try {
    const existingNotifications = await notifee.getTriggerNotifications();
    const existingIds = new Set(existingNotifications.map(tn => tn.notification.id));
    
    Logger.info(`[AlarmService] Gap-filling restore: Found ${existingIds.size} existing triggers`);
    const now = new Date();

    for (const place of places) {
      if (!place.isEnabled || !place.schedules) continue;

      for (let i = 0; i < place.schedules.length; i++) {
        const schedule = place.schedules[i];
        const [endHour, endMin] = schedule.endTime.split(':').map(Number);
        
        // Use today's date for comparison
        const todayEnd = new Date(now);
        todayEnd.setHours(endHour, endMin, 0, 0);
        
        // Handle overnight end time
        const [startHour, startMin] = schedule.startTime.split(':').map(Number);
        if ((endHour * 60 + endMin) < (startHour * 60 + startMin)) {
          todayEnd.setDate(todayEnd.getDate() + 1);
        }

        const isToday = todayEnd.getTime() > now.getTime();
        const targetDate = isToday ? now : new Date(now.getTime() + 86400000); // 86400000 ms = 1 day
        const dayOffset = isToday ? 0 : 1;

        // CRITICAL CHECK: Does this prayer slot already have its core alarms?
        // We check for the 'end' type alarm as it's the anchor for the cycle.
        const endAlarmId = `place-${place.id}-sched-${i}-day-${dayOffset}-type-end`;
        
        if (existingIds.has(endAlarmId)) {
          Logger.info(`[Restore] Skipping ${place.name} (#${i}) - Alarms already present for ${isToday ? 'TODAY' : 'TOMORROW'}`);
          continue;
        }

        Logger.info(`[Restore] Scheduling ${place.name} (#${i}) for ${isToday ? 'TODAY' : 'TOMORROW'}`);
        await this.schedulePrayerSurgically(place, i, targetDate);
      }
    }
  } catch (error) {
    Logger.error('[AlarmService] Gap-filling failed:', error);
  }
}

  private isTomorrow(date: Date): boolean {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return date.getDate() === tomorrow.getDate() && 
           date.getMonth() === tomorrow.getMonth() && 
           date.getFullYear() === tomorrow.getFullYear();
  }

  /**
   * Verify that alarms were successfully scheduled
   * 
   * Returns: { verified: number, missing: number, total: number }
   */
  async verifyScheduledAlarms(
    expectedAlarmIds: string[]
  ): Promise<{ verified: number; missing: number; total: number; missingIds: string[] }> {
    
    if (expectedAlarmIds.length === 0) {
      return { verified: 0, missing: 0, total: 0, missingIds: [] };
    }
    
    try {
      Logger.info(`[Alarm Verify] Checking ${expectedAlarmIds.length} scheduled alarms...`);
      
      // Get all trigger notifications from the system
      const triggerNotifications = await notifee.getTriggerNotifications();
      const scheduledIds = new Set(triggerNotifications.map(tn => tn.notification.id));
      
      // Check which expected alarms are actually scheduled
      const missingIds: string[] = [];
      let verified = 0;
      
      for (const expectedId of expectedAlarmIds) {
        if (scheduledIds.has(expectedId)) {
          verified++;
        } else {
          missingIds.push(expectedId);
        }
      }
      
      const missing = missingIds.length;
      const total = expectedAlarmIds.length;
      
      if (missing === 0) {
        Logger.info(`[Alarm Verify] ✅ All ${total} alarms verified successfully`);
      } else {
        Logger.error(
          `[Alarm Verify] ❌ ${missing}/${total} alarms missing:`,
          missingIds
        );
        
        // Log details about what's missing
        missingIds.forEach(id => {
          Logger.error(`  └─ Missing: ${id}`);
        });
      }
      
      return { verified, missing, total, missingIds };
      
    } catch (error) {
      Logger.error('[Alarm Verify] Failed to verify alarms:', error);
      
      // Return pessimistic result on error
      return {
        verified: 0,
        missing: expectedAlarmIds.length,
        total: expectedAlarmIds.length,
        missingIds: expectedAlarmIds
      };
    }
  }

  /**
   * Get detailed alarm status for diagnostics
   */
  async getAlarmDiagnostics(): Promise<{
    totalScheduled: number;
    nextAlarmTime: Date | null;
    alarmIds: string[];
  }> {
    try {
      const triggerNotifications = await notifee.getTriggerNotifications();

      let nextAlarmTime: Date | null = null;
      const alarmIds: string[] = [];

      for (const tn of triggerNotifications) {
        alarmIds.push(tn.notification.id || 'unknown');

        // Find earliest alarm
        if (tn.trigger && 'timestamp' in tn.trigger) {
          const alarmTime = new Date(tn.trigger.timestamp);
          if (!nextAlarmTime || alarmTime < nextAlarmTime) {
            nextAlarmTime = alarmTime;
          }
        }
      }

      return {
        totalScheduled: triggerNotifications.length,
        nextAlarmTime,
        alarmIds
      };

    } catch (error) {
      Logger.error('[Alarm Diagnostics] Failed:', error);
      return { totalScheduled: 0, nextAlarmTime: null, alarmIds: [] };
    }
  }

  /**
   * Calculate the next occurrence of a schedule
   * Returns the next start and end times, or null if no future occurrence
   */
  private getNextScheduleOccurrence(
    now: Date,
    startHour: number,
    startMin: number,
    endHour: number,
    endMin: number
  ): { startTime: Date; endTime: Date; dayOffset: number } | null {
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const currentTotal = currentHour * 60 + currentMin;
    const startTotal = startHour * 60 + startMin;
    const endTotal = endHour * 60 + endMin;

    // Check if schedule is currently active (we're between start and end time)
    let isCurrentlyActive = false;
    if (endTotal >= startTotal) {
      // Normal schedule (e.g., 17:35 to 17:56)
      isCurrentlyActive = currentTotal >= startTotal && currentTotal < endTotal;
    } else {
      // Overnight schedule (e.g., 23:00 to 01:00)
      isCurrentlyActive = currentTotal >= startTotal || currentTotal < endTotal;
    }

    // If currently active, the "next" occurrence is actually the current one
    if (isCurrentlyActive) {
      const startTime = new Date(now);
      startTime.setHours(startHour, startMin, 0, 0);

      // If start time is later today, it means we crossed midnight for overnight schedule
      if (endTotal < startTotal && currentTotal < endTotal) {
        startTime.setDate(startTime.getDate() - 1);
      }

      const endTime = new Date(startTime);
      if (endTotal >= startTotal) {
        endTime.setHours(endHour, endMin, 0, 0);
      } else {
        // Overnight: end time is tomorrow
        endTime.setDate(endTime.getDate() + 1);
        endTime.setHours(endHour, endMin, 0, 0);
      }

      return { startTime, endTime, dayOffset: 0 };
    }

    // Check if schedule starts later today
    if (startTotal > currentTotal) {
      const startTime = new Date(now);
      startTime.setHours(startHour, startMin, 0, 0);

      const endTime = new Date(startTime);
      if (endTotal >= startTotal) {
        endTime.setHours(endHour, endMin, 0, 0);
      } else {
        // Overnight: end time is tomorrow
        endTime.setDate(endTime.getDate() + 1);
        endTime.setHours(endHour, endMin, 0, 0);
      }

      return { startTime, endTime, dayOffset: 0 };
    }

    // Schedule already passed today, return tomorrow's occurrence
    const startTime = new Date(now);
    startTime.setDate(startTime.getDate() + 1);
    startTime.setHours(startHour, startMin, 0, 0);

    const endTime = new Date(startTime);
    if (endTotal >= startTotal) {
      endTime.setHours(endHour, endMin, 0, 0);
    } else {
      // Overnight: end time is the day after start
      endTime.setDate(endTime.getDate() + 1);
      endTime.setHours(endHour, endMin, 0, 0);
    }

    return { startTime, endTime, dayOffset: 1 };
  }
}

export const alarmService = new AlarmService();
