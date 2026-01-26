
import { CONFIG } from '../config/config';

export interface UpcomingSchedule {
  placeId: string;
  placeName: string;
  startTime: Date;
  endTime: Date;
  minutesUntilStart: number;
}

export class ScheduleManager {
  /**
   * Helper: Check if a schedule is active RIGHT NOW
   */
  static isScheduleActiveNow(schedule: any, now: Date): boolean {
    const currentDayIndex = now.getDay();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[currentDayIndex];
    
    // Check if schedule has days defined and includes today
    if (schedule.days.length > 0 && !schedule.days.includes(currentDay)) {
      return false;
    }

    const [startHours, startMinutes] = schedule.startTime.split(':').map(Number);
    const [endHours, endMinutes] = schedule.endTime.split(':').map(Number);

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutesTotal = startHours * 60 + startMinutes;
    const endMinutesTotal = endHours * 60 + endMinutes;

    // Handle overnight schedules (e.g., 23:00 to 01:00)
    if (endMinutesTotal < startMinutesTotal) {
      return nowMinutes >= startMinutesTotal || nowMinutes <= endMinutesTotal;
    }

    return nowMinutes >= startMinutesTotal && nowMinutes <= endMinutesTotal;
  }

  /**
   * SCHEDULE-AWARE CATEGORIZATION
   * Returns places that are currently active or will be active soon
   * Works for ANY scheduled location (mosque, office, gym, etc.)
   * 
   * CRITICAL: Returns TWO separate lists:
   * 1. activePlaces: Places within monitoring window (for location checking)
   * 2. upcomingSchedules: ALL future schedules (for alarm scheduling)
   * 
   * UPDATED: Now checks TOMORROW's schedules too for seamless overnight transition
   */
  static categorizeBySchedule(enabledPlaces: any[]): {
    activePlaces: any[];
    upcomingSchedules: UpcomingSchedule[];
  } {
    const now = new Date();
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    const currentDayIndex = now.getDay();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const activePlaces: any[] = [];
    const upcomingSchedules: UpcomingSchedule[] = [];

    for (const place of enabledPlaces) {
      // Places without schedules are always active (24/7 locations)
      if (!place.schedules || place.schedules.length === 0) {
        activePlaces.push(place);
        continue;
      }

      // Check each schedule for TODAY and TOMORROW
      // offset 0 = Today, offset 1 = Tomorrow
      for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
         const targetDayIndex = (currentDayIndex + dayOffset) % 7;
         const targetDayName = days[targetDayIndex];

         for (const schedule of place.schedules) {
            // Day check
            if (schedule.days.length > 0 && !schedule.days.includes(targetDayName)) {
               continue;
            }

            const [startHours, startMins] = schedule.startTime.split(':').map(Number);
            const [endHours, endMins] = schedule.endTime.split(':').map(Number);
            
            // Basic minutes in the target day
            let startTimeMinutes = startHours * 60 + startMins;
            let endTimeMinutes = endHours * 60 + endMins;

            // If checking TOMORROW, shift times forward by 24 hours (1440 minutes)
            if (dayOffset === 1) {
               startTimeMinutes += 1440;
               endTimeMinutes += 1440;
            }

            // Calculate with activation window and grace period
            const preActivationMinutes = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES;
            const postGraceMinutes = CONFIG.SCHEDULE.POST_GRACE_MINUTES;
            
            const effectiveStartMinutes = startTimeMinutes - preActivationMinutes;
            const effectiveEndMinutes = endTimeMinutes + postGraceMinutes;

            // Handle overnight schedules (e.g., night shift 22:00 - 06:00)
            const isOvernight = (startHours * 60 + startMins) > (endHours * 60 + endMins);
            
            // Note: Even for overnight, if we are checking TOMORROW with +1440 offset,
            // standard comparison works nicely because we linearize time.
            let isInEffectiveWindow = false;

            if (dayOffset === 0 && isOvernight) {
               // Special handling for overnight ON THE SAME DAY vs NEXT DAY wrap is tricky with linear time.
               // But standard overnight logic applies to "Today" specifically.
               isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes || 
                                     currentTimeMinutes <= effectiveEndMinutes;
               
               // Fix: If checking TODAY and it's overnight starting yesterday (e.g. 02:00 < 22:00), 
               // effectiveStartMinutes is 22:00-15m.
               // This standard check works.
            } else {
               // Standard linear check (works for Today non-overnight AND Tomorrow shifted)
               isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes && 
                                     currentTimeMinutes <= effectiveEndMinutes;
            }

            // Add to activePlaces if in monitoring window
            if (isInEffectiveWindow) {
               if (!activePlaces.find(p => p.id === place.id)) {
                  activePlaces.push(place);
               }
            }

            // FUTURE SCHEDULE CHECK
            let isFutureSchedule = false;
            let minutesUntilStart: number = 0;
            let isOvernightActive = false;

            if (dayOffset === 0 && isOvernight && currentTimeMinutes < (startHours * 60 + startMins)) {
               // Overnight part 2 (early morning of next day schedule started yesterday)
               // ACTUALLY: If isOvernight is true (e.g. 22:00-06:00), and now is 02:00.
               // 02:00 < 22:00.
               // We are in the "active" part.
               minutesUntilStart = 0;
               isOvernightActive = true;
               isFutureSchedule = false;
            } else if (currentTimeMinutes < startTimeMinutes) {
               // Future schedule (not started yet)
               // This works for Today (10:00 < 12:00) AND Tomorrow (23:00 < 24:05)
               minutesUntilStart = startTimeMinutes - currentTimeMinutes;
               isFutureSchedule = true;
            } else if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes) {
               // Currently active
               minutesUntilStart = 0;
               isFutureSchedule = false;
            } else {
               // Schedule has passed
               continue;
            }

            // Add to upcomingSchedules if it's in the effective window OR a future schedule
            // Only add unique schedules based on calculated start time to avoid dupes if logic overlaps
            // (But offset 1 ensures uniqueness from offset 0 usually)
            if (isInEffectiveWindow || isFutureSchedule) {
               // Create schedule object
               const scheduleStart = new Date(now);
               scheduleStart.setHours(startHours, startMins, 0, 0);
               
               // Adjust date based on offset
               scheduleStart.setDate(scheduleStart.getDate() + dayOffset);

               if (isOvernightActive && dayOffset === 0) {
                  // If we are in the early morning part of an overnight schedule, it started yesterday
                  scheduleStart.setDate(scheduleStart.getDate() - 1);
               }
               
               const scheduleEnd = new Date(scheduleStart);
               const durationMinutes = (endHours * 60 + endMins) - (startHours * 60 + startMins) + (isOvernight ? 1440 : 0);
               scheduleEnd.setMinutes(scheduleEnd.getMinutes() + durationMinutes);

               upcomingSchedules.push({
                  placeId: place.id,
                  placeName: place.name,
                  startTime: scheduleStart,
                  endTime: scheduleEnd,
                  minutesUntilStart,
               });
            }
         }
      }
    }

    // Sort upcoming schedules by start time
    upcomingSchedules.sort((a, b) => a.minutesUntilStart - b.minutesUntilStart);

    return { activePlaces, upcomingSchedules };
  }

  /**
   * Helper to get the relevant schedule for strict checking
   */
  static getCurrentOrNextSchedule(place: any): UpcomingSchedule | null {
    if (!place.schedules || place.schedules.length === 0) return null;

    const { upcomingSchedules } = this.categorizeBySchedule([place]);
    return upcomingSchedules[0] || null; // categorizeBySchedule handles the complex day/time logic
  }
}
