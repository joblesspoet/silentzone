import { Logger } from './Logger';

/**
 * TimerManager - Centralized timer management to prevent memory leaks
 * and provide consistent timer handling across the application
 */
export class TimerManager {
  private timers: { [key: string]: ReturnType<typeof setTimeout> } = {};
  private intervals: { [key: string]: ReturnType<typeof setInterval> } = {};

  /**
   * Schedule a one-time timer
   */
  schedule(key: string, delay: number, callback: () => void): void {
    this.clear(key);

    if (delay <= 0) {
      callback();
      return;
    }

    this.timers[key] = setTimeout(() => {
      delete this.timers[key];
      callback();
    }, delay);
  }

  /**
   * Schedule a recurring interval
   */
  scheduleInterval(key: string, interval: number, callback: () => void): void {
    this.clearInterval(key);
    this.intervals[key] = setInterval(callback, interval);
  }

  /**
   * Clear a specific timer
   */
  clear(key: string): void {
    if (this.timers[key]) {
      clearTimeout(this.timers[key]);
      delete this.timers[key];
    }
  }

  /**
   * Clear a specific interval
   */
  clearInterval(key: string): void {
    if (this.intervals[key]) {
      clearInterval(this.intervals[key]);
      delete this.intervals[key];
    }
  }

  /**
   * Clear all timers and intervals
   */
  clearAll(): void {
    Object.keys(this.timers).forEach(key => this.clear(key));
    Object.keys(this.intervals).forEach(key => this.clearInterval(key));
  }

  /**
   * Check if a timer exists
   */
  hasTimer(key: string): boolean {
    return key in this.timers;
  }

  /**
   * Check if an interval exists
   */
  hasInterval(key: string): boolean {
    return key in this.intervals;
  }
}

export const timerManager = new TimerManager();
