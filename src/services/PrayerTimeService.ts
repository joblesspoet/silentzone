import {
  Coordinates,
  CalculationMethod,
  PrayerTimes,
  Madhab,
} from 'adhan';

export interface PrayerConfig {
  method: 'ISNA' | 'MWL' | 'EGYPT' | 'MAKKAH' | 'KARACHI' | 'TEHRAN' | 'JAFARI';
  madhab: 'SHAFII' | 'HANAFI';
  adjustments?: number[]; // [Fajr, Dhuhr, Asr, Maghrib, Isha]
}

export const PrayerTimeService = {
  /**
   * Calculate prayer times for a given date and location
   */
  calculatePrayerTimes: (
    latitude: number,
    longitude: number,
    date: Date,
    config: PrayerConfig
  ): { name: string; time: Date }[] | null => {
    try {
      const coordinates = new Coordinates(latitude, longitude);
      
      // Determine calculation method
      let params;
      switch (config.method) {
        case 'MWL': params = CalculationMethod.MuslimWorldLeague(); break;
        case 'EGYPT': params = CalculationMethod.Egyptian(); break;
        case 'MAKKAH': params = CalculationMethod.UmmAlQura(); break;
        case 'KARACHI': params = CalculationMethod.Karachi(); break;
        case 'TEHRAN': params = CalculationMethod.Tehran(); break;
        case 'JAFARI': params = CalculationMethod.Tehran(); break; // Approximation
        case 'ISNA': 
        default: params = CalculationMethod.NorthAmerica(); break;
      }

      // Set Madhab
      params.madhab = config.madhab === 'HANAFI' ? Madhab.Hanafi : Madhab.Shafi;

      // Set Adjustments if provided
      if (config.adjustments && config.adjustments.length === 5) {
        params.adjustments.fajr = config.adjustments[0];
        params.adjustments.dhuhr = config.adjustments[1];
        params.adjustments.asr = config.adjustments[2];
        params.adjustments.maghrib = config.adjustments[3];
        params.adjustments.isha = config.adjustments[4];
      }

      const prayerTimes = new PrayerTimes(coordinates, date, params);

      return [
        { name: 'Fajr', time: prayerTimes.fajr },
        { name: 'Dhuhr', time: prayerTimes.dhuhr },
        { name: 'Asr', time: prayerTimes.asr },
        { name: 'Maghrib', time: prayerTimes.maghrib },
        { name: 'Isha', time: prayerTimes.isha },
      ];
    } catch (error) {
      console.error('[PrayerTimeService] Calculation failed:', error);
      return null;
    }
  },

  /**
   * generate Schedules from Prayer Times
   * Wraps the raw times into the App's Schedule format
   */
  generateSchedules: (
    prayerTimes: { name: string; time: Date }[]
  ): Array<{ startTime: string; endTime: string; days: string[]; label: string }> => {
    const schedules: Array<{ startTime: string; endTime: string; days: string[]; label: string }> = [];

    prayerTimes.forEach((pt) => {
      const start = pt.time;
      const format = (d: Date) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      
      if (pt.name === 'Dhuhr') {
        // 1. Regular Dhuhr (Mon-Thu, Sat-Sun)
        schedules.push({
          startTime: format(start),
          endTime: format(new Date(start.getTime() + 45 * 60000)),
          days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday', 'Sunday'],
          label: 'Dhuhr',
        });
        // 2. Jumma (Friday) - usually longer
        schedules.push({
          startTime: format(start),
          endTime: format(new Date(start.getTime() + 60 * 60000)), // 1 hour for Jumma
          days: ['Friday'],
          label: 'Jumma',
        });
      } else {
        // Fajr, Asr, Maghrib, Isha (Every Day)
        schedules.push({
          startTime: format(start),
          endTime: format(new Date(start.getTime() + 45 * 60000)),
          days: [], // Empty means "Every Day"
          label: pt.name,
        });
      }
    });

    return schedules;
  },
};
