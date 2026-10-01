# Matriz de paridad y estado de implementacion

Fecha: 2026-09-26. Fuente de verdad del estado de cada requisito de los PRD
001-014 para las apps nativas en `native/`. Ver tambien
[threat-model.md](threat-model.md) y [native/README.md](../../native/README.md).

## Leyenda

- **Hecho**: implementado y con evidencia automatizada o ejecutada en esta plataforma.
- **Impl.**: implementado pero sin compilar/ejecutar aqui (todo el codigo Swift:
  este entorno no tiene Xcode; la CI de macOS es la primera verificacion).
- **Parcial**: implementado en parte o sin la medicion que exige el criterio.
- **Pend.**: no implementado o sin ejecutar.
- **Decision**: requiere aprobacion de producto; se indica el valor provisional.

## Evidencia disponible

- E14 (2026-10-01): iPhone 15 fisico (iOS 26.6.1), build Debug sin el entitlement
  de multicast, contra `tools/tv-emulator` en la misma Wi-Fi. SSDP unicast mediante
  `MEDIASYNC_SSDP_DESTINATION` (solo DEBUG), descripcion DIAL, CII y TS PTS reales;
  pausa/reanudacion y cambio de contenido de la TV seguidos durante ~6 min sin
  desconexiones; paso a segundo plano y vuelta correctos segun el usuario. Antes de
  la correccion la app murio por SIGPIPE tras desconectar CII/TS; anadido
  `SO_NOSIGPIPE` a los sockets UDP. No acredita multicast real, TVs reales,
  precision de sincronia medida ni sesion de fondo de 30 min.

- E13 (2026-10-01): compuerta de temporizacion DASH con MobileVLCKit en iPhone
  fisico (muestra CCMA): fallida. Reloj de medio con saltos de hasta 0.67 s,
  ritmos 0.998/1.002 fuera de tolerancia y reanudacion tras seek de 4-7 s
  (umbral 3 s). Decision: DASH iOS sigue en el reproductor web de marca;
  DASH nativo aplazado (brecha conocida). Ver [evaluacion](../ios-native-dash.md).

- E12 (2026-10-01): iOS local, Xcode 26.0.1 y XcodeGen 2.46.0:
  41 tests Swift core y 2 tests alojados en simulador iPhone 17 Pro correctos;
  archive Release arm64 sin firma correcto. Corregida colision del nombre de
  producto del target de tests, con regresion de identidad de bundles.
  Esto actualiza la anterior ausencia de compilacion Swift; las filas Impl.
  siguen sin acreditar validacion funcional en dispositivo. DASH nativo sin web
  es ahora objetivo pendiente; ver [evaluacion](../ios-native-dash.md).

- E11 (2026-09-26): seis tests Android de `ContentLoader` correctos mediante
  `:app:testDebugUnitTest`; regresion de cancelacion durante lectura del cuerpo
  reproducida antes de la correccion. Verifican cancelacion de Call y cierre de
  respuesta, limites, truncado, 404 y otros errores. Interceptor controlado, sin
  sockets reales ni recorrido de cambio de contenido. `:app:assembleDebug` y
  `:app:lintDebug` correctos; `:core:test` UP-TO-DATE respecto a E10.
  Sin cambios ni nueva evidencia iOS; A03 sigue parcial.
- E10 (2026-09-26): `:core:test :app:assembleDebug :app:lintDebug` correctos:
  64 casos JVM, 63 ejecutados sin fallos y 1 integracion omitida sin emulador.
  Regresion de PRD-007-R05/A03 reproducida antes de corregirla: un ID reutilizado
  no puede seleccionar otro idioma/rol; alternativa semantica o deseleccion.
  Prueba equivalente Swift escrita, pendiente de macOS. No acredita cancelacion
  de descarga ni reproduccion en dispositivo.
- E7 (2026-09-26): estado actual, `:core:test :app:assembleDebug :app:lintDebug`:
  62 pruebas JVM ejecutadas, 0 fallos, 1 integracion omitida sin parametro de
  emulador. `:app:testDebugUnitTest` no contiene tests (NO-SOURCE).
- E8 (2026-09-26): APK/AAB release y lintRelease ejecutados correctamente antes
  del ultimo incremento de SegmentTimeline/SegmentList. No demuestra firma
  de produccion ni instalacion/actualizacion. CI ampliada para repetir estos
  gates y generar archive iOS sin firma; workflow no ejecutado aqui.
- E9 (2026-09-26): pruebas Swift nuevas para refresco, seek y timeline escritas;
  no hay Swift/Xcode local. Integracion HLS y controles de subtitulos requieren
  validacion visual y temporal en ambos dispositivos.

- E1: `gradlew :core:test` - 59 tests JVM (fixtures compartidos, sesiones con
  transporte y reloj falsos, escaneo DIAL en loopback), 0 fallos.
- E2: `gradlew :core:test -Pmediasync.emulator=127.0.0.1` contra
  `tools/tv-emulator`: descubrimiento, CII, WC y TS reales; error de posicion
  0.7-1.2 ms, incertidumbre ~2 ms; pausa y cambio de contenido detectados.
  Con `-Pmediasync.emulatorCompat=true` y la pagina `/tv` abierta: SYNCHRONISED
  por el canal compat (31 ms contra la referencia; avance no verificado porque
  el navegador de pruebas no decodificaba el video).
- E3: `gradlew :app:assembleDebug :app:lintDebug` - APK generado, lint sin errores.
- E4: APK instalado en emulador Android 36.1: arranque sin Metro, escaneo de
  30 s, estado vacio, ayuda, fuente al 160 %.
- E5: `node native/tools/export-brand.cjs --check` - 122 claves y placeholders
  validos en 7 idiomas.
- E6: `native/ios/Tests` y `native/ios/App/Tests` escritos con los mismos
  fixtures; pendientes de ejecutar en la CI de macOS.

## PRD-001 Fundamentos nativos

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | Impl. | Gradle `native/android/app`; XcodeGen `native/ios/App/project.yml` (E3) |
| R02 | Hecho | Impl. | Sin dependencias de React Native, Expo ni Metro |
| R03 | Hecho | Impl. | Cores sin UI; `Transport` y reloj inyectados (E1) |
| R04 | Hecho | Impl. | Maquinas en el hilo/cola principal; red y parsing fuera |
| R05 | Hecho | Impl. | Descubrimiento, detalle, web, ayuda, video a pantalla completa (E4) |
| R06 | Hecho | Impl. | Debug con sufijo `.dev`; release con los ids de marca |
| R07 | Decision | Decision | Provisional: minSdk 26/target 36, AGP 8.11, Kotlin 2.2; iOS 15, Xcode 16 |
| R08 | Hecho | Pend. | Swift sin compilar en este entorno |
| A01 | Parcial | Pend. | E4; iOS pendiente de simulador |
| A02 | Parcial | Pend. | Jobs definidos en `.github/workflows/native-core.yml` |
| A03 | Parcial | Pend. | Estado fuera de la UI; sin test instrumentado de rotacion |

## PRD-002 Marca, i18n y diseno

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | Impl. | `export-brand.cjs` genera recursos, colores, iconos, splash, ids |
| R02 | Hecho | Hecho | E5; no hay claves plurales en las fuentes actuales |
| R03 | Hecho | Impl. | Textos nativos nuevos en `native/i18n/native-strings.json` |
| R04 | Parcial | Parcial | Tokens de `src/theme.js` en Material 3/SwiftUI; foco por defecto del sistema |
| R05 | Parcial | Parcial | Descripciones, encabezados, regiones vivas sin anunciar tiempos; falta TalkBack/VoiceOver real |
| R06 | Parcial | Parcial | Ayuda, soporte y exportar diagnostico; marcas de TV/canales ocultos como en RN |
| R07 | Hecho | Impl. | Telefono vertical, video/web en horizontal, tablet libre, areas seguras |
| A01 | Parcial | Pend. | Solo marca por defecto; falta prueba con marca fork |
| A02 | Parcial | Pend. | Fuente grande en descubrimiento (E4) |
| A03 | Pend. | Pend. | Recorridos con lector de pantalla |

