# Silent Zone

**Silent Zone** is an intelligent mobile application that automatically manages your phone's ringer mode based on your location and schedule. Never worry about your phone ringing in a meeting, mosque, library, or classroom again.

## 🚀 Features

### Core Functionality
- **Location-Based Muting**: Automatically silences your phone when you enter specific geofenced areas.
- **Auto-Resume**: Automatically restores your ringer volume when you leave the designated area.
- **Schedule Integration**: Define specific days and time intervals for when the silencing should be active (e.g., "Only silence between 9 AM - 5 PM on Weekdays").

### Advanced Features
- **Background Operation**: Runs reliably in the background with a persistent foreground service notification (Android).
- **Offline Support**: Fully functional offline using local database storage and GPS.
- **Smart Battery Management**: Adaptive location polling intervals to minimize battery usage while maintaining accuracy.
- **Crash Recovery**: value safety nets to restore ringer settings if the app encounters an unexpected issue.
- **Transaction Safety**: Robust database operations using Realm with transaction safeguards to prevent data corruption.

### User Interface
- **Visual Map Interface**: easy-to-use map for selecting locations and adjusting geofence radius.
- **Dashboard**: Quick view of active places and current status.
- **Customizable Places**: Icons and categories for different types of locations (Mosque, Office, School, Home, etc.).

## 🛠 Tech Stack

- **Framework**: React Native (0.76+)
- **Language**: TypeScript
- **Database**: Realm (Local offline-first storage)
- **Maps**: React Native Maps (Google Maps)
- **Location**: `react-native-geolocation-service`, `@rn-org/react-native-geofencing` (custom implementation or library)
- **Background Tasks**: `@notifee/react-native` for foreground services.
- **Navigation**: React Navigation v7.

## 📱 Getting Started

### Prerequisites
- Node.js (>= 20)
- React Native CLI
- Android Studio / Xcode

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/joblesspoet/silentzone.git
   cd silentzone
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Install iOS Pods (Mac only)**
   ```bash
   cd ios && pod install && cd ..
   ```

4. **Run the application**
   ```bash
   # Android
   npm run android

   # iOS
   npm run ios
   ```

## 🔒 Permissions

The app requires the following permissions to function correctly:
- **Location**: "Allow all the time" (Background access) is required for geofencing to work when the app is closed.
- **Notification**: To show the foreground service status.
- **Do Not Disturb Access**: To programmatically change the ringer mode.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
