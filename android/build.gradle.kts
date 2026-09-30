// microdocs для Android — WebView с веб-версией. Сборка: scripts/build-android.sh.
plugins {
    id("com.android.application") version "8.7.3"
}

// Ключ подписи — из окружения, в репозитории его нет (см. scripts/android-keystore.sh).
val keystore: String? = System.getenv("MICRODOCS_KEYSTORE")

android {
    namespace = "ru.e40in.microdocs"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.e40in.microdocs"
        minSdk = 28
        // 34, а не 35: с 35 Android 15 рисует окно под системными полосами,
        // и отступы пришлось бы расставлять вручную.
        targetSdk = 34
        versionCode = (findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (findProperty("versionName") as String?) ?: "0.1.0"
        val appUrl = (findProperty("appUrl") as String?) ?: "https://notes.e40in.ru/"
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("MICRODOCS_KEYSTORE_PASSWORD")
                keyAlias = "microdocs"
                keyPassword = storePassword
            }
        }
    }

    buildTypes {
        release {
            // Без ключа — отладочный: скрипт сборки пускает сюда только по явному флагу.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Приложение не для Google Play: его требования к targetSdk здесь ни при чём.
        checkReleaseBuilds = false
    }
}