## PRD-003 Descubrimiento DIAL/HbbTV

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | Impl. | SSDP, descripcion, documento HbbTV (E1, E2) |
| R02 | Hecho | Impl. | InterDevSync ws/wss (antes se exigia http, bug corregido); reparacion de host |
| R03 | Hecho | Impl. | Resultados incrementales; identidad por UDN o LOCATION |
| R04 | Parcial | Impl. | Interfaz Wi-Fi/Ethernet para multicast; HTTP no ligado a la red en VPN |
| R05 | Hecho | Impl. | Reintentos 1 s/3 s y 4 peticiones concurrentes (E1) |
| R06 | Hecho | Impl. | Generaciones; cancelacion al salir o reescanear |
| R07 | Hecho | Impl. | Sin red, permiso, fallo de envio, sin resultados; con reintento |
| R08 | Hecho | Impl. | `allowNonHbbtvDevices` visible como "otros dispositivos", no seleccionables |
| R09 | Hecho | Parcial | Swift: tests de parsing; faltan equivalentes de red loopback |
| A01 | Parcial | Pend. | TV lenta no bloquea (E1); emulador (E2); TVs fisicas pendientes |
| A02 | Parcial | Pend. | Tests de generacion; falta ciclo de 20 escaneos en dispositivo |
| A03 | Pend. | Pend. | Matriz fisica de TVs y redes |
| A04 | Parcial | Pend. | Estados de permiso; faltan pruebas de revocacion |

## PRD-004 Sesion de terminal

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | Impl. | Estados e incidencias tipados en `MediaSyncSession` |
| R02 | Hecho | Impl. | Un propietario (`SessionController`/`SessionModel`), tokens por recurso |
| R03 | Hecho | Impl. | Seleccionar otra TV para la anterior primero (E1) |
| R04 | Hecho | Impl. | Cambio de contenido reinicia timestamps; cambio de endpoint reconecta solo WC/TS |
| R05 | Hecho | Impl. | Backoff 1-30 s por canal; App2App con maximo de intentos |
| R06 | Decision | Decision | Salir del detalle mantiene la sesion; parar desde la notificacion; sin confirmacion al cambiar de TV |
| R07 | Hecho | Impl. | Preferencias versionadas; migracion de AsyncStorage RN |
| R08 | Hecho | Impl. | E1 |
| A01-A04 | Parcial | Pend. | Cubiertos con fakes; faltan pruebas en dispositivo |

## PRD-005 Motor DVB-CSS

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | Impl. | CII parcial, `presentationStatus`, timelines |
| R02 | Hecho | Impl. | WC: codec, RTT, dispersion con 500 ppm + mfe remoto, respuestas no solicitadas descartadas |
| R03 | Hecho | Impl. | TS setup con `contentIdStem`, timeline elegido de CII (MPD o PTS) |
| R04 | Hecho | Impl. | Reloj monotono reanclado; enteros de 64 bits |
| R05 | Hecho | Impl. | Posicion con incertidumbre, edad y fiabilidad |
| R06 | Hecho | Impl. | `SyncTuning` con los valores RN por modo y directo |
| R07 | Parcial | Parcial | Enfriamiento de seek y buffering; periodo de estabilizacion no medido |
| R08 | Hecho | Impl. | Reconexion por canal |
| R09 | Parcial | Parcial | Diagnostico con deriva, ritmo, RTT; sin protocolo de medicion |
| A01 | Hecho | Impl. | Mismos fixtures (`native/fixtures/protocol`) |
| A02 | Hecho | Impl. | Vectores de `SyncController.js` |
| A03 | Parcial | Pend. | E2 nativo y compat; TVs reales pendientes |
| A04 | Pend. | Pend. | Umbrales medidos en dispositivo |

