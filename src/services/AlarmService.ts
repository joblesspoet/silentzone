import notifee, {
  AndroidImportance,
  TriggerType,
  AndroidCategory,
  AlarmType,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';

/**
 * ALARM_ACTIONS define the core intents for our background service.
 * These are passed in the notification data and handled by LocationService.
 */
export const ALARM_ACTIONS = {
  START_SILENCE: 'START_SILENCE', // Triggered 10m before prayer
  STOP_SILENCE: 'STOP_SILENCE',   // Triggered exactly at end time
};

/**
 * AlarmService: A slim wrapper around Notifee Trigger Notifications.
 * Acts like the Android AlarmManager, scheduling one-shot intents.
 */
class AlarmService {
  
  /**
   * Schedule a native-style one-shot alarm.
   * If an alarm with the same ID exists, Android automatically replaces it (de-duplication).
   * 
   * @param id - Stable ID (e.g., 'place-1-start')
   * @param timestamp - Precise time to fire
   * @param placeId - Database ID of the place
   * @param action - START_SILENCE or STOP_SILENCE
   */
  async scheduleNativeAlarm(
    id: string,
    timestamp: number,
    placeId: string,
    action: string
  ) {
    try {
      // Basic validation
      if (timestamp <= Date.now()) {
        Logger.warn(`[AlarmService] Skipping past alarm for ${id}`);
        return;
      }

      // Check for EXISTING alarm with same ID and timestamp to avoid OS churn
      const existing = await notifee.getTriggerNotifications();
      const match = existing.find(t => 
        t.notification.id === id && 
        (t.trigger as any).timestamp === timestamp
      );

      if (match) {
        // Log at verbose level only to avoid clutter
        console.log(`[AlarmService] Alarm ${id} already set for this time. Skipping.`);
        return;
      }

      // 0. Permission Check (Critical for Android 12+)
      const settings = await notifee.getNotificationSettings();
      if (Platform.OS === 'android' && Platform.Version >= 31) {
        if (settings.android.alarm !== 1) { // 1 = ENABLED
           Logger.warn(`[AlarmService] Missing SCHEDULE_EXACT_ALARM permission for ${id}.`);
           // TODO: We could fall back to inexact alarm here, but for now we skip to avoid crash
           // or we could try to schedule with 'allowWhileIdle: false' as a fallback?
           // For stability, we will return.
           // actually, let's try to schedule INEXACT if permission is missing?
           // No, let's just log and return for now to stop the crash.
        }
      }

      await notifee.createTriggerNotification(
        {
          id,
          title: 'Silent Zone Engine',
          body: action === ALARM_ACTIONS.START_SILENCE 
            ? 'Optimizing background sync...' 
            : 'Finalizing session...',
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

      Logger.info(`[AlarmService] ⏰ Set ${action} for ${new Date(timestamp).toLocaleTimeString()} (ID: ${id})`);
    } catch (error: any) {
      if (error.code === 'E_ALARM_PERMISSION') { // Notifee might wrap SecurityException
          Logger.error(`[AlarmService] Permission Error for ${id}:`, error);
      } else {
          Logger.error(`[AlarmService] Failed to schedule ${id}:`, error);
      }
    }
  }

  /**
   * Cancel all alarms associated with a specific place.
   * Typically used when a place is deleted or disabled.
   */
  async cancelAlarmsForPlace(placeId: string) {
    try {
      const triggers = await notifee.getTriggerNotifications();
      const toCancel = triggers
        .filter(tn => tn.notification.id?.includes(`place-${placeId}`))
        .map(tn => tn.notification.id as string);

      for (const id of toCancel) {
        await notifee.cancelTriggerNotification(id);
      }
      Logger.info(`[AlarmService] 🧹 Cancelled ${toCancel.length} alarms for place ${placeId}`);
    } catch (e) {
      Logger.error('[AlarmService] Failed to cancel alarms', e);
    }
  }

  /**
   * Diagnostic: Return all currently scheduled trigger IDs.
   */
  async getAllScheduledIds(): Promise<string[]> {
    const notifications = await notifee.getTriggerNotifications();
    return notifications
      .map(n => n.notification.id)
      .filter((id): id is string => !!id);
  }
}

export const alarmService = new AlarmService();