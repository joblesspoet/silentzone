package com.qybrix.silentzone;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
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
            String packageName = reactContext.getPackageName();
            Intent intent = new Intent();
            intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + packageName));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            // Fallback to Application Details Settings
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
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
            String packageName = reactContext.getPackageName();

            // Android 15+ (API 35+): Direct to App Info where Battery is visible
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + packageName));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                reactContext.startActivity(intent);
                promise.resolve(true);
                return;
            }

            // Android 6+ (API 23+): Try App Info first
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + packageName));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);

        } catch (Exception e) {
            // Final fallback
            try {
                Intent intent = new Intent(Settings.ACTION_SETTINGS);
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
                promise.resolve(true);
            } catch (Exception ex) {
                promise.reject("ERROR", ex.getMessage());
            }
        }
    }
}