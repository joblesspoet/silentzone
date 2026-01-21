package com.qybrix.silentzone;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import androidx.annotation.NonNull;

public class ExactAlarmModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public ExactAlarmModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "ExactAlarmModule";
    }

    @ReactMethod
    public void canScheduleExactAlarms(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AlarmManager alarmManager = (AlarmManager) reactContext.getSystemService(Context.ALARM_SERVICE);
                if (alarmManager != null) {
                    boolean canSchedule = alarmManager.canScheduleExactAlarms();
                    promise.resolve(canSchedule);
                } else {
                    promise.resolve(false);
                }
            } else {
                // Pre-Android 12, exact alarms are always available
                promise.resolve(true);
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void openExactAlarmSettings(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
                promise.resolve(true);
            } else {
                promise.resolve(true);
            }
        } catch (Exception e) {
            // Fallback to app settings if the specific intent fails
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
                promise.resolve(true);
            } catch (Exception e2) {
                promise.reject("ERROR", e2.getMessage());
            }
        }
    }
}
