plugins {
    kotlin("jvm")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    testImplementation(kotlin("test-junit"))
}

tasks.test {
    val fixtures = rootProject.file("../fixtures")
    inputs.dir(fixtures)
    systemProperty("mediasync.syncVectors", fixtures.resolve("sync-controller.tsv").absolutePath)
    systemProperty("mediasync.fixtures", fixtures.absolutePath)
    providers.gradleProperty("mediasync.emulator").orNull?.let { systemProperty("mediasync.emulator", it) }
    providers.gradleProperty("mediasync.emulatorCompat").orNull?.let { systemProperty("mediasync.emulatorCompat", it) }
    testLogging { showStandardStreams = providers.gradleProperty("mediasync.emulator").isPresent }
}