package com.silentzone;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.provider.Settings;
import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class RingerModeModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public RingerModeModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "RingerModeModule";
    }

    @ReactMethod
    public void getRingerMode(Promise promise) {
        try {
            AudioManager audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                int mode = audioManager.getRingerMode();
                promise.resolve(mode);
            } else {
                promise.reject("ERROR", "AudioManager not available");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void setRingerMode(int mode, Promise promise) {
        try {
            // Check if we have DND permission on Android M+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                NotificationManager notificationManager = 
                    (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
                
                if (notificationManager != null && !notificationManager.isNotificationPolicyAccessGranted()) {
                    promise.reject("NO_PERMISSION", "Do Not Disturb permission not granted");
                    return;
                }
            }

            AudioManager audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.setRingerMode(mode);
                promise.resolve(true);
            } else {
                promise.reject("ERROR", "AudioManager not available");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void checkDndPermission(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                NotificationManager notificationManager = 
                    (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
                
                if (notificationManager != null) {
                    boolean hasPermission = notificationManager.isNotificationPolicyAccessGranted();
                    promise.resolve(hasPermission);
                } else {
                    promise.reject("ERROR", "NotificationManager not available");
                }
            } else {
                // Pre-M devices don't need this permission
                promise.resolve(true);
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void requestDndPermission(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
                promise.resolve(true);
            } else {
                promise.resolve(true);
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getStreamVolume(int streamType, Promise promise) {
        try {
            AudioManager audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                int volume = audioManager.getStreamVolume(streamType);
                promise.resolve(volume);
            } else {
                promise.reject("ERROR", "AudioManager not available");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void setStreamVolume(int streamType, int volume, int flags, Promise promise) {
        try {
            AudioManager audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.setStreamVolume(streamType, volume, flags);
                promise.resolve(true);
            } else {
                promise.reject("ERROR", "AudioManager not available");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }
}
