# PRD-008: Reproduccion nativa de audio y video

Prioridad: P0. Estado: pendiente. Dependencias: 005, 007; integra 009 y 010.

## Objetivo

Escuchar o ver una pista complementaria sincronizada mediante Media3 en Android
y AVPlayer en iOS, con ruta alternativa documentada cuando el formato lo requiera.

## Requisitos

- PRD-008-R01: adaptadores de player con prepare/play/pause/stop/seek/rate,
  posicion, duracion/ventana, buffering, pistas y error. Dominio no depende de UI.
- PRD-008-R02: control de deriva ejecutado por el propietario nativo del player;
  posicion medida con timestamps y reglas que eviten corregir durante un seek activo.
- PRD-008-R03: integrar las configuraciones reales de modo/live y restablecer
  rate 1 al pausar, terminar, fallar o cambiar sesion, segun contrato de sincronizacion.
- PRD-008-R04: tratar offsets entre timeline TV y player, inicio de periodos,
  ventana live y discontinuidades; clamp de seeks y recuperacion ante posicion caducada.
- PRD-008-R05: seleccion de audio/video sin perder sesion, controles de detener,
  estado y recuperacion; distinguir pausa TV de pausa solicitada por el espectador.
  El espectador marca un audio, un video y unos subtitulos como componentes
  independientes (video sin audio marcado se reproduce silenciado); el player
  queda anclado en la parte inferior de la app mientras haya algo marcado.
- PRD-008-R06: video inline/fullscreen, orientacion, retorno y areas seguras;
  audio privado no debe activar una superficie de video innecesaria.
- PRD-008-R07: errores de red, codec y formato localizados; reintentos acotados
  y fallback DASH iOS integrado con PRD-011 sin bucles de apertura.
- PRD-008-R08: liberar decoder, audio session y listeners al terminar; no
  reproducir dos pistas a la vez por una seleccion rapida o recreacion de pantalla.

## Aceptacion

- PRD-008-A01: TV/emulador controla pausa, reanudacion y salto; movil vuelve
  a sincronizar sin oscilaciones/seeks repetidos conforme a PRD-013.
- PRD-008-A02: corpus de formatos aprobado se reproduce en ambos sistemas
  o muestra el fallback acordado; ninguna promesa de compatibilidad sin dispositivo.
- PRD-008-A03: cambios repetidos de pista/fullscreen y recuperacion de buffering
  no crean players residuales; audio/video siguen el contenido nuevo.
- PRD-008-A04: precision, arranque y estabilidad medidos, no inferidos solo de
  las 985 pruebas del controlador matematico.

## Decisiones

Definir si se permiten controles locales de pausa y como se reincorpora al reloj
maestro. Picture-in-picture y AirPlay/Cast no son alcance inicial salvo requisito
de paridad identificado. No portar parches RN literalmente a Media3/AVPlayer.

Referencias: [player actual](../../src/components/TerminalItem.js),
[controlador](../../www/hbbtv_examples/sync_webplayer/SyncController.js),
[sincronizacion](../MEDIA_SYNC.md).