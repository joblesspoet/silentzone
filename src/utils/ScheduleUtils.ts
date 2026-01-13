import { format, parse } from 'date-fns';

export interface ScheduleSlot {
  id: string;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  days: string[];
  label: string;
}

const DAYS_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Sort schedules by start time.
 * If start times are equal, sorts by end time.
 */
export const sortSchedules = (schedules: ScheduleSlot[]): ScheduleSlot[] => {
  return [...schedules].sort((a, b) => {
    // Compare basic start times first
    const [hA, mA] = a.startTime.split(':').map(Number);
    const [hB, mB] = b.startTime.split(':').map(Number);
    const timeA = hA * 60 + mA;
    const timeB = hB * 60 + mB;

    return timeA - timeB;
  });
};

/**
 * Validates if the schedule count is within limits.
 */
export const validateLimit = (schedules: ScheduleSlot[], limit: number = 5): boolean => {
  return schedules.length <= limit;
};

/**
 * Checks for overlapping time slots on specific days.
 * Returns an array of IDs of the schedules that overlap.
 */
export const findOverlappingSchedules = (schedules: ScheduleSlot[]): string[] => {
  const overlappingIds = new Set<string>();
  const slotsByDay: Record<string, { id: string; start: number; end: number }[]> = {};

  // Initialize days
  DAYS_ORDER.forEach(day => {
    slotsByDay[day] = [];
  });

  // Flatten schedules into daily slots
  schedules.forEach(schedule => {
    const [startH, startM] = schedule.startTime.split(':').map(Number);
    const [endH, endM] = schedule.endTime.split(':').map(Number);
    
    // Normalize to minutes from midnight
    const startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;

    // Handle overnight schedules (wrap around not usually supported on same day logic, 
    // but for simple overlap we assume single day or treat strictly.
    // If end < start, it implies next day.
    // For this overlap check, we treat it as ending at 23:59 for the current day 
    // and starting at 00:00 for the next day, but to simplify for user input:
    // We strictly check overlaps within the 00:00-24:00 window of a specific day.
    if (endMinutes < startMinutes) endMinutes += 24 * 60; // 1440

    if (schedule.days.length === 0) {
      // "Every Day" - add to all
      DAYS_ORDER.forEach(day => {
        slotsByDay[day].push({ id: schedule.id, start: startMinutes, end: endMinutes });
      });
    } else {
      schedule.days.forEach(day => {
        if (slotsByDay[day]) {
           slotsByDay[day].push({ id: schedule.id, start: startMinutes, end: endMinutes });
        }
      });
    }
  });

  // Check overlaps for each day
  Object.keys(slotsByDay).forEach(day => {
    const daySlots = slotsByDay[day];
    
    // Sort by start time
    daySlots.sort((a, b) => a.start - b.start);

    for (let i = 0; i < daySlots.length - 1; i++) {
      const current = daySlots[i];
      const next = daySlots[i + 1];

      // Overlap condition: Next Start < Current End
      // strictly less because End=10:00 and Start=10:00 is fine (touching).
      if (next.start < current.end) {
        overlappingIds.add(current.id);
        overlappingIds.add(next.id);
      }
    }
  });

  return Array.from(overlappingIds);
};

/**
 * Checks for invalid time ranges (Start Time >= End Time).
 * Returns an array of IDs of the schedules that have invalid times.
 */
export const findInvalidTimeRanges = (schedules: ScheduleSlot[]): string[] => {
  return schedules.filter(slot => {
    const [startH, startM] = slot.startTime.split(':').map(Number);
    const [endH, endM] = slot.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    // Invalid if start is equal to or after end
    return startMinutes >= endMinutes;
  }).map(slot => slot.id);
};