## PRD-006 Modos nativo y compat

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01-R04 | Hecho | Impl. | Sondas en paralelo, mismo perfil, sin efectos, `ModeSelection` (E1) |
| R05 | Hecho | Impl. | Transporte compat JSON y emparejamiento (E2 compat) |
| R06 | Hecho | Impl. | Ajuste por modo |
| R07 | Hecho | Impl. | App2App con limites y relevo literal |
| R08 | Hecho | Impl. | Modo efectivo visible; sin alternancia automatica |
| A01-A03 | Hecho | Impl. | Tests de matriz, endpoints mezclados y reinicio de sesion |
| A04 | Parcial | Pend. | Canal App2App independiente con fakes |

## PRD-007 Contenido y pistas

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | Impl. | Clasificador con fixtures |
| R02 | Parcial | Impl. | Templates heredados, BaseURL de representacion, PTO y periodo; timelines finitos/listas de texto (E7/E9). Sin byte ranges ni timelines abiertos no resolubles; limite 10000 segmentos |
| R03 | Parcial | Impl. | Catalogo refrescado con intervalo 1-60 s, cancelacion y seleccion por identidad; manifest invalido limpia estado. Cancelacion Android durante lectura HTTP corregida y probada con interceptor (E11). Integracion de refrescos pendiente |
| R04-R05 | Hecho | Impl. | Ids estables; seleccion por id de representacion con fallback por idioma/rol, nunca por indice. ID reutilizado con otro idioma/rol rechazado (E10) |
| R06 | Parcial | Parcial | HLS multivariante; directo segun el reproductor |
| R07-R08 | Hecho | Impl. | Fallback de marca solo sin contentId; metadata web acotada |
| A01-A03 | Parcial | Pend. | Corpus sintetico; faltan manifests reales anonimizados |

## PRD-008 Reproduccion

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | Impl. | Media3 ExoPlayer / AVPlayer; DASH en iOS via reproductor web de marca (DASH nativo aplazado, E13) |
| R02-R03 | Hecho | Impl. | Corrector cada 250 ms; ritmo 1 al pausar o perder la TV |
| R04 | Parcial | Parcial | Directo con AST como en RN; discontinuidades de periodo pendientes |
| R05-R07 | Parcial | Parcial | Errores localizados, 3 reintentos, pausa del sistema distinta de pausa de TV |
| R08 | Hecho | Impl. | Un reproductor; parar libera recursos |
| A01-A04 | Pend. | Pend. | Pruebas y medidas en dispositivo |

## PRD-009 Segundo plano

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Hecho | N/A | Servicio en primer plano mediaPlayback+connectedDevice, notificacion con Parar |
| R02 | N/A | Impl. | Modo de fondo audio y `AVAudioSession` playback |
| R03 | Hecho | Impl. | Temporizadores fuera de la UI |
| R04 | Hecho | Impl. | Interrupciones y ruido: pausa y reanudacion manual |
| R05-R06 | Parcial | Parcial | Sin controles de seek en pantalla de bloqueo (por diseno) |
| R07, A01-A04 | Pend. | Pend. | Pruebas de 30 min, bateria y Doze |

## PRD-010 Subtitulos

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01-R02 | Hecho | Impl. | TTML (tiempos anidados, frames, ticks), VTT, mdat fMP4; estilos y regiones pendientes |
| R03 | Parcial | Impl. | HLS seleccionado en Media3/AVPlayer con salida al overlay unico; TTML/VTT externos; DASH iOS fullscreen sigue dependiendo del reproductor web. Sin validacion en dispositivo |
| R04 | Parcial | Impl. | Selector iOS y Android, desactivar, contraste; estilos/regiones y validacion visual pendientes |
| R05-R07 | Hecho | Impl. | Buffer de 20 segmentos, 404 tolerado, limites; fallo solo desactiva subtitulos |
| A01 | Hecho | Impl. | Fixtures compartidos |
| A02-A03 | Pend. | Pend. | Sincronia medida en dispositivo |

