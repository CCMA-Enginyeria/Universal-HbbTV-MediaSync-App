/**
 * Servei per descobrir dispositius HbbTV a la xarxa local utilitzant DIAL/SSDP
 */

import { EventEmitter } from 'events';
import { Platform } from 'react-native';
import dgram from 'react-native-udp';
import NativeUDPMulticast from '../utils/NativeUDPMulticast';
import { Buffer } from 'buffer';
import { XMLParser } from 'fast-xml-parser';
import config from '../utils/config';
import HbbTVTerminal from '../models/HbbTVTerminal';

class DIALDiscoveryService extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.terminals = new Map();
    this.searchTimeout = null;
    this.socket = null;
    
    // Configurar XMLParser per processar correctament XMLs amb namespaces
    // removeNSPrefix: true elimina prefixos com "hbbtv:" dels noms de tags
    // Això converteix <hbbtv:X_HbbTV_App2AppURL> en <X_HbbTV_App2AppURL>
    this.xmlParser = new XMLParser({ 
      ignoreAttributes: false,
      removeNSPrefix: true,  // CRÍTIC per HbbTV: elimina prefixos de namespace
    });
    
    // Comptadors estadístics
    this.stats = {
      msearchSent: 0,
      ssdpResponsesReceived: 0,
      dialDevicesFound: 0,
    };
    
    // Missatge SSDP M-SEARCH per descobrir dispositius DIAL
    this.MSEARCH_MESSAGE = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${config.SSDP_MULTICAST_ADDRESS}:${config.SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 3',
      `ST: ${config.SSDP_SEARCH_TARGET}`,
      '',
      ''
    ].join('\r\n');
  }

  /**
   * Inicia el descobriment de dispositius
   */
  async start() {
    if (this.isRunning) {
      console.log('❌ El servei de descobriment ja està en marxa');
      return;
    }

    try {
      console.log('� Iniciant servei de descobriment DIAL...');
      this.isRunning = true;
      this.emit('ready');

      await this._startUDPDiscovery();

    } catch (error) {
      console.error('❌ Error iniciant descobriment:', error);
      this.emit('error', error);
      this.isRunning = false;
    }
  }

  /**
   * Atura el descobriment
   */
  stop() {
    // Sempre netejar terminals per permetre re-escaneig
    this.terminals.clear();
    
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Aturant servei de descobriment...');
    
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.isRunning = false;
    this.emit('stop');
  }

  /**
   * Refresca el descobriment (torna a buscar)
   */
  refresh() {
    this.terminals.clear();
    if (this.isRunning && this.socket) {
      console.log('🔄 Refrescant descobriment SSDP...');
      this._sendMSearch();
    }
  }

  /**
   * Obté tots els terminals descoberts
   */
  getTerminals() {
    return Array.from(this.terminals.values());
  }

  /**
   * Obté un terminal per URL
   */
  getTerminal(deviceUrl) {
    return this.terminals.get(deviceUrl);
  }

  /**
   * Inicia el socket UDP i envia M-SEARCH
   */
  async _startUDPDiscovery() {
    console.log('🔍 Iniciant descobriment UDP/SSDP...');
    
    // Utilitzar mòdul natiu en iOS, dgram en Android
    if (Platform.OS === 'ios') {
      this.socket = NativeUDPMulticast.createSocket('udp4');
    } else {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    }

    // Configurar timeout de cerca
    this.searchTimeout = setTimeout(() => {
      console.log('⏱️  Timeout de cerca assolit');
      console.log(`📊 Estadístiques: ${this.stats.msearchSent} M-SEARCH enviats, ${this.stats.ssdpResponsesReceived} respostes, ${this.terminals.size} terminals`);
      
      if (this.stats.msearchSent === 0) {
        console.error('❌ No s\'ha pogut enviar cap M-SEARCH');
        this.emit('searchComplete', { 
          success: false, 
          terminalsFound: 0,
          message: 'No s\'ha pogut enviar cap M-SEARCH. Verifica la connexió de xarxa.'
        });
      } else if (this.stats.ssdpResponsesReceived === 0) {
        console.warn('⚠️  No s\'ha rebut cap resposta SSDP. Verifica permisos de xarxa local.');
        this.emit('searchComplete', { 
          success: false, 
          terminalsFound: 0,
          message: 'No s\'ha rebut cap resposta SSDP. Verifica permisos de xarxa local.'
        });
      } else {
        this.emit('searchComplete', { 
          success: true, 
          terminalsFound: this.terminals.size,
          message: `S'han trobat ${this.terminals.size} terminal(s) HbbTV.`
        });
      }
      
      this.isRunning = false;
      this.emit('stop');
    }, config.SEARCH_TIMEOUT);

    // Listener per missatges
    this.socket.on('message', (msg, rinfo) => {
      try {
        this.stats.ssdpResponsesReceived++;
        const message = msg.toString();
        this._handleSSDPResponse(message, rinfo);
      } catch (error) {
        console.error('❌ Error processant resposta SSDP:', error);
      }
    });

    // Listener per errors
    this.socket.on('error', (err) => {
      console.error('❌ Error de socket:', err.code, err.message);
      this.emit('error', err);
    });

    // Bind socket
    this.socket.bind(() => {
      const address = this.socket.address();
      console.log(`✅ Socket UDP vinculat a ${address.address}:${address.port}`);
      
      // Configurar opcions de multicast
      try {
        this.socket.setBroadcast(true);
        this.socket.setMulticastTTL(128);
        this.socket.setMulticastLoopback(true);
        this.socket.addMembership(config.SSDP_MULTICAST_ADDRESS);
        console.log(`✅ Multicast configurat: ${config.SSDP_MULTICAST_ADDRESS}`);
      } catch (e) {
        console.warn('⚠️  Error configurant multicast:', e.message);
      }
      
      // Petit delay abans d'enviar M-SEARCH (important per iOS)
      setTimeout(() => {
        this._sendMSearch();
      }, 100);
    });
  }

  /**
   * Envia missatge M-SEARCH per descobrir dispositius
   */
  _sendMSearch() {
    if (!this.socket) {
      console.error('❌ Socket no disponible');
      return;
    }
    
    try {
      const message = Buffer.from(this.MSEARCH_MESSAGE);
      this.stats.msearchSent++;
      
      this.socket.send(
        message,
        0,
        message.length,
        config.SSDP_PORT,
        config.SSDP_MULTICAST_ADDRESS,
        (err) => {
          if (err) {
            console.error('❌ Error enviant M-SEARCH:', err.message);
            this.stats.msearchSent--;
          } else {
            console.log(`✅ M-SEARCH #${this.stats.msearchSent} enviat a ${config.SSDP_MULTICAST_ADDRESS}:${config.SSDP_PORT}`);
          }
        }
      );
    } catch (error) {
      console.error('❌ Excepció en _sendMSearch:', error.message);
      this.stats.msearchSent--;
    }
  }

  /**
   * Processa resposta SSDP
   */
  async _handleSSDPResponse(message, rinfo) {
    // Parser la resposta HTTP
    const lines = message.split('\r\n');
    let location = null;
    let searchTarget = null;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith('location:')) {
        location = line.substring(9).trim();
      } else if (lower.startsWith('st:')) {
        searchTarget = line.substring(3).trim();
      }
    }

    // Verificar que és un dispositiu DIAL
    if (searchTarget !== config.SSDP_SEARCH_TARGET) {
      return;
    }

    if (!location) {
      console.warn('⚠️  Resposta SSDP sense LOCATION');
      return;
    }

    this.stats.dialDevicesFound++;
    console.log(`🎯 Dispositiu DIAL trobat (${this.stats.dialDevicesFound}):`, location);

    // Evitar duplicats
    if (this.terminals.has(location)) {
      return;
    }

    // Obtenir descripció del dispositiu
    await this._fetchDeviceDescription(location);
  }

  /**
   * Obté la descripció del dispositiu via HTTP
   */
  async _fetchDeviceDescription(location) {
    try {
      const response = await fetch(location);
      const xml = await response.text();
      
      // Obtenir l'Application-URL de la capçalera HTTP (CRÍTIC per HbbTV!)
      const applicationUrl = response.headers.get('Application-URL');
      console.log(`📡 Application-URL de la capçalera: ${applicationUrl}`);
      
      const deviceInfo = this._parseDeviceDescription(xml, location, applicationUrl);
      if (!deviceInfo) {
        return;
      }

      // Obtenir info de l'app HbbTV
      const appInfo = await this._fetchAppInfo(deviceInfo.applicationUrl);
      console.log(`🔍 Analitzant dispositiu: ${deviceInfo.friendlyName}`);
      console.log(`   appInfo:`, appInfo);
      
      // Filtre: només afegir si té suport HbbTV (o mode testing activat)
      const hasHbbTVSupport = appInfo?.additionalData?.X_HbbTV_App2AppURL;
      console.log(`   X_HbbTV_App2AppURL: ${appInfo?.additionalData?.X_HbbTV_App2AppURL}`);
      console.log(`   hasHbbTVSupport: ${hasHbbTVSupport}`);
      console.log(`   ALLOW_NON_HBBTV_DEVICES: ${config.ALLOW_NON_HBBTV_DEVICES}`);
      
      if (!hasHbbTVSupport && !config.ALLOW_NON_HBBTV_DEVICES) {
        console.log(`⏭️  ${deviceInfo.friendlyName}: DIAL però no HbbTV (filtrat)`);
        return;
      }
      
      if (!hasHbbTVSupport) {
        console.warn(`⚠️  Mode testing: ${deviceInfo.friendlyName} (DIAL sense HbbTV)`);
      }
      
      // Crear i guardar terminal
      const terminal = new HbbTVTerminal(deviceInfo, appInfo || { additionalData: {} });
      this.terminals.set(location, terminal);
      
      const terminalType = hasHbbTVSupport ? 'HbbTV' : 'DIAL';
      console.log(`✅ Terminal ${terminalType}:`, terminal.getFriendlyName());
      this.emit('found', terminal);
      
    } catch (error) {
      console.error('❌ Error obtenint descripció del dispositiu:', error);
    }
  }

  /**
   * Parseja el XML de descripció del dispositiu
   */
  _parseDeviceDescription(xml, location, applicationUrl) {
    try {
      const parsed = this.xmlParser.parse(xml);
      const root = parsed.root || parsed;
      const device = root.device || {};

      // L'applicationUrl ha de venir de la capçalera Application-URL de la resposta HTTP
      // NO es construeix manualment! Això és crític per HbbTV
      if (!applicationUrl) {
        console.warn('⚠️  Dispositiu sense capçalera Application-URL');
        return null;
      }
      
      // Netejar trailing slash si en té
      if (applicationUrl.endsWith('/')) {
        applicationUrl = applicationUrl.slice(0, -1);
      }
      
      return {
        friendlyName: device.friendlyName || 'Terminal desconegut',
        manufacturer: device.manufacturer || null,
        modelName: device.modelName || null,
        applicationUrl: applicationUrl,
        deviceDescriptionUrl: location,
      };
    } catch (error) {
      console.error('❌ Error parsejant XML del dispositiu:', error);
      return null;
    }
  }

  /**
   * Obté informació de l'aplicació HbbTV
   */
  async _fetchAppInfo(applicationUrl) {
    try {
      const url = `${applicationUrl}/HbbTV`;
      console.log(`📡 Obtenint info app HbbTV de: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'DialApp/1.0' },
        timeout: 5000,
      });
      
      console.log(`   → Status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        console.log(`   ❌ Resposta no OK (${response.status})`);
        return null;
      }
      
      const xml = await response.text();
      console.log(`   → XML rebut (${xml.length} bytes)`);
      
      // Parsejar XML (removeNSPrefix: true elimina els prefixos hbbtv:)
      const parsed = this.xmlParser.parse(xml);
      console.log(`   → Estructura parsejada:`, JSON.stringify(parsed, null, 2));
      
      // Amb removeNSPrefix, els camps són directament X_HbbTV_App2AppURL (sense hbbtv:)
      const additionalData = parsed.service?.additionalData || {};
      console.log(`   → additionalData trobat:`, additionalData);
      
      const result = {
        additionalData: {
          X_HbbTV_App2AppURL: additionalData.X_HbbTV_App2AppURL || null,
          X_HbbTV_InterDevSyncURL: additionalData.X_HbbTV_InterDevSyncURL || null,
          X_HbbTV_UserAgent: additionalData.X_HbbTV_UserAgent || null,
        },
      };
      
      console.log(`   ✅ AppInfo extret:`, result);
      return result;
    } catch (error) {
      console.error(`   ❌ Error obtenint app info:`, error.message);
      return null;
    }
  }
}

// Singleton
let instance = null;

export const getDIALDiscoveryService = () => {
  if (!instance) {
    instance = new DIALDiscoveryService();
  }
  return instance;
};

export default DIALDiscoveryService;
