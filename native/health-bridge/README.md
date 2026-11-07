# Health Bridge

Android app that talks to the Xiaomi Watch S5 and the Mi Body Composition Scale 2 directly, with no Mi Fitness or Zepp Life in between. It keeps everything in a local Room DB (the in-app health screens read it, offline) and mirrors it to Supabase for Sensors → Health.

```
watch ──Bluetooth Classic SPP (Xiaomi protobuf, encrypted)──┐
scale ──BLE advertisements──────────────────────────────────┤
                                                            ▼
        BridgeService (foreground, always connected) → Room → UploadWorker → rpc/health_ingest
        + notifications / calls / music → watch, find my phone, time, weather (Open-Meteo)
```

The protocol is ported from Gadgetbridge's Xiaomi support; the PC prototype of the same thing is `native/watch-lab`.

## Setup

1. **Supabase.** Run `supabase/health_schema.sql` once. For v2, paste `supabase/health_v2_migration.sql` into the SQL editor; it adds workout details and the Mi Fitness → Health Bridge cutover.
2. **`health.properties`** (gitignored, next to this file):
   ```
   supabase.url=…
   supabase.anonKey=…
   health.token=…          # web app → Sensors → Health → Link phone
   watch.authKey=…         # 32 hex chars; native/watch-lab/scripts/get_auth_key.sh fills it in
   profile.heightCm=177
   profile.birthDate=1998-04-03
   profile.sex=male
   ```
   Never unpair the watch in Mi Fitness and never factory-reset it: either one invalidates the key.
3. **Build and install.** Use JDK 21 (Android Studio's bundled JDK 25 fails), with the phone plugged in and USB debugging on:
   ```
   export JAVA_HOME="$USERPROFILE/.jdks/jbr-21.0.11"
   ./gradlew assembleDebug
   adb install -r "$LOCALAPPDATA/health-bridge-build/app/outputs/apk/debug/app-debug.apk"
   adb logcat -s HB.watch HbBridge ScaleScanner
   ```
   Build output lives in `%LOCALAPPDATA%\health-bridge-build`, because OneDrive marks in-repo build folders read-only.
4. **On the phone.**
   - Disable Mi Fitness first: the watch accepts one app at a time.
   - Watch tab → *Pair watch*.
   - Then work through Settings → *Setup checklist*: notification access, battery optimisation, and ColorOS auto-launch/background activity.

## Health Connect (optional)

The v1 path (Mi Fitness → Health Connect → upload) still exists under Settings → *Also read Health Connect*, off by default.
