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
  private readonly DEDUPE_WINDOW_MS = 180000; // 3 minutes (increased from 60 seconds to reduce spam)

  /**
   * Emit a notification event
   * Will be deduplicated if same event was shown recently
   */
  emit(event: NotificationEvent): void {
    // FIX: Group related events for deduplication
    // CHECK_IN and PLACE_ENTERED are logically the same for the user
    // SOUND_RESTORED, PLACE_EXITED, and SCHEDULE_END are logically the same
    let dedupeType = event.type;
    if (event.type === 'CHECK_IN' || event.type === 'PLACE_ENTERED') {
      dedupeType = 'PLACE_ENTERED';
    } else if (event.type === 'SOUND_RESTORED' || event.type === 'PLACE_EXITED' || event.type === 'SCHEDULE_END') {
      dedupeType = 'PLACE_EXITED';
    }

    const key = `${dedupeType}-${event.placeId}`;
    const now = Date.now();
    const lastTime = this.recentEvents.get(key) || 0;
    const timeSince = now - lastTime;

    // Check if we showed this recently
    if (timeSince < this.DEDUPE_WINDOW_MS) {
      Logger.info(
        `[NotificationBus] 🔕 Deduplicating ${event.type} (as ${dedupeType}) for ${event.placeName} ` +
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
    switch (event.type) {
      case 'CHECK_IN':
      case 'PLACE_ENTERED':
        notificationManager.showActivationAlert(event.placeName);
        break;

      case 'SOUND_RESTORED':
      case 'PLACE_EXITED':
        notificationManager.showEndAlert(event.placeName);
        break;

      case 'SCHEDULE_END':
        notificationManager.showEndAlert(event.placeName);
        break;

      case 'SCHEDULE_APPROACHING':
        notificationManager.showUpcomingAlert(event.placeName, CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES);
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