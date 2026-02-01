
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
        activePlaces.push(place);
        continue;
      }

      for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
         const targetDayIndex = (currentDayIndex + dayOffset) % 7;
         const targetDayName = days[targetDayIndex];

         for (const schedule of place.schedules) {
            if (schedule.days.length > 0 && !schedule.days.includes(targetDayName)) {
               continue;
            }

            const [startHours, startMins] = schedule.startTime.split(':').map(Number);
            const [endHours, endMins] = schedule.endTime.split(':').map(Number);
            
            let startTimeMinutes = startHours * 60 + startMins;
            let endTimeMinutes = endHours * 60 + endMins;

            if (dayOffset === 1) {
               startTimeMinutes += 1440;
               endTimeMinutes += 1440;
            }

            const preActivationMinutes = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES;
            const postGraceMinutes = CONFIG.SCHEDULE.POST_GRACE_MINUTES;
            
            const effectiveStartMinutes = startTimeMinutes - preActivationMinutes;
            const effectiveEndMinutes = endTimeMinutes + postGraceMinutes;

            const isOvernight = (startHours * 60 + startMins) > (endHours * 60 + endMins);
            let isInEffectiveWindow = false;

            if (dayOffset === 0 && isOvernight) {
               isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes || 
                                     currentTimeMinutes < effectiveEndMinutes;
            } else {
               isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes && 
                                     currentTimeMinutes < effectiveEndMinutes;
            }

            if (isInEffectiveWindow) {
               if (!activePlaces.find(p => p.id === place.id)) {
                  activePlaces.push(place);
               }
            }

            let isFutureSchedule = false;
            let minutesUntilStart: number = 0;
            let isOvernightActive = false;

            if (dayOffset === 0 && isOvernight && currentTimeMinutes < (startHours * 60 + startMins)) {
               minutesUntilStart = 0;
               isOvernightActive = true;
               isFutureSchedule = false;
            } else if (currentTimeMinutes < startTimeMinutes) {
               minutesUntilStart = startTimeMinutes - currentTimeMinutes;
               isFutureSchedule = true;
            } else if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
               minutesUntilStart = 0;
               isFutureSchedule = false;
            } else {
               continue;
            }

            if (isInEffectiveWindow || isFutureSchedule) {
               const scheduleStart = new Date(now);
               scheduleStart.setHours(startHours, startMins, 0, 0);
               scheduleStart.setDate(scheduleStart.getDate() + dayOffset);

               if (isOvernightActive && dayOffset === 0) {
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

    upcomingSchedules.sort((a, b) => a.minutesUntilStart - b.minutesUntilStart);
    return { activePlaces, upcomingSchedules };
  }

  static getCurrentOrNextSchedule(place: any): UpcomingSchedule | null {
    if (!place.schedules || place.schedules.length === 0) return null;
    const { upcomingSchedules } = this.categorizeBySchedule([place]);
    return upcomingSchedules[0] || null;
  }
}
