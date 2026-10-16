import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val repositoryRoot = rootProject.projectDir.resolve("../..").canonicalFile
val brandScript = repositoryRoot.resolve("native/tools/export-brand.cjs")
val brandSource = providers.environmentVariable("MEDIASYNC_BRAND_CONFIG")
    .orElse(repositoryRoot.resolve("src/brand/brand.config.js").absolutePath)
val nodeCommand = providers.environmentVariable("NODE").orElse("node")

@Suppress("UNCHECKED_CAST")
val brand = JsonSlurper().parseText(
    providers.exec {
        commandLine(nodeCommand.get(), brandScript.absolutePath, "--brand", brandSource.get(), "--print-json")
    }.standardOutput.asText.get(),
) as Map<String, Any?>

val generatedBrand = layout.buildDirectory.dir("generated/brand")

val generateBrandResources by tasks.registering(Exec::class) {
    description = "Exports brand identity, strings and theme from the shared brand source."
    inputs.files(
        brandScript, brandSource.get(),
        repositoryRoot.resolve("src/i18n/translations.js"), repositoryRoot.resolve("src/theme.js"),
        repositoryRoot.resolve("src/data/tvBrands.json"), repositoryRoot.resolve("src/data/channels.json"),
        repositoryRoot.resolve("native/i18n/native-strings.json"),
    )
    inputs.dir(repositoryRoot.resolve("assets")).optional()
    outputs.dir(generatedBrand)
    commandLine(nodeCommand.get(), brandScript.absolutePath, "--brand", brandSource.get(),
        "--android", generatedBrand.get().asFile.absolutePath)
}

android {
    namespace = "mediasync.app"
    compileSdk = 36

    defaultConfig {
        applicationId = brand["androidPackage"] as String
        minSdk = 24
        targetSdk = 36
        versionCode = (brand["versionCode"] as Number).toInt()
        versionName = brand["version"] as String
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["brandScheme"] = brand["scheme"] as String
        // A permission name that the platform does not define is ignored, so a
        // brand without camera opt-in never declares android.permission.CAMERA.
        manifestPlaceholders["cameraPermission"] =
            if (brand["cameraEnabled"] == true) "android.permission.CAMERA" else "mediasync.permission.CAMERA_NOT_USED"
        buildConfigField("boolean", "SYNC_TELEMETRY", "false")
    }

    signingConfigs {
        create("release") {
            val keystore = providers.environmentVariable("MEDIASYNC_KEYSTORE").orNull
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = providers.environmentVariable("MEDIASYNC_KEYSTORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("MEDIASYNC_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("MEDIASYNC_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        debug {
            // Development builds coexist with the store app (PRD-001-R06).
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("boolean", "SYNC_TELEMETRY", "true")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (providers.environmentVariable("MEDIASYNC_KEYSTORE").isPresent) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        // Meta Horizon Store build: the release build plus the Horizon OS
        // manifest (src/quest) and SDK levels (see androidComponents below).
        // Same package and key as the Play build, so a sideloaded Play APK
        // and the store build update each other.
        create("quest") {
            initWith(getByName("release"))
            matchingFallbacks += "release"
            // Quest headsets are arm64 only (VRC.Quest.Packaging.6); drops the
            // other ABIs of androidx.graphics.path.
            ndk { abiFilters += "arm64-v8a" }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        // java.time (MPD availabilityStartTime in :core) is only native from API 26; minSdk matches the RN app (24).
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].apply {
        res.srcDir(generatedBrand.map { it.dir("res") })
        java.srcDir(generatedBrand.map { it.dir("kotlin") })
    }

    packaging {
        resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/versions/9/previous-compilation-data.bin")
    }

    testOptions.unitTests.isReturnDefaultValues = true
}

androidComponents {
    // VRC.Quest.Packaging.1: Horizon OS panel apps need minSdk 29..34 and, for
    // apps created since March 2026, targetSdk 34; the Play build keeps 24/36.
    beforeVariants(selector().withBuildType("quest")) { variant ->
        variant.minSdk = 29
        variant.targetSdk = 34
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.named("preBuild") { dependsOn(generateBrandResources) }

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation(project(":core"))

    val composeBom = platform("androidx.compose:compose-bom:2025.08.00")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-process:2.9.2")
    implementation("androidx.navigation:navigation-compose:2.9.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-exoplayer-dash:1.8.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    implementation("androidx.media3:media3-session:1.8.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.browser:browser:1.9.0")
    implementation("androidx.webkit:webkit:1.14.0")

    testImplementation(kotlin("test-junit"))
}
