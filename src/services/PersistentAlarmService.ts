/**
 * PersistentAlarmService.ts
 * 
 * Ultra-reliable alarm scheduling that survives overnight Doze mode.
 * 
 * FEATURES:
 * - Uses native setAlarmClock() - bypasses ALL battery optimization
 * - Auto-verifies alarms every 15 minutes
 * - Auto-reschedules if Android deletes them
 * - Persistent storage across app restarts
 * - Wake locks ensure code runs when alarm fires
 * 
 * This solves your February 16 overnight alarm deletion problem.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { Logger } from './Logger';

const { PersistentAlarmModule } = NativeModules;

if (!PersistentAlarmModule) {
  throw new Error('PersistentAlarmModule native module not found. Did you add PersistentAlarmPackage to MainApplication.kt?');
}

const eventEmitter = new NativeEventEmitter(PersistentAlarmModule);

interface AlarmData {
  placeId: string;
  action: string;
  [key: string]: any;
}

interface ScheduledAlarm {
  id: string;
  triggerTime: number;
  title: string;
  body: string;
  minutesUntilFire: number;
}

export class PersistentAlarmService {
  private static listeners: Map<string, (alarmId: string, data: any) => void> = new Map();
  private static isInitialized = false;

  /**
   * Initialize the alarm service
   * Call this once when your app starts
   */
  static initialize() {
    if (this.isInitialized) return;

    // Listen for alarm rescheduling events
    eventEmitter.addListener('onAlarmRescheduled', (event) => {
      Logger.warn(`[PersistentAlarm] 🚨 Alarm was RESCHEDULED: ${event.alarmId}`);
      Logger.warn(`[PersistentAlarm] Reason: ${event.reason}`);
      Logger.warn(`[PersistentAlarm] This means Android DELETED the original alarm!`);
      Logger.warn(`[PersistentAlarm] ⚠️ CHECK BATTERY OPTIMIZATION SETTINGS!`);
    });

    this.isInitialized = true;
    Logger.info('[PersistentAlarm] Service initialized');
  }

  /**
   * Schedule an alarm that will survive overnight Doze mode
   * 
   * @param alarmId Unique identifier (e.g., "place-123-start")
   * @param triggerTime When alarm should fire (Date or timestamp)
   * @param title Notification title
   * @param body Notification body
   * @param data Extra data (placeId, action, etc.)
   */
  static async scheduleAlarm(
    alarmId: string,
    triggerTime: Date | number,
    title: string,
    body: string,
    data: AlarmData
  ): Promise<boolean> {
    if (Platform.OS !== 'android') {
      Logger.warn('[PersistentAlarm] Only supported on Android');
      return false;
    }

    try {
      const triggerTimeMs = triggerTime instanceof Date 
        ? triggerTime.getTime() 
        : triggerTime;

      const now = Date.now();
      const minutesUntilFire = Math.round((triggerTimeMs - now) / 60000);

      Logger.info(`[PersistentAlarm] ⏰ Scheduling: ${alarmId}`);
      Logger.info(`[PersistentAlarm]    Fires: ${new Date(triggerTimeMs).toLocaleString()}`);
      Logger.info(`[PersistentAlarm]    In: ${minutesUntilFire} minutes`);
      Logger.info(`[PersistentAlarm]    Type: setAlarmClock (highest priority)`);

      const result = await PersistentAlarmModule.scheduleAlarm(
        alarmId,
        triggerTimeMs,
        title,
        body,
        data
      );

      if (result) {
        Logger.info(`[PersistentAlarm] ✅ Scheduled successfully: ${alarmId}`);
      } else {
        Logger.error(`[PersistentAlarm] ❌ Failed to schedule: ${alarmId}`);
      }

      return result;

    } catch (error) {
      Logger.error(`[PersistentAlarm] Schedule error:`, error);
      return false;
    }
  }

  /**
   * Cancel a specific alarm
   */
  static async cancelAlarm(alarmId: string): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    try {
      const result = await PersistentAlarmModule.cancelAlarm(alarmId);
      Logger.info(`[PersistentAlarm] ❌ Cancelled: ${alarmId}`);
      return result;
    } catch (error) {
      Logger.error(`[PersistentAlarm] Cancel error:`, error);
      return false;
    }
  }

  /**
   * Get all currently scheduled alarms
   */
  static async getAllAlarms(): Promise<ScheduledAlarm[]> {
    if (Platform.OS !== 'android') return [];

    try {
      const alarms = await PersistentAlarmModule.getAllAlarms();
      return alarms;
    } catch (error) {
      Logger.error(`[PersistentAlarm] Get alarms error:`, error);
      return [];
    }
  }

  /**
   * Manually trigger alarm verification
   * Returns: number of alarms that were missing and needed rescheduling
   */
  static async verifyAlarms(): Promise<number> {
    if (Platform.OS !== 'android') return 0;

    try {
      Logger.info('[PersistentAlarm] 🔍 Running verification check...');
      const missingCount = await PersistentAlarmModule.verifyAlarms();

      if (missingCount > 0) {
        Logger.error(`[PersistentAlarm] 🚨 ${missingCount} alarms were MISSING!`);
        Logger.error('[PersistentAlarm] They have been rescheduled.');
        Logger.error('[PersistentAlarm] ⚠️ CHECK BATTERY OPTIMIZATION!');
      } else {
        Logger.info('[PersistentAlarm] ✅ All alarms verified OK');
      }

      return missingCount;
    } catch (error) {
      Logger.error(`[PersistentAlarm] Verify error:`, error);
      return 0;
    }
  }

  /**
   * Check if a specific alarm is still scheduled
   */
  static async isAlarmScheduled(alarmId: string): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    try {
      return await PersistentAlarmModule.isAlarmScheduled(alarmId);
    } catch (error) {
      Logger.error(`[PersistentAlarm] Check error:`, error);
      return false;
    }
  }

  /**
   * Get diagnostic report of all alarms
   */
  static async getDiagnosticReport(): Promise<string> {
    const alarms = await this.getAllAlarms();
    const now = Date.now();

    const lines = [
      '',
      '═══════════════════════════════════════════════════',
      '  PERSISTENT ALARM DIAGNOSTIC',
      '═══════════════════════════════════════════════════',
      '',
      `Total Scheduled: ${alarms.length}`,
      '',
    ];

    if (alarms.length === 0) {
      lines.push('⚠️ NO alarms currently scheduled');
      lines.push('');
      lines.push('If you expect alarms to be scheduled, this means:');
      lines.push('1. Alarms were deleted by Android (Doze mode)');
      lines.push('2. Battery optimization is enabled (not Unrestricted)');
      lines.push('3. App was force-stopped by user or system');
    } else {
      alarms.forEach((alarm, i) => {
        const status = alarm.minutesUntilFire < 0 ? '⏰ OVERDUE' : '✅ SCHEDULED';
        lines.push(`${i + 1}. ${alarm.title} [${status}]`);
        lines.push(`   ID: ${alarm.id}`);
        lines.push(`   Fires: ${new Date(alarm.triggerTime).toLocaleString()}`);
        lines.push(`   Time: ${Math.abs(alarm.minutesUntilFire)} min ${alarm.minutesUntilFire < 0 ? 'ago' : 'from now'}`);
        lines.push('');
      });
    }

    lines.push('═══════════════════════════════════════════════════');

    const report = lines.join('\n');
    Logger.info(report);
    return report;
  }
}

