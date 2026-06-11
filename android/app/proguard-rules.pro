# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified in the
# Android SDK proguard/proguard-android.txt file.

# Keep the custom TWA notification-delegation service (referenced only from
# AndroidManifest.xml). R8 normally keeps manifest components, but make it
# explicit so minification can't strip/rename the override.
-keep class app.boost8ef11.twa.NotificationService { *; }
-keep class com.google.androidbrowserhelper.** { *; }
