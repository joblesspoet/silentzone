import { PrayerTimeCalculator, CALCULATION_METHODS } from '@masaajid/prayer-times';

const calculator = new PrayerTimeCalculator({
  method: 'KARACHI_UNIVERSITY' as any,
  location: {
    latitude: 24.8607,
    longitude: 67.0011,
  },
  timezone: 'Asia/Karachi',
});

const date = new Date();
const times = calculator.calculate(date);

console.log('Prayer Times for Karachi:', JSON.stringify(times, null, 2));

const formatTime = (date: Date) => {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

console.log('Fajr:', formatTime(times.fajr));
console.log('Dhuhr:', formatTime(times.dhuhr));
console.log('Asr:', formatTime(times.asr));
console.log('Maghrib:', formatTime(times.maghrib));
console.log('Isha:', formatTime(times.isha));
