# Modelo de amenazas y datos de las apps nativas

Fecha: 2026-09-25. Alcance: `native/android`, `native/ios` y sus cores.
Cubre PRD-012-R01, R02, R03, R08 y R10. No es una certificacion de seguridad.

## Activos y actores

- Activos: control del reproductor, integridad de la pagina companion, camara
  (solo si la marca la habilita), preferencias locales y el diagnostico en memoria.
- Actores no confiables: cualquier equipo de la red local (puede responder a
  SSDP o suplantar una TV), el contenido anunciado por la TV (URLs, manifests,
  subtitulos) y las paginas web de terceros cargadas como companion.

## Entradas y controles

| Entrada | Riesgo | Control implementado |
| --- | --- | --- |
| SSDP UDP | Respuestas falsas, esquemas peligrosos | Solo HTTP 200 con ST DIAL; LOCATION http/https sin credenciales ni fragmento; cabeceras duplicadas rechazadas; 128 dispositivos maximo |
| Descripcion DIAL (XML) | XXE, DTD, cuerpos enormes | Sin DTD ni entidades externas; 1 MiB; sin redirecciones; 5 s por peticion; 30 s por escaneo |
| URLs HbbTV | Esquemas internos, host falso | App2App e InterDevSync solo ws/wss; host marcador (0.0.0.0, vacio, localhost) sustituido por el host que respondio |
| CSS-CII/TS (JSON) | JSON profundo, numeros enormes | 65 536 caracteres (CII), 16 384 (TS), profundidad 32, enteros sin pasar por double, exponentes acotados |
| CSS-WC UDP | Paquetes truncados, respuestas no solicitadas | 32 bytes exactos, version 0, nanos < 1e9; socket conectado al host/puerto del WC; solo se aceptan originate de peticiones pendientes (16, caducan a 5 s) |
| App2App | Inundacion, cruce de sesiones | Entrada 262 144 caracteres, salida 65 536, cola 32, 32 tipos retenidos, tipo <= 128; tokens por generacion; payload opaco, nunca evaluado |
| Manifest MPD/HLS | XXE, tamano, URLs locales | 4 MiB, sin DTD, BaseURL resuelto por RFC 3986 y limitado a http/https sin credenciales |
| Subtitulos | Documentos grandes, cajas MP4 malformadas | 2 MiB, 5000 cues, segmento 1 MiB, cajas con tamano validado; fallo solo desactiva subtitulos |
| Pagina companion | Mensajes de otro origen o pagina anterior, escalada de permisos | Puente limitado al origen de la pagina y a la navegacion actual (generacion); marco principal; 64 KiB; otras URL se abren fuera; camara solo por opt-in de marca, mismo origen y permiso del SO; microfono denegado |
| Metadata web | HTML grande | 200 KB leidos como maximo |

Las cadenas enviadas al WebView viajan como literal JSON escapado (incluidos
U+2028/U+2029), nunca como codigo.

## Limites conocidos y decisiones pendientes

- Cleartext: las TVs se direccionan por IP de LAN con HTTP/WS, por lo que Android
  permite cleartext en `base-config` e iOS usa `NSAllowsLocalNetworking` y
  `NSAllowsArbitraryLoadsForMedia`. No existe forma de limitarlo por rango IP.
- Las descargas de contenido siguen redirecciones (CDN); el descubrimiento no.
- OkHttp y URLSessionWebSocketTask: iOS limita el mensaje a 256 KiB; en Android
  el tamano de trama entrante no es configurable y el core lo rechaza despues.
- VPN: Android elige la interfaz Wi-Fi/Ethernet para multicast, pero el HTTP a la
  TV sigue la ruta del sistema.
- Almacenamiento del WebView: se usa el almacen por defecto de la plataforma
  (paridad con RN). Aislarlo por sesion requiere decision de producto.
- Pruebas de fuzzing/propiedades: solo hay corpus hostil fijo (fixtures).

## Inventario de datos (PRD-012-R10)

| Dato | Donde | Retencion | Borrado |
| --- | --- | --- | --- |
| Modo de sincronizacion por modelo de TV | SharedPreferences / UserDefaults | Hasta desinstalar | Borrar datos de la app |
| Diagnostico (estados, unidades, ids efimeros) | Memoria, 2000 registros | Hasta cerrar el proceso | Automatico |
| Preferencias RN migradas | Solo la clave de modo | Igual que arriba | Igual que arriba |
| Cookies/almacen web del companion | WebView/WKWebView | Politica del sistema y de la pagina | Borrar datos de la app |

No se envian datos a servidores propios. El diagnostico solo sale del dispositivo
mediante la accion explicita de compartir. Las paginas companion de terceros
pueden tener su propia politica de privacidad.

## Permisos por plataforma (PRD-012-R05/R06)

- Android (target 36): INTERNET, estado de red/Wi-Fi, multicast, servicio en
  primer plano (mediaPlayback y connectedDevice), notificaciones (pedido al
  reproducir), WAKE_LOCK; CAMERA solo si la marca lo habilita. Al pasar a target
  37 hay que declarar y pedir `ACCESS_LOCAL_NETWORK`; los fallos EPERM ya se
  muestran como estado de permiso recuperable.
- iOS: aviso de red local, entitlement de multicast (requiere aprobacion de
  Apple), modo de fondo audio, camara solo con opt-in de marca.

Revision pendiente antes de beta (PRD-012-A03): denegar/revocar permisos en
dispositivos, inspeccion de build/logs y revision de este documento.
