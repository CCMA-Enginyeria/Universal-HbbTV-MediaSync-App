/**
 * Expo Config Plugin per configurar xarxa per DIAL/SSDP discovery
 * 
 * Afegeix:
 * - network_security_config.xml per permetre cleartext traffic
 * - Regles ProGuard per react-native-udp
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Contingut del network_security_config.xml
const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Network Security Config per permetre tràfic HTTP (cleartext)
  als dispositius DIAL de la xarxa local.
-->
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

// Regles ProGuard per react-native-udp
const PROGUARD_RULES = `
# react-native-udp (per DIAL/SSDP multicast discovery)
-keep class com.tradle.react.** { *; }
-keepclassmembers class com.tradle.react.** { *; }

# Keep WifiManager.MulticastLock (necessari per UDP multicast)
-keep class android.net.wifi.WifiManager$MulticastLock { *; }
`;

/**
 * Afegeix networkSecurityConfig al manifest
 */
function withNetworkSecurityConfig(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application[0];
    
    // Afegir referència al network_security_config
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    
    return config;
  });
}

/**
 * Crea el fitxer network_security_config.xml
 */
function withNetworkSecurityConfigFile(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/res/xml'
      );
      
      // Crear directori si no existeix
      if (!fs.existsSync(xmlDir)) {
        fs.mkdirSync(xmlDir, { recursive: true });
      }
      
      // Escriure network_security_config.xml
      const configPath = path.join(xmlDir, 'network_security_config.xml');
      fs.writeFileSync(configPath, NETWORK_SECURITY_CONFIG);
      
      console.log('✅ Created network_security_config.xml');
      
      return config;
    },
  ]);
}

/**
 * Afegeix regles ProGuard per react-native-udp
 */
function withProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        'app/proguard-rules.pro'
      );
      
      if (fs.existsSync(proguardPath)) {
        let content = fs.readFileSync(proguardPath, 'utf8');
        
        // Afegir regles si no existeixen
        if (!content.includes('com.tradle.react')) {
          content += PROGUARD_RULES;
          fs.writeFileSync(proguardPath, content);
          console.log('✅ Added ProGuard rules for react-native-udp');
        }
      }
      
      return config;
    },
  ]);
}

/**
 * Plugin principal
 */
function withNetworkConfig(config) {
  config = withNetworkSecurityConfig(config);
  config = withNetworkSecurityConfigFile(config);
  config = withProguardRules(config);
  return config;
}

module.exports = withNetworkConfig;
