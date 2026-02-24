package com.qybrix.silentzone

import android.app.Application
import android.util.Log
import androidx.work.Configuration
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication, Configuration.Provider {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(RingerModePackage())
          add(BatteryOptimizationPackage())
          add(ExactAlarmPackage())
          add(PersistentAlarmPackage())
          add(SensorPackage())  // SFPE: sensor fusion proximity engine
        },
    )
  }

  override val workManagerConfiguration: Configuration
    get() =
      Configuration.Builder()
        .setMinimumLoggingLevel(Log.INFO)
        .build()

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)

    // Arm the native alarm guard (survives app death)
    AlarmGuardWorker.schedule(this)
  }
}
