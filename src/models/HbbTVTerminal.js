/**
 * Model que representa un Terminal HbbTV descobert
 * Basat en HbbTVTerminal del projecte node-hbbtv
 */

import { XMLBuilder } from 'fast-xml-parser';

export class HbbTVTerminal {
  constructor(dialDevice, appInfo) {
    this.deviceDescriptionUrl = dialDevice?.deviceDescriptionUrl || null;
    this.applicationUrl = dialDevice?.applicationUrl || null;
    this.friendlyName = dialDevice?.friendlyName || 'Terminal desconegut';
    this.manufacturer = dialDevice?.manufacturer || null;
    this.modelName = dialDevice?.modelName || null;
    
    // URLs específiques d'HbbTV
    this.appLaunchURL = dialDevice?.applicationUrl 
      ? `${dialDevice.applicationUrl}/HbbTV` 
      : null;
    
    this.app2AppURL = appInfo?.additionalData?.X_HbbTV_App2AppURL || null;
    this.interDevSyncURL = appInfo?.additionalData?.X_HbbTV_InterDevSyncURL || null;
    this.userAgent = appInfo?.additionalData?.X_HbbTV_UserAgent || null;
    
    // Timestamp de descobriment
    this.discoveredAt = new Date();
    this.lastSeen = new Date();
    
    // XML Builder per construir peticions MHP
    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: true,
    });
  }

  /**
   * Llança una aplicació HbbTV al terminal
   * @param {Object} launchData - Dades per llançar l'aplicació
   * @param {string} launchData.orgId - ID de l'organització (per defecte "")
   * @param {string} launchData.appId - ID de l'aplicació (per defecte "")
   * @param {string} launchData.appName - Nom de l'aplicació
   * @param {string} launchData.appNameLanguage - Idioma del nom (per defecte "en")
   * @param {string} launchData.appUrlBase - URL base de l'aplicació (obligatori)
   * @param {string} launchData.appLocation - Ruta relativa de l'aplicació (per defecte "")
   * @returns {Promise<Object>} Resposta del llançament
   */
  async launchHbbTVApp(launchData) {
    if (!this.appLaunchURL) {
      throw new Error('Terminal no té URL de llançament disponible');
    }

    // Extreure paràmetres amb defaults
    const {
      orgId = "",
      appId = "",
      appName = "",
      appNameLanguage = "en",
      appUrlBase,
      appLocation = "",
    } = launchData;

    // Validar que appUrlBase és una URL vàlida
    if (!appUrlBase) {
      throw new Error('appUrlBase és obligatori');
    }

    let appUrl;
    try {
      appUrl = new URL(appUrlBase);
    } catch (error) {
      throw new Error('appUrlBase ha de ser una URL vàlida');
    }

    if (!appUrl.protocol || !appUrl.hostname) {
      throw new Error('appUrlBase ha de tenir protocol i hostname');
    }

    // Construir estructura MHP segons especificació HbbTV
    const mhpData = {
      'mhp:ServiceDiscovery': {
        '@_xmlns:mhp': 'urn:dvb:mhp:2009',
        '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'mhp:ApplicationDiscovery': {
          '@_DomainName': appUrl.hostname,
          'mhp:ApplicationList': {
            'mhp:Application': {
              'mhp:appName': {
                '@_Language': appNameLanguage,
                '#text': appName,
              },
              'mhp:applicationIdentifier': {
                'mhp:orgId': orgId,
                'mhp:appId': appId,
              },
              'mhp:applicationDescriptor': {
                'mhp:type': {
                  'mhp:OtherApp': 'application/vnd.hbbtv.xhtml+xml',
                },
                'mhp:controlCode': 'AUTOSTART',
                'mhp:visibility': 'VISIBLE_ALL',
                'mhp:serviceBound': 'false',
                'mhp:priority': '1',
                'mhp:version': '01',
                'mhp:mhpVersion': {
                  'mhp:profile': '0',
                  'mhp:versionMajor': '1',
                  'mhp:versionMinor': '3',
                  'mhp:versionMicro': '1',
                },
              },
              'mhp:applicationTransport': {
                '@_xsi:type': 'mhp:HTTPTransportType',
                'mhp:URLBase': appUrlBase,
              },
              'mhp:applicationLocation': appLocation,
            },
          },
        },
      },
    };

    // Construir XML MHP
    const xmlPayload = this.xmlBuilder.build(mhpData);

    console.log('🚀 Llançant aplicació HbbTV...');
    console.log('   Terminal:', this.friendlyName);
    console.log('   URL:', this.appLaunchURL);
    console.log('   App URL:', appUrlBase + appLocation);

    // Fer POST DIAL per llançar l'aplicació
    try {
      const response = await fetch(this.appLaunchURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'DialApp/1.0',
        },
        body: xmlPayload,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseText = await response.text();
      console.log('✅ Aplicació llançada correctament');
      
      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        response: responseText,
      };
    } catch (error) {
      console.error('❌ Error llançant aplicació HbbTV:', error);
      throw error;
    }
  }

  /**
   * Obté el nom amigable del terminal
   */
  getFriendlyName() {
    return this.friendlyName;
  }

  /**
   * Obté l'URL per llançar aplicacions
   */
  getAppLaunchURL() {
    return this.appLaunchURL;
  }

  /**
   * Obté l'URL per comunicació App2App (WebSocket)
   */
  getApp2AppURL() {
    return this.app2AppURL;
  }

  /**
   * Obté l'URL de sincronització entre dispositius
   */
  getInterDevSyncURL() {
    return this.interDevSyncURL;
  }

  /**
   * Comprova si una URL conté una IP invàlida (0.0.0.0, localhost, 127.0.0.1 o buida)
   * @param {string} url - URL a comprovar
   * @returns {boolean} true si la IP és invàlida
   */
  static hasInvalidIP(url) {
    if (!url) return false;
    // Detectar IP buida (ws://:port/), 0.0.0.0, localhost, 127.0.0.1
    return url.includes('0.0.0.0') || 
           url.includes('localhost') || 
           url.includes('127.0.0.1') ||
           /:\/\/:/.test(url); // Detecta ws://:port/ o http://:port/
  }

  /**
   * Comprova si l'URL App2App té una IP invàlida
   * @returns {boolean}
   */
  hasInvalidApp2AppIP() {
    return HbbTVTerminal.hasInvalidIP(this.app2AppURL);
  }

  /**
   * Comprova si l'URL InterDevSync té una IP invàlida
   * @returns {boolean}
   */
  hasInvalidInterDevSyncIP() {
    return HbbTVTerminal.hasInvalidIP(this.interDevSyncURL);
  }

  /**
   * Comprova si alguna URL té una IP invàlida
   * @returns {boolean}
   */
  hasAnyInvalidIP() {
    return this.hasInvalidApp2AppIP() || this.hasInvalidInterDevSyncIP();
  }

  /**
   * Substitueix la IP invàlida (0.0.0.0, localhost, 127.0.0.1) per una IP vàlida a una URL
   * @param {string} url - URL original
   * @param {string} realIP - IP real a substituir
   * @returns {string} URL amb la IP correcta
   */
  static replaceInvalidIP(url, realIP) {
    if (!url || !realIP) return url;
    return url
      .replace('0.0.0.0', realIP)
      .replace('localhost', realIP)
      .replace('127.0.0.1', realIP)
      .replace(/:(\/\/):/g, `:$1${realIP}:`); // Substitueix IP buida (://:port)
  }

  /**
   * Estableix la IP real per substituir les IPs invàlides
   * @param {string} realIP - IP real del terminal
   */
  setRealIP(realIP) {
    if (this.hasInvalidApp2AppIP()) {
      this.app2AppURL = HbbTVTerminal.replaceInvalidIP(this.app2AppURL, realIP);
    }
    if (this.hasInvalidInterDevSyncIP()) {
      this.interDevSyncURL = HbbTVTerminal.replaceInvalidIP(this.interDevSyncURL, realIP);
    }
  }

  /**
   * Comprova si el terminal suporta sincronització de media inter-dispositiu
   */
  hasMediaSyncCapability() {
    return !!this.interDevSyncURL;
  }

  /**
   * Obté el User Agent del terminal
   */
  getUserAgent() {
    return this.userAgent;
  }

  /**
   * Actualitza el timestamp de última vegada vist
   */
  updateLastSeen() {
    this.lastSeen = new Date();
  }

  /**
   * Retorna informació completa del terminal
   */
  getInfo() {
    return {
      friendlyName: this.friendlyName,
      manufacturer: this.manufacturer,
      modelName: this.modelName,
      appLaunchURL: this.appLaunchURL,
      app2AppURL: this.app2AppURL,
      interDevSyncURL: this.interDevSyncURL,
      userAgent: this.userAgent,
      discoveredAt: this.discoveredAt,
      lastSeen: this.lastSeen,
    };
  }

  /**
   * Converteix a format JSON serialitzable
   */
  toJSON() {
    return this.getInfo();
  }
}

export default HbbTVTerminal;
