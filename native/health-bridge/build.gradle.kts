plugins {
    id("com.android.application") version "8.10.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.21" apply false
    id("com.google.devtools.ksp") version "2.1.21-2.0.1" apply false
    id("com.google.protobuf") version "0.9.5" apply false
}

// The project lives under OneDrive, which marks build folders read-only and
// breaks Gradle; build outside it (%LOCALAPPDATA%\health-bridge-build).
val outside = System.getenv("LOCALAPPDATA")?.let { file("$it/health-bridge-build") }
if (outside != null) {
    allprojects {
        layout.buildDirectory.set(File(outside, if (this == rootProject) "root" else name))
    }
}
