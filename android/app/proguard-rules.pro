# General React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.soloader.** { *; }

# Realm
-keep class io.realm.react.** { *; }
-keep class io.realm.** { *; }
-dontwarn io.realm.**

# Reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbo.** { *; }

# React Native Maps
-keep class com.airbnb.android.react.maps.** { *; }

# React Native Vector Icons
-keep class com.oblador.vectoricons.** { *; }

# Notifee
-keep class app.notifee.core.** { *; }

# Standard Android
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
