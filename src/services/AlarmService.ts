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
  STRICT_START: 'STRICT_START',
};

class AlarmService {
  /**
   * Schedule individual alarms for all schedules in a place (Next occurrence only)
   * SMART MODE: Only creates missing alarms, doesn't reset existing ones unless forced
   * 
   * @param place - The place object with schedules
   * @param forceReset - If true, cancels all existing alarms and recreates them (for updates)
   *                     If false, only creates missing alarms (for new places or boot restore)
   */
  async scheduleAlarmsForPlace(place: any, forceReset: boolean = false) {
    if (!place.schedules || place.schedules.length === 0) {
      Logger.info(`[AlarmService] No schedules for ${place.name}, skipping alarm setup`);
      return;
    }

    // Step 1: Fetch existing alarms FIRST (before any cancellation)
    const triggerNotifications = await notifee.getTriggerNotifications();
    const existingIds = new Set(triggerNotifications.map(tn => tn.notification.id));
    
    // Step 2: Only cancel if forced (e.g., place update/delete)
    if (forceReset) {
      await this.cancelAlarmsForPlace(place.id);
      existingIds.clear(); // Clear the set since we just deleted everything
      Logger.info(`[AlarmService] 🔄 Force reset alarms for ${place.name}`);
    }

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    const dayAfter = new Date(now.getTime() + 86400000 * 2);
    
    Logger.info(
      `[AlarmService] ${forceReset ? 'Creating' : 'Verifying'} 72-hour rolling buffer for ${place.name} ` +
      `(${existingIds.size} existing triggers)`
    );

    // Step 3: Surgically schedule (will skip existing IDs via check-before-set)
    // We check 3 days (Today, Tomorrow, DayAfter) to ensure we ALWAYS have 
    // at least 48 hours of FUTURE alarms scheduled at any given time.
    for (let i = 0; i < place.schedules.length; i++) {
      await this.schedulePrayerSurgically(place, i, now, existingIds);
      await this.schedulePrayerSurgically(place, i, tomorrow, existingIds);
      await this.schedulePrayerSurgically(place, i, dayAfter, existingIds);
    }
    
    Logger.info(`[AlarmService] ✅ Alarm scheduling complete for ${place.name}`);
  }