/**
 * MIGRATION GUIDE: Replace your current AlarmService
 * 
 * OLD CODE (Notifee):
 * ```typescript
 * await notifee.createTriggerNotification(
 *   { id: alarmId, title, body, ... },
 *   { 
 *     type: TriggerType.TIMESTAMP,
 *     timestamp: triggerTime,
 *     alarmManager: { type: 'SET_EXACT_AND_ALLOW_WHILE_IDLE' }  // ❌ Gets cancelled
 *   }
 * );
 * ```
 * 
 * NEW CODE (PersistentAlarm):
 * ```typescript
 * await PersistentAlarmService.scheduleAlarm(
 *   alarmId,
 *   triggerTime,
 *   title,
 *   body,
 *   { placeId, action }  // ✅ Survives overnight
 * );
 * ```
 * 
 * BENEFITS:
 * 1. Uses setAlarmClock() - bypasses ALL Doze restrictions
 * 2. Auto-verifies every 15 minutes
 * 3. Auto-reschedules if Android deletes them
 * 4. Persistent across reboots
 * 5. Wake locks ensure code runs
 * 
 * INITIALIZATION:
 * In your App.tsx or index.js:
 * ```typescript
 * import { PersistentAlarmService } from './services/PersistentAlarmService';
 * 
 * // In your app startup:
 * PersistentAlarmService.initialize();
 * ```
 * 
 * REGISTER ALARM HANDLER:
 * In your index.js:
 * ```typescript
 * import { AppRegistry } from 'react-native';
 * import { locationService } from './services/LocationService';
 * 
 * // Register the alarm handler task
 * AppRegistry.registerHeadlessTask('AlarmHandler', () => async (taskData) => {
 *   console.log('[AlarmHandler] Alarm fired:', taskData.alarmId);
 *   
 *   const { alarmId, timestamp } = taskData;
 *   
 *   // Your alarm handling logic here
 *   // This is where you'd call locationService.handleAlarmFired()
 *   
 *   return Promise.resolve();
 * });
 * ```
 * 
 * VERIFICATION:
 * Add a button in your Settings screen:
 * ```tsx
 * <Button 
 *   title="Verify Alarms"
 *   onPress={async () => {
 *     const report = await PersistentAlarmService.getDiagnosticReport();
 *     Alert.alert('Alarm Status', report);
 *   }}
 * />
 * ```
 */
