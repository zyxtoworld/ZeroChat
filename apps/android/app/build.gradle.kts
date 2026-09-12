import org.gradle.api.tasks.testing.Test

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("de.mannodermaus.android-junit5")
}

android {
    namespace = "app.zerochat.client"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.zerochat.client"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }

    lint {
        warningsAsErrors = true
        disable += setOf(
            "AndroidGradlePluginVersion",
            "GradleDependency",
            "NewerVersionAvailable",
            // API 36 is the selected target; hosted lint may lag the installed preview API.
            "OldTargetApi",
        )
    }

    testOptions {
        unitTests.all {
            it.useJUnitPlatform()
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

afterEvaluate {
    tasks.withType<Test>().configureEach {
        val testVariantName = name
            .removePrefix("test")
            .replaceFirstChar { it.lowercase() }
        val kotlinTestClasses = files(layout.buildDirectory.dir("tmp/kotlin-classes/$testVariantName"))
        classpath += kotlinTestClasses
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.12.00"))
    implementation("androidx.activity:activity-compose:1.12.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.foundation:foundation-layout")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.datastore:datastore-preferences:1.2.0")
    implementation("androidx.security:security-crypto:1.1.0")
    implementation("io.ktor:ktor-client-android:3.3.3")
    implementation("io.ktor:ktor-client-content-negotiation:3.3.3")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.3.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("org.junit.jupiter:junit-jupiter:5.14.4")
    testImplementation("io.ktor:ktor-client-mock:3.3.3")
    testImplementation("io.mockk:mockk:1.14.9")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
