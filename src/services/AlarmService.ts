
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
        // If we have a cached set of IDs, check against it first
        if (existingIds && existingIds.has(id)) {
            // Logger.info(`[AlarmService] Skipping ${id} - Already set`);
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
              importance: AndroidImportance.DEFAULT, // BUMP to ensure background handling
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
  async cancelAlarmsForPlace(placeId: string) {
    try {
        const triggers = await notifee.getTriggerNotifications();
        const toCancel = triggers
            .filter(tn => tn.notification.id?.startsWith(`place-${placeId}`))
            .map(tn => tn.notification.id as string);

        for (const id of toCancel) {
            await notifee.cancelTriggerNotification(id);
        }
        Logger.info(`[AlarmService] Cancelled ${toCancel.length} alarms for place ${placeId}`);
    } catch (e) {
        Logger.error('[AlarmService] Failed to cancel alarms', e);
    }
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

      // scheduleAlarmsForPlace now handles 48-hour buffer and exists checks efficiently
      await this.scheduleAlarmsForPlace(place);
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

}

export const alarmService = new AlarmService();
