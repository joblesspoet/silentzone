
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
    if (!place.schedules || place.schedules.length === 0) {
      Logger.info(`[AlarmService] No schedules for ${place.name}, skipping alarm setup`);
      return;
    }

    let alarmsScheduled = 0;
    const now = new Date();
    const alarmIds: string[] = [];

    // Loop through each user-defined schedule (e.g., 5 prayers)
    for (let i = 0; i < place.schedules.length; i++) {
      const schedule = place.schedules[i];
      const [startHour, startMin] = schedule.startTime.split(':').map(Number);
      const [endHour, endMin] = schedule.endTime.split(':').map(Number);
      
      // Calculate next occurrence of this schedule
      const nextOccurrence = this.getNextScheduleOccurrence(
        now, startHour, startMin, endHour, endMin
      );
      
      if (!nextOccurrence) {
        Logger.info(`[AlarmService] Schedule ${i} for ${place.name} has no future occurrences`);
        continue;
      }
      
      const { startTime, endTime } = nextOccurrence;
      const dayOffset = nextOccurrence.dayOffset;

      // --- ALARM 1: MONITORING START (15 mins before) ---
      const preActivationMillis = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000;
      const monitorTime = startTime.getTime() - preActivationMillis;

      if (monitorTime > Date.now()) {
          const monitorAlarmId = `place-${place.id}-sched-${i}-day-${dayOffset}-type-monitor`;
          await this.scheduleSingleAlarm(
              monitorAlarmId,
              monitorTime,
              place.id,
              ALARM_ACTIONS.START_MONITORING,
              'Schedule Approaching',
              `${place.name} starting soon`
          );
          alarmsScheduled++;
          alarmIds.push(monitorAlarmId);
      }

      // --- ALARM 2: ACTIVATE SILENCE (Exact Start) ---
      if (startTime.getTime() > Date.now()) {
          const startAlarmId = `place-${place.id}-sched-${i}-day-${dayOffset}-type-start`;
          await this.scheduleSingleAlarm(
              startAlarmId,
              startTime.getTime(),
              place.id,
              ALARM_ACTIONS.START_SILENCE,
              'Silent Zone Starting',
              `Activating ${place.name} now`
          );
          alarmsScheduled++;
          alarmIds.push(startAlarmId);
      }

      // --- ALARM 3: DEACTIVATE SILENCE (Exact End) ---
      if (endTime.getTime() > Date.now()) {
          const endAlarmId = `place-${place.id}-sched-${i}-day-${dayOffset}-type-end`;
          await this.scheduleSingleAlarm(
              endAlarmId,
              endTime.getTime(),
              place.id,
              ALARM_ACTIONS.STOP_SILENCE,
              'Silent Zone Ending',
              `Leaving ${place.name}`
          );
          alarmsScheduled++;
          alarmIds.push(endAlarmId);
      }
    }
    
    Logger.info(`[AlarmService] Scheduled ${alarmsScheduled} alarms for ${place.name}`);

    // Verify alarms were actually scheduled
    if (alarmsScheduled > 0) {
      // Small delay to ensure system has processed the requests
      await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
      await this.verifyScheduledAlarms(alarmIds);
    }
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
      body: string
  ) {
      try {
        await notifee.createTriggerNotification(
          {
            id,
            title,
            body,
            data: {
              action, // START_MONITORING or START_SILENCE
              placeId,
              scheduledTime: new Date(timestamp).toISOString(),
            },
            android: {
              channelId: CONFIG.CHANNELS.SERVICE,
              importance: AndroidImportance.HIGH,
              category: AndroidCategory.ALARM,
              autoCancel: true,
              pressAction: {
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
        Logger.info(`[AlarmService] ✅ Alarm set: ${action} @ ${new Date(timestamp).toLocaleTimeString()} (ID: ${id})`);
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
        for (const type of types) {
             const idDay0 = `place-${placeId}-sched-${i}-day-0-type-${type}`;
             const idDay1 = `place-${placeId}-sched-${i}-day-1-type-${type}`;
             try { await notifee.cancelTriggerNotification(idDay0); } catch (e) {}
             try { await notifee.cancelTriggerNotification(idDay1); } catch (e) {}
        }
    }
    Logger.info(`[AlarmService] Cancelled alarms for place ${placeId}`);
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