  /**
   * Helper to schedule a single alarm
   * NOTE: Caller must check if alarm exists before calling
   */
  async scheduleSingleAlarm(
      id: string, 
      timestamp: number, 
      placeId: string, 
      action: string,
      extraData?: object
  ) {
      try {
        await notifee.createTriggerNotification(
          {
            id,
            title: 'Silent Zone Engine',
            body: action === 'monitor' ? 'Optimizing location sync...' : 
                  action === 'start' ? 'Verifying check-in status...' : 
                  'Finalizing background session...',
            android: {
              channelId: CONFIG.CHANNELS.TRIGGERS,
              importance: AndroidImportance.MIN,
              category: AndroidCategory.ALARM,
              groupId: 'com.qybirx.silentzone.group',
              smallIcon: 'ic_launcher',
              color: '#8B5CF6',
              pressAction: { id: 'default', launchActivity: 'default' },
            },
            data: {
              action,
              placeId,
              scheduledTime: new Date(timestamp).toISOString(),
              ...extraData
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
        Logger.info(`[AlarmService] ✅ Created: ${action} @ ${new Date(timestamp).toLocaleTimeString()} (ID: ${id})`);
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
   * Surgically schedule alarms for a specific prayer time
   * SMART: Skips if alarm already exists (unless forceReset was used)
   */
  // In AlarmService.ts
  private async schedulePrayerSurgically(
    place: any, 
    scheduleIndex: number, 
    baseDate: Date,
    existingIds: Set<string | undefined>
  ) {
    const schedule = place.schedules[scheduleIndex];
    if (!schedule) return;

    const [startHour, startMin] = schedule.startTime.split(':').map(Number);
    const [endHour, endMin] = schedule.endTime.split(':').map(Number);

    const startTime = new Date(baseDate);
    startTime.setHours(startHour, startMin, 0, 0);

    const endTime = new Date(startTime);
    endTime.setHours(endHour, endMin, 0, 0);
    if (endTime.getTime() < startTime.getTime()) {
      endTime.setDate(endTime.getDate() + 1);
    }

    // Use local date string to avoid timezone shifts from toISOString()
    const dateStr = baseDate.getFullYear() + '-' + 
                   String(baseDate.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(baseDate.getDate()).padStart(2, '0');
    const now = Date.now();

    // --- TRIGGER 1: NOTIFY (T-15) ---
    const notifyTime = startTime.getTime() - (15 * 60 * 1000);
    const notifyId = `place-${place.id}-sched-${scheduleIndex}-date-${dateStr}-type-monitor`;
    
    const notifyWindowEnd = endTime.getTime();
    const shouldScheduleNotify = notifyTime > now || (now >= notifyTime && now < notifyWindowEnd);
    
    if (shouldScheduleNotify && !existingIds.has(notifyId)) {
      await this.scheduleSingleAlarm(
        notifyId,
        notifyTime > now ? notifyTime : now + 1000,
        place.id,
        ALARM_ACTIONS.START_MONITORING,
        { placeId: place.id, prayerIndex: scheduleIndex, dateStr, subType: 'notify', silent: 'true' }
      );
    }

    // --- TRIGGER 2: MONITOR START (T-5) ---
    const monitorStartTime = startTime.getTime() - (5 * 60 * 1000);
    const startId = `place-${place.id}-sched-${scheduleIndex}-date-${dateStr}-type-start`;
    
    const shouldScheduleStart = monitorStartTime > now || (now >= monitorStartTime && now < endTime.getTime());
    
    if (shouldScheduleStart && !existingIds.has(startId)) {
      await this.scheduleSingleAlarm(
        startId,
        monitorStartTime > now ? monitorStartTime : now + 1000,
        place.id,
        ALARM_ACTIONS.START_SILENCE,
        { placeId: place.id, prayerIndex: scheduleIndex, dateStr, subType: 'monitor', silent: 'true' }
      );
    }

    // --- TRIGGER 3: STRICT START (T-0) ---
    const strictId = `place-${place.id}-sched-${scheduleIndex}-date-${dateStr}-type-strict`;
    if (startTime.getTime() > now && !existingIds.has(strictId)) {
      await this.scheduleSingleAlarm(
        strictId,
        startTime.getTime(),
        place.id,
        ALARM_ACTIONS.STRICT_START,
        { placeId: place.id, prayerIndex: scheduleIndex, dateStr, subType: 'strict', silent: 'true' }
      );
    }

    // --- TRIGGER 4: END & HEAL (End Time) ---
    const endId = `place-${place.id}-sched-${scheduleIndex}-date-${dateStr}-type-end`;
    if (endTime.getTime() > now && !existingIds.has(endId)) {
      await this.scheduleSingleAlarm(
        endId,
        endTime.getTime(),
        place.id,
        ALARM_ACTIONS.STOP_SILENCE,
        { placeId: place.id, prayerIndex: scheduleIndex, dateStr, subType: 'cleanup', silent: 'true' }
      );
    }
  }

  /**
   * GAP-FILLING RESTORE (For Reboots)
   * Only fills missing alarms, doesn't reset existing ones
   */
  async restoreGapsOnBoot(places: any[]) {
    if (places.length === 0) return;
    
    try {
      Logger.info(`[AlarmService] 🔧 Gap-filling restore for ${places.length} places`);
      
      for (const place of places) {
        if (!place.isEnabled || !place.schedules) continue;
        
        // ✅ Pass false to NOT reset existing alarms (only fill gaps)
        await this.scheduleAlarmsForPlace(place, false);
      }
      
      Logger.info(`[AlarmService] ✅ Gap-filling complete`);
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