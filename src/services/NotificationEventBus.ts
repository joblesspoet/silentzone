import { notificationManager } from './NotificationManager';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';

export type NotificationEventType = 
  | 'CHECK_IN'               // NEW: Immediate check-in confirmation
  | 'SCHEDULE_END' 
  | 'SCHEDULE_APPROACHING'
  | 'PLACE_ENTERED' 
  | 'PLACE_EXITED' 
  | 'SOUND_RESTORED';

export interface NotificationEvent {
  type: NotificationEventType;
  placeId: string;
  placeName: string;
  timestamp: number;
  source: 'alarm' | 'geofence' | 'timer' | 'manual';
}

/**
 * Centralized notification event bus
 * Deduplicates notifications to prevent showing the same event multiple times
 */
class NotificationEventBus {
  private recentEvents: Map<string, number> = new Map();
  private readonly DEDUPE_WINDOW_MS = 60000; // 60 seconds (Increased from 30s)

  /**
   * Emit a notification event
   * Will be deduplicated if same event was shown recently
   */
  emit(event: NotificationEvent): void {
    const key = `${event.type}-${event.placeId}`;
    const now = Date.now();
    const lastTime = this.recentEvents.get(key) || 0;
    const timeSince = now - lastTime;

    // Check if we showed this recently
    if (timeSince < this.DEDUPE_WINDOW_MS) {
      Logger.info(
        `[NotificationBus] 🔕 Deduplicating ${event.type} for ${event.placeName} ` +
        `(shown ${Math.round(timeSince / 1000)}s ago by ${event.source})`
      );
      return; // SKIP - already shown recently
    }

    // Mark as shown
    this.recentEvents.set(key, now);
    Logger.info(
      `[NotificationBus] 🔔 Showing ${event.type} for ${event.placeName} ` +
      `(source: ${event.source})`
    );

    // Show notification
    this.showNotificationForEvent(event);

    // Cleanup old entries periodically
    this.cleanup();
  }

  /**
   * Map event types to actual notification display
   */
  private showNotificationForEvent(event: NotificationEvent): void {
    const notifId = `${event.type.toLowerCase()}-${event.placeId}-${event.timestamp}`;

    switch (event.type) {
      case 'CHECK_IN':
        notificationManager.showNotification(
          '🔕 Phone Silenced',
          `You're at ${event.placeName}`,
          notifId,
          false, // Not silent - user needs to see this!
          true   // grouped
        );
        break;

      case 'SOUND_RESTORED':
        notificationManager.showNotification(
          'Silent Zone Ended',
          `Sound restored for ${event.placeName}`,
          notifId,
          false,
          true
        );
        break;

      case 'SCHEDULE_END':
        notificationManager.showNotification(
          'Silent Zone Ending',
          `${event.placeName} schedule has ended`,
          notifId,
          false,
          true
        );
        break;

      case 'SCHEDULE_APPROACHING':
        notificationManager.showNotification(
          'Upcoming Silence',
          `${event.placeName} starting in ${CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES} minutes`,
          notifId,
          false,
          true
        );
        break;

      case 'PLACE_ENTERED':
        notificationManager.showNotification(
          'Entered Silent Zone',
          event.placeName,
          notifId,
          false,
          true
        );
        break;

      case 'PLACE_EXITED':
        notificationManager.showNotification(
          'Exited Silent Zone',
          event.placeName,
          notifId,
          false,
          true
        );
        break;

      default:
        Logger.warn(`[NotificationBus] Unknown event type: ${(event as any).type}`);
    }
  }

  /**
   * Clean up old deduplication entries
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.DEDUPE_WINDOW_MS * 2;
    let cleaned = 0;

    for (const [key, time] of this.recentEvents.entries()) {
      if (time < cutoff) {
        this.recentEvents.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      Logger.info(`[NotificationBus] Cleaned up ${cleaned} old entries`);
    }
  }

  /**
   * Clear all deduplication state (for testing)
   */
  clear(): void {
    this.recentEvents.clear();
    Logger.info('[NotificationBus] Cleared all deduplication state');
  }
}

export const notificationBus = new NotificationEventBus();