## PRD-011 Companion web

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01-R03 | Hecho | Impl. | Custom Tabs o WebView; `postMessage`, `__hbbtvSync` y shim `ReactNativeWebView` |
| R04-R05 | Hecho | Impl. | Semilla al terminar la carga, limitacion de ritmo, puerta por origen y generacion |
| R06 | Hecho | Impl. | Web a web recarga; web a medio cierra con aviso |
| R07 | N/A | Impl. | Reproductor web DASH con los parametros RN |
| R08 | Hecho | Impl. | Camara por opt-in, mismo origen, marco principal; microfono denegado |
| R09 | Hecho | N/A | Fallo de Custom Tabs recordado y un unico fallback |
| R10, A01-A04 | Pend. | Pend. | Pruebas con paginas reales y de terceros |

## PRD-012 Seguridad y privacidad

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01-R02 | Hecho | Hecho | [threat-model.md](threat-model.md) |
| R03 | Parcial | Parcial | Cleartext global necesario para IPs de TV; redirecciones solo en contenido |
| R04 | Parcial | Parcial | Sin DTD, validacion numerica; falta fuzzing |
| R05-R06 | Parcial | Parcial | Permisos minimos; target 37 exigira `ACCESS_LOCAL_NETWORK` |
| R07 | Parcial | Parcial | Aislamiento de almacen web: Decision |
| R08-R10 | Hecho | Impl. | Logs sin payloads, firma por variables de entorno, inventario de datos |
| A01-A03 | Parcial | Pend. | Revision de seguridad pendiente |

## PRD-013 Calidad

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Parcial | Parcial | Este documento |
| R02 | Hecho | Impl. | Fixtures compartidos con tolerancias explicitas |
| R03 | Parcial | Pend. | E2; faltan jitter y perdida de paquetes |
| R04 | Pend. | Pend. | Tests de UI instrumentados y matriz fisica |
| R05 | Parcial | Parcial | Latencia y metricas de sync en diagnostico; CPU/memoria/bateria no medidos |
| R06, R08 | Pend. | Pend. | Soak de 30 min y regresion de rendimiento |
| R07 | Hecho | Impl. | Logs estructurados con ids efimeros |
| R09 | Parcial | Parcial | La CI ejecuta E1-E3 y E2 como obligatorio; iOS en macOS |
| A01-A04 | Pend. | Pend. | Criterios de salida de beta |

## PRD-014 Release y corte

| ID | Android | iOS | Notas |
| --- | --- | --- | --- |
| R01 | Parcial | Parcial | CI ampliada con APK/AAB release y archive iOS sin firma; E8 local Android, ejecucion CI/macOS pendiente |
| R02 | Parcial | Pend. | Firma Android por `MEDIASYNC_KEYSTORE*`; iOS sin firma configurada |
| R03 | Decision | Decision | Mismos ids que RN; versionCode 10401; confirmar continuidad de la clave de firma |
| R04 | Hecho | Impl. | Migracion de la preferencia de modo |
| R05-R08 | Pend. | Pend. | Beta, despliegue gradual, rollback y retirada de RN |
| R09 | Hecho | Hecho | App RN intacta |
| R10 | Parcial | Parcial | Documentacion en `native/README.md` |

## Brechas principales antes de beta

1. Compilar y ejecutar el codigo Swift (core y app) en la CI de macOS.
2. Pruebas en TVs y dispositivos fisicos: multicast, permisos, lector de
   pantalla, segundo plano de 30 min, bateria.
3. Verificar subtitulos HLS en ambos dispositivos y TTML/VTT iOS; resolver
  estilos/regiones, fMP4 wvtt, byte ranges y timelines abiertos no resolubles.
4. Decisiones pendientes: R07 de PRD-001, R06 de PRD-004, R07 de PRD-012 y R03 de PRD-014.
5. Pruebas instrumentadas de UI, cancelacion/refresco, rendimiento, jitter,
   soak y accesibilidad; firma autorizada, upgrade RN y ensayo de rollback.
