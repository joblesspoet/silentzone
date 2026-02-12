
import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';
import { UpcomingSchedule } from './ScheduleManager';

const NOTIFICATION_GROUP = 'com.qybirx.silentzone.group';

// Notification Templates for consistency
const TEMPLATES = {
    SERVICE: {
        RUNNING: { title: '🛡️ Silent Zone Running', body: (count: number) => `Monitoring ${count} active location${count !== 1 ? 's' : ''}` },
        ACTIVE: { title: '🔕 Silent Zone Active', body: (name: string) => `📍 Inside ${name}` },
        UPCOMING: { title: '⏱️ Preparing to Silence', body: (name: string, mins: number) => `🔜 ${name} starts in ${mins} min` },
        SEARCHING: { title: '🛡️ Silent Zone Monitoring', body: 'Searching for active zone...' }
    },
    ALERTS: {
        UPCOMING: { title: 'Upcoming Silent Zone', body: (name: string, mins: number) => `Silent mode for "${name}" starts in ${mins}m` },
        ACTIVATED: { title: 'Silent Zone Active', body: (name: string) => `Phone silenced for "${name}"` },
        ENDED: { title: 'Silent Zone Ended', body: (name: string) => `Volume restored for "${name}"` },
        RESUMED: { title: 'Silent Zone', body: 'Monitoring resumed after device restart' },
        ERROR: { title: '⚠️ Silent Zone Alert', body: (msg: string) => msg || 'Background service issue' }
    }
};

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

      await notifee.createChannel({
        id: CONFIG.CHANNELS.TRIGGERS,
        name: 'Background Service Triggers',
        importance: AndroidImportance.MIN,
        visibility: 0, // VISIBILITY_SECRET
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
      let title = TEMPLATES.SERVICE.RUNNING.title;
      let body = TEMPLATES.SERVICE.RUNNING.body(enabledCount);
      
      if (activePlaceName) {
        title = TEMPLATES.SERVICE.ACTIVE.title;
        body = TEMPLATES.SERVICE.ACTIVE.body(activePlaceName);
      } else if (upcomingSchedules && upcomingSchedules.length > 0) {
        const next = upcomingSchedules[0];
        if (next.minutesUntilStart > 0 && next.minutesUntilStart <= 15) {
            title = TEMPLATES.SERVICE.UPCOMING.title;
            body = TEMPLATES.SERVICE.UPCOMING.body(next.placeName, next.minutesUntilStart);
        } else if (isInScheduleWindow) {
            title = TEMPLATES.SERVICE.SEARCHING.title;
            body = TEMPLATES.SERVICE.SEARCHING.body;
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
          groupSummary: false,
          smallIcon: 'ic_launcher',
          largeIcon: 'ic_launcher',
          importance: AndroidImportance.HIGH,
          foregroundServiceTypes: [
            AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION,
          ],
          pressAction: { id: 'default', launchActivity: 'default' },
        },
      });
    } catch (error) {
      Logger.error('[NotificationManager] Foreground update failed:', error);
    }
  }

  /**
   * Common Alert methods
   */
  async showUpcomingAlert(placeName: string, minutes: number) {
      const { title, body } = TEMPLATES.ALERTS.UPCOMING;
      return this.showNotification(title, body(placeName, minutes), 'upcoming-' + placeName);
  }

  async showActivationAlert(placeName: string) {
      const { title, body } = TEMPLATES.ALERTS.ACTIVATED;
      return this.showNotification(title, body(placeName), 'active-' + placeName);
  }

  async showEndAlert(placeName: string) {
      const { title, body } = TEMPLATES.ALERTS.ENDED;
      return this.showNotification(title, body(placeName), 'end-' + placeName);
  }

  async showResumedAlert() {
      const { title, body } = TEMPLATES.ALERTS.RESUMED;
      return this.showNotification(title, body, 'boot-reschedule-complete', true);
  }

  async showErrorAlert(message: string) {
      const { title, body } = TEMPLATES.ALERTS.ERROR;
      return this.showNotification(title, body(message), 'error-alert', false, false);
  }

  /**
   * Stop foreground service
   */
  async stopForegroundService() {
    if (Platform.OS === 'android') {
      try {
        await notifee.stopForegroundService();
        await notifee.cancelNotification('location-tracking-service');
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
          pressAction: { id: 'default', launchActivity: 'default' },
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
