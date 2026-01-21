package com.qybrix.silentzone;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class BatteryOptimizationModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public BatteryOptimizationModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return "BatteryOptimization";
    }

    @ReactMethod
    public void isIgnoringBatteryOptimizations(Promise promise) {
        try {
            PowerManager pm = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
            String packageName = reactContext.getPackageName();
            boolean isIgnoring = pm.isIgnoringBatteryOptimizations(packageName);
            promise.resolve(isIgnoring);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void requestIgnoreBatteryOptimizations(Promise promise) {
        try {
            Intent intent = new Intent();
            String packageName = reactContext.getPackageName();
            intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + packageName));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            // Fallback to general settings if direct request fails (e.g. Google Play restrictions sometimes)
            try {
                Intent intent = new Intent();
                intent.setAction(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
                promise.resolve(true);
            } catch (Exception ex) {
                promise.reject("ERROR", ex.getMessage());
            }
        }
    }
    
    @ReactMethod
    public void openBatterySettings(Promise promise) {
       try {
            Intent intent = new Intent();
            intent.setAction(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);
       } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
       }
    }
}
