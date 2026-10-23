plugins {
    kotlin("jvm") version "2.2.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20" apply false
    // AGP 9 compiles Kotlin itself (built-in Kotlin) with the Kotlin Gradle plugin above.
    id("com.android.application") version "9.1.1" apply false
    // Kotlin Symbol Processing for the App Functions compiler (PRD-015).
    id("com.google.devtools.ksp") version "2.3.12" apply false
}