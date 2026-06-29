/**
 * Expo Config Plugin per configurar la signatura de release per Android.
 *
 * `expo prebuild` regenera android/app/build.gradle i, per defecte, signa la
 * build de release amb la keystore de DEBUG. Google Play rebutja aquests AAB.
 *
 * Aquest plugin injecta una signingConfig "release" que llegeix les credencials
 * des de variables d'entorn (ideal per CI). Si les variables no existeixen
 * (p. ex. builds locals de debug), es manté la keystore de debug com a fallback.
 *
 * Variables d'entorn esperades:
 * - ANDROID_KEYSTORE_FILE      Ruta absoluta al fitxer .keystore
 * - ANDROID_KEYSTORE_PASSWORD  Contrasenya del magatzem
 * - ANDROID_KEY_ALIAS          Àlies de la clau
 * - ANDROID_KEY_PASSWORD       Contrasenya de la clau
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

// Bloc signingConfigs generat per defecte per Expo prebuild.
const DEFAULT_SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

// Bloc signingConfigs amb la configuració de release afegida.
const PATCHED_SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (System.getenv("ANDROID_KEYSTORE_FILE")) {
                storeFile file(System.getenv("ANDROID_KEYSTORE_FILE"))
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // 1) Afegir la signingConfig "release" dins del bloc signingConfigs.
    if (!contents.includes('System.getenv("ANDROID_KEYSTORE_FILE")')) {
      if (contents.includes(DEFAULT_SIGNING_CONFIGS)) {
        contents = contents.replace(DEFAULT_SIGNING_CONFIGS, PATCHED_SIGNING_CONFIGS);
      } else {
        throw new Error(
          "[withReleaseSigning] No s'ha trobat el bloc signingConfigs per defecte. " +
            'Revisa android/app/build.gradle després del prebuild.'
        );
      }
    }

    // 2) Fer que NOMÉS el buildType "release" usi la signingConfig de release
    //    quan hi ha keystore d'entorn; en cas contrari, fallback a debug.
    //
    //    IMPORTANT: cal ancorar a `buildTypes { ... release {`. El bloc
    //    `signingConfigs { ... release { ... } }` apareix ABANS al fitxer, així
    //    que un patró massa genèric (només `release {`) acabaria modificant el
    //    buildType `debug` en comptes del `release`, deixant l'APK/AAB de
    //    release signat amb la keystore de DEBUG (que Google Play rebutja).
    //    Amb `prebuild --clean` (com a CI) el plugin s'executa una sola vegada,
    //    on aquest bug es manifestava.
    const releaseAlreadyPatched =
      /buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig System\.getenv\("ANDROID_KEYSTORE_FILE"\)/.test(
        contents
      );

    if (!releaseAlreadyPatched) {
      const patched = contents.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        '$1signingConfig System.getenv("ANDROID_KEYSTORE_FILE") ? signingConfigs.release : signingConfigs.debug'
      );

      if (patched === contents) {
        throw new Error(
          "[withReleaseSigning] No s'ha pogut localitzar el buildType 'release' " +
            'per aplicar la signingConfig. Revisa android/app/build.gradle després del prebuild.'
        );
      }

      contents = patched;
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withReleaseSigning;
