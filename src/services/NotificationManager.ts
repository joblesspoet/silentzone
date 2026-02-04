
import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';
import { UpcomingSchedule } from './ScheduleManager';

const NOTIFICATION_GROUP = 'com.qybirx.silentzone.group';

class NotificationManager {
  /**
   * Create notification channels
   */
  async createNotificationChannels() {
    if (Platform.OS !== 'android') return;

    try {
      await notifee.createChannel({
        id: CONFIG.CHANNELS.SERVICE,
        name: 'Location Tracking Service',
        importance: AndroidImportance.DEFAULT,
        vibration: false,
        lights: false,
      });

      await notifee.createChannel({
        id: CONFIG.CHANNELS.ALERTS,
        name: 'Location Alerts',
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });
      
      Logger.info('[NotificationManager] Notification channels created');
    } catch (error) {
      Logger.error('[NotificationManager] Failed to create channels:', error);
    }
  }

  /**
   * Start or update foreground service notification
   */
  async startForegroundService(
    enabledCount: number,
    upcomingSchedules: UpcomingSchedule[],
    activePlaceName: string | null,
    isInScheduleWindow: boolean
  ) {
    if (Platform.OS !== 'android') return;

    try {
      // Default state
      let title = '🛡️ Silent Zone Running';
      let body = `Monitoring ${enabledCount} active location${enabledCount !== 1 ? 's' : ''}`;
      
      if (activePlaceName) {
        // We are INSIDE - Top Priority
        title = '🔕 Silent Zone Active';
        body = `📍 Inside ${activePlaceName}`;
      } else if (upcomingSchedules && upcomingSchedules.length > 0) {
        const nextSchedule = upcomingSchedules[0];
        
        if (nextSchedule.minutesUntilStart > 0 && nextSchedule.minutesUntilStart <= 15) {
            // Approaching (Only if > 0 minutes)
            title = '⏱️ Preparing to Silence';
            body = `🔜 ${nextSchedule.placeName} starts in ${nextSchedule.minutesUntilStart} min`;
        } else if (isInScheduleWindow) {
            // In schedule window but NOT validated as inside yet (Active or 0 min)
            title = '🛡️ Silent Zone Monitoring';
            body = 'Monitoring active zone';
        }
      }

      await notifee.displayNotification({
        id: 'location-tracking-service',
        title,
        body,
        android: {
          channelId: CONFIG.CHANNELS.SERVICE,
          asForegroundService: true,
          color: '#8B5CF6',
          ongoing: true,
          autoCancel: false,
          colorized: true,
          groupId: NOTIFICATION_GROUP,
          groupSummary: false, // Don't make foreground service the summary
          smallIcon: 'ic_launcher',
          largeIcon: 'ic_launcher',
          importance: AndroidImportance.HIGH, // Ensure it stays prominent
          foregroundServiceTypes: [
            AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION,
          ],
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
        },
      });

      Logger.info('[NotificationManager] Foreground service notification updated');
    } catch (error) {
      Logger.error('[NotificationManager] Failed to start/update service notification:', error);
    }
  }

  /**
   * Stop foreground service and remove notification
   */
  async stopForegroundService() {
    if (Platform.OS === 'android') {
      try {
        await notifee.stopForegroundService();
        await notifee.cancelNotification('location-tracking-service');
        Logger.info('[NotificationManager] Service stopped');
      } catch (error) {
        Logger.error('[NotificationManager] Error stopping service:', error);
      }
    }
  }

  /**
   * Show a general alert notification
   */
  async showNotification(title: string, body: string, id: string, silent: boolean = false, grouped: boolean = true) {
    try {
      await notifee.displayNotification({
        id,
        title,
        body,
        android: {
          channelId: CONFIG.CHANNELS.ALERTS,
          ...(grouped ? { groupId: NOTIFICATION_GROUP } : {}),
          importance: silent ? AndroidImportance.LOW : AndroidImportance.HIGH,
          smallIcon: 'ic_launcher', 
          largeIcon: 'ic_launcher',
          color: '#8B5CF6',
          pressAction: {
            id: 'default',
          },
        },
        ios: {
          foregroundPresentationOptions: {
            alert: !silent,
            badge: true,
            sound: !silent,
          },
        },
      });
    } catch (error) {
      Logger.error('[NotificationManager] Notification failed:', error);
    }
  }
}

export const notificationManager = new NotificationManager();
