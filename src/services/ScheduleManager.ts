
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
      return nowMinutes >= startMinutesTotal || nowMinutes < endMinutesTotal;
    }

    return nowMinutes >= startMinutesTotal && nowMinutes < endMinutesTotal;
  }

  /**
   * SCHEDULE-AWARE CATEGORIZATION
   * Returns places that are currently active or will be active soon
   * Works for ANY scheduled location (mosque, office, gym, etc.)
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
      if (!place.schedules || place.schedules.length === 0) {
        continue;
      }

      // 3. Validation: Ensure schedule data is intact
      const validSchedules: any[] = Array.from(place.schedules as any || []).filter((s: any) => 
          s.startTime && s.endTime && s.startTime.includes(':') && s.endTime.includes(':')
      );

      if (validSchedules.length === 0) continue; 

      // Check Yesterday (-1), Today (0), and Tomorrow (1)
      // -1 is critical for overnight schedules currently in progress
      for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
         const targetDayIndex = (currentDayIndex + dayOffset + 7) % 7;
         const targetDayName = days[targetDayIndex];

         for (const schedule of validSchedules) {
            // Day filter: Does this schedule apply to the day being checked?
            if (schedule.days.length > 0 && !schedule.days.includes(targetDayName)) {
               continue;
            }

            const [startHours, startMins] = schedule.startTime.split(':').map(Number);
            const [endHours, endMins] = schedule.endTime.split(':').map(Number);
            
            let startTimeMinutes = startHours * 60 + startMins;
            let endTimeMinutes = endHours * 60 + endMins;
            const isOvernight = startTimeMinutes > endTimeMinutes;

            // Global offset for the day we are checking
            const dayOffsetMinutes = dayOffset * 1440;
            startTimeMinutes += dayOffsetMinutes;
            endTimeMinutes += dayOffsetMinutes;

            if (isOvernight) {
               endTimeMinutes += 1440; // Spans to next day relative to START
            }

            const preActivationMinutes = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES;
            const postGraceMinutes = CONFIG.SCHEDULE.POST_GRACE_MINUTES;
            
            const effectiveStartMinutes = startTimeMinutes - preActivationMinutes;
            const effectiveEndMinutes = endTimeMinutes + postGraceMinutes;

            const isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes && 
                                      currentTimeMinutes < effectiveEndMinutes;

            if (isInEffectiveWindow) {
               if (!activePlaces.find(p => p.id === place.id)) {
                  activePlaces.push(place);
               }
            }

            // Determine minutes until start for upcoming notifications/monitoring
            let isUpcoming = false;
            let minsUntilStart = 0;

            if (currentTimeMinutes < startTimeMinutes) {
               minsUntilStart = startTimeMinutes - currentTimeMinutes;
               isUpcoming = true;
            } else if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
               minsUntilStart = 0;
               isUpcoming = true; // Technically currently active, but included in timeline
            }

            if (isInEffectiveWindow || isUpcoming) {
               const scheduleStart = new Date(now);
               scheduleStart.setHours(startHours, startMins, 0, 0);
               scheduleStart.setDate(scheduleStart.getDate() + dayOffset);
               
               // Simpler duration calculation
               const startTotal = startHours * 60 + startMins;
               const endTotal = endHours * 60 + endMins;
               const dur = isOvernight ? (1440 - startTotal + endTotal) : (endTotal - startTotal);
               
               const finalEnd = new Date(scheduleStart);
               finalEnd.setMinutes(finalEnd.getMinutes() + dur);

               upcomingSchedules.push({
                  placeId: place.id,
                  placeName: place.name,
                  startTime: scheduleStart,
                  endTime: finalEnd,
                  minutesUntilStart: minsUntilStart,
               });
            }
         }
      }
    }

    // Deduplicate: same place + same start time (occurs when dayOffset -1 overlaps current day window)
    const seen = new Set<string>();
    const dedupedSchedules = upcomingSchedules.filter(s => {
      const key = `${s.placeId}-${s.startTime.getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    dedupedSchedules.sort((a, b) => a.minutesUntilStart - b.minutesUntilStart);
    return { activePlaces, upcomingSchedules: dedupedSchedules };
  }

  /**
   * Checks if the place has a schedule that is currently active (now inside start/end window).
   */
  static isCurrentScheduleActive(place: any): boolean {
    return !!this.getCurrentOrNextSchedule(place, true); // true = strict mode (only if strictly inside window)
  }

  static getCurrentOrNextSchedule(place: any, strict: boolean = false): UpcomingSchedule | null {
    if (!place || !place.schedules || place.schedules.length === 0) return null;
    
    // Strict Mode: Check for currently active schedule manually if needed, 
    // or reuse categorizeBySchedule if it supports it. 
    // Since categorizeBySchedule returns upcoming but filters for effective window,
    // we can use it, but let's be explicit for strict verification.
    
    const { upcomingSchedules, activePlaces } = this.categorizeBySchedule([place]);
    
    if (strict) {
        // In strict mode, we only return a schedule if we are physically INSIDE the valid window right now.
        // categorizeBySchedule puts active places in 'activePlaces'.
        const isActive = activePlaces.some(p => p.id === place.id);
        if (isActive && upcomingSchedules.length > 0) {
            // If active, the first upcoming schedule is the one we are currently in (minutesUntilStart = 0)
            return upcomingSchedules[0]; 
        }
        return null;
    }

    return upcomingSchedules[0] || null;
  }
}
