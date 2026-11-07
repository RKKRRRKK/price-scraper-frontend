import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("com.google.protobuf")
}

// Connection details and the watch key are baked in at build time from
// health.properties (gitignored) so nothing has to be typed on the phone.
val healthProps = Properties().apply {
    rootProject.file("health.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun quoted(key: String) = "\"" + healthProps.getProperty(key, "").trim() + "\""

android {
    namespace = "app.kumquant.healthbridge"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.kumquant.healthbridge"
        minSdk = 28
        targetSdk = 35
        versionCode = 2
        versionName = "2.0"

        buildConfigField("String", "SUPABASE_URL", quoted("supabase.url"))
        buildConfigField("String", "SUPABASE_ANON_KEY", quoted("supabase.anonKey"))
        buildConfigField("String", "HEALTH_TOKEN", quoted("health.token"))
        // 32 hex chars from Mi Fitness; never logged in full.
        buildConfigField("String", "WATCH_AUTH_KEY", quoted("watch.authKey"))
        // Body-composition profile for the scale (height cm, birth date yyyy-mm-dd, "male"/"female").
        buildConfigField("String", "PROFILE_HEIGHT_CM", quoted("profile.heightCm"))
        buildConfigField("String", "PROFILE_BIRTH_DATE", quoted("profile.birthDate"))
        buildConfigField("String", "PROFILE_SEX", quoted("profile.sex"))
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:4.29.3"
    }
    generateProtoTasks {
        all().forEach { task ->
            task.builtins {
                create("java") { option("lite") }
            }
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-service:2.9.1")

    implementation("androidx.room:room-runtime:2.7.1")
    implementation("androidx.room:room-ktx:2.7.1")
    ksp("androidx.room:room-compiler:2.7.1")

    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("com.google.protobuf:protobuf-javalite:4.29.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // Optional legacy path (Settings → "Also read Health Connect"); off by default.
    implementation("androidx.health.connect:connect-client:1.1.0")

    testImplementation("junit:junit:4.13.2")
    // Android's org.json is a stub in local unit tests; parsers build details JSON with it.
    testImplementation("org.json:json:20240303")
}
