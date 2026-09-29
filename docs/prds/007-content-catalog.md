# PRD-007: Catalogo de contenido y seleccion de pistas

Prioridad: P0. Estado: parcial; evidencia en la [matriz de paridad](parity-matrix.md). Dependencias: 004, 005.

## Objetivo

Transformar el contenido anunciado por la TV en opciones comprensibles y
reproducibles de audio, video, texto o experiencia web.

## Requisitos

- PRD-007-R01: clasificar contentId como contenido multimedia, web o no soportado
  con reglas comprobables; resolver parametros/URLs relativas sin romper identidad.
- PRD-007-R02: soporte MPD de las variantes usadas por radiodifusores actuales:
  BaseURL heredadas, Period/AdaptationSet/Representation, idioma, roles, codecs,
  SegmentTemplate/Timeline y listas cuando se requieran por el inventario real.
- PRD-007-R03: diferenciar live/VOD y ventana disponible; actualizar manifiestos
  dinamicos con cancelacion y limites. Un MPD invalido no deja pistas antiguas activas.
- PRD-007-R04: modelo estable de pistas con identificador, tipo, idioma, rol y
  compatibilidad del dispositivo. Mostrar audiodescripcion/video alternativo y
  subtitulos sin depender de nombres de archivo.
- PRD-007-R05: seleccion inicial y cambios por usuario conservan timeline;
  mapear IDs del catalogo a IDs reales del reproductor sin elegir otra pista por indice.
- PRD-007-R06: catalogar HLS cuando sea ruta iOS/Android aplicable y definir
  que informacion procede del manifest frente a las APIs del player.
- PRD-007-R07: fallback de contenido solo cuando lo permite la marca y falta
  contenido anunciado; no sustituir silenciosamente un contenido no soportado.
- PRD-007-R08: metadata web con timeouts/limites y nombre alternativo localizado;
  cambio de contentId invalida descarga, catalogo y seleccion anteriores.

## Aceptacion

- PRD-007-A01: corpus de manifiestos reales anonimizados y sinteticos cubre
  audio multilingue, video alternativo, texto, live, VOD, URLs relativas y errores.
- PRD-007-A02: mismas opciones semanticas Android/iOS; diferencias de codec
  muestran motivo y ruta alternativa, no una lista vacia inexplicable.
- PRD-007-A03: cambio de contenido durante descarga nunca publica el catalogo
  anterior; seleccion de pista permanece correcta tras refrescar un manifest live.
  Un ID reutilizado con otro idioma o rol no conserva la seleccion por si solo:
  buscar una pista equivalente por tipo/idioma/rol y, si no existe, deseleccionar.
  Un rol ausente y un rol vacio son equivalentes. Reordenar pistas no cambia
  la seleccion cuando se conserva su identidad y significado.

## Incremento verificado (2026-09-26)

- R05/A03: corregida la coincidencia por ID reutilizado en Kotlin y Swift.
  La regresion Kotlin falla antes del cambio y pasa despues; cubre cambio de
  idioma, cambio de rol, alternativa equivalente y ausencia de alternativa.
- Android: suite JVM, APK debug y lint debug correctos (E10 en la matriz).
- Swift: implementacion y prueba equivalente escritas, sin ejecutar en macOS.
- R03/A03, Android: corregida la cancelacion HTTP durante la lectura del cuerpo.
  El vinculo de cancelacion se mantiene hasta leer y cerrar la respuesta, no solo
  hasta recibir cabeceras. Regresion reproducida antes de corregirla (E11).
- Seis tests del cargador verifican cancelacion/cierre, limite exacto, rechazo de
  exceso, truncado de metadata, 404 tolerado y propagacion de otros errores HTTP.
  Usan un interceptor HTTP controlado, no una conexion real ni el controlador
  de sesion. La CI ya incluye `:app:testDebugUnitTest`.
- A03 sigue parcial: falta prueba de integracion de descarga cancelada por
  cambio de contenido y refresco con el reproductor real; la prueba del modelo
  de seleccion no demuestra esos recorridos.

## Pendientes y exclusiones

Inventariar formatos requeridos por radiodifusores antes de elegir parser/player.
DRM nuevo, descarga offline y conversion de video en servidor quedan fuera;
detectar contenido protegido y definir mensaje/ruta admitida es obligatorio.

Referencias: [MPD](../../src/services/MpdParserService.js),
[metadata web](../../src/utils/webMetadata.js), [terminal](../../src/models/HbbTVTerminal.js).