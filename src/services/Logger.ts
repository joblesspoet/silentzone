import { Realm } from 'realm';
import { CONFIG } from '../config/config';
import { Share } from 'react-native';

const MAX_LOGS = 1000;

export class Logger {
  private static realmInstance: Realm | null = null;
  private static isEnabled = false;

  static setEnabled(value: boolean) {
    this.isEnabled = value;
    // Log state change for debugging (always to console)
    console.log(`[Logger] Persistence set to: ${value}`);
  }

  static setRealm(realm: Realm) {
    this.realmInstance = realm;
  }

  static getEnabled(): boolean {
    return this.isEnabled;
  }

  private static write(level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: any) {
    // Always log to console
    const timestamp = new Date();
    const prefix = `[SilentZone] [${timestamp.toLocaleTimeString()}] [${level}]`;
    
    if (level === 'ERROR') {
       console.error(prefix, message, details || '');
    } else if (level === 'WARN') {
       console.warn(prefix, message, details || '');
    } else {
       console.log(prefix, message, details || '');
    }

    // Write to DB if enabled
    if (this.isEnabled && this.realmInstance) {
      try {
        this.realmInstance.write(() => {
          this.realmInstance?.create('SystemLog', {
             id: new Date().getTime().toString() + Math.random().toString(36).substring(2),
             level,
             message,
             details: details ? JSON.stringify(details) : undefined,
             timestamp: new Date(),
          });
          
          // Cleanup old logs if needed (simple cleanup every write might be expensive, 
          // but for <1000 logs it's fast enough)
          // Optimized: Only cleanup if count > MAX_LOGS + 100 to avoid constant deletion
          const allLogs = this.realmInstance?.objects('SystemLog');
          if (allLogs && allLogs.length > MAX_LOGS + 100) {
             const sortedLogs = allLogs.sorted('timestamp');
             const logsToDelete = sortedLogs.slice(0, allLogs.length - MAX_LOGS);
             this.realmInstance?.delete(logsToDelete);
          }
        });
      } catch (e) {
        console.error('[Logger] Failed to write log to Realm', e);
      }
    }
  }

  static info(message: string, details?: any) {
    this.write('INFO', message, details);
  }

  static warn(message: string, details?: any) {
    this.write('WARN', message, details);
  }

  static error(message: string, details?: any) {
    this.write('ERROR', message, details);
  }

  static getLogs(limit = 100): any[] {
    if (!this.realmInstance) return [];
    const logs = this.realmInstance.objects('SystemLog').sorted('timestamp', true).slice(0, limit);
    return Array.from(logs);
  }

  static async exportLogs() {
    if (!this.realmInstance) return;
    
    const logs = this.realmInstance.objects('SystemLog').sorted('timestamp', false); // Oldest first for export
    let exportText = 'SilentZone System Logs\n======================\n\n';
    
    logs.forEach((log: any) => {
       exportText += `[${log.timestamp.toISOString()}] [${log.level}] ${log.message}\n`;
       if (log.details) {
          exportText += `Details: ${log.details}\n`;
       }
       exportText += '----------------------------------------\n';
    });
    
    try {
       await Share.share({
         title: 'SilentZone Logs',
         message: exportText,
       });
    } catch (error) {
       console.error('[Logger] Share failed', error);
    }
  }
  
  static clearLogs() {
      if (!this.realmInstance) return;
      this.realmInstance.write(() => {
          const allLogs = this.realmInstance?.objects('SystemLog');
          this.realmInstance?.delete(allLogs);
      });
  }
}
