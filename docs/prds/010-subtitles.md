# PRD-010: Subtitulos y contenido textual sincronizado

Prioridad: P0. Estado: pendiente. Dependencias: 005, 007, 008.

## Objetivo

Seleccionar y leer subtitulos de las pistas anunciadas con temporizacion correcta
respecto a la TV, tanto en live como VOD.

## Requisitos

- PRD-010-R01: inventariar y portar variantes TTML/VTT actuales, incluyendo
  TTML segmentado y extraccion de segmentos contenedores soportados por el demuxer.
- PRD-010-R02: resolver unidades, offsets, periodos y tiempos de segmento;
  soportar texto multilinea, entidades y estilos/regiones incluidos en el corpus.
- PRD-010-R03: elegir render nativo del player o renderer propio segun compatibilidad,
  pero mantener una sola pista textual visible y una unica fuente temporal.
- PRD-010-R04: seleccion por idioma/rol, opcion desactivado, tamano legible y
  contraste; subtitulos no ocultan controles ni salen de areas seguras/fullscreen.
- PRD-010-R05: ventana de descarga y cache acotadas para live; cancelar al
  cambiar pista/contenido y tolerar segmentos temporalmente ausentes.
- PRD-010-R06: limpiar cues en seek, discontinuidad, pausa/cambio de sesion;
  no repetir ni arrastrar texto de contenido anterior.
- PRD-010-R07: parser con limites y rechazo de entidades externas/entradas
  malformadas; fallos de subtitulos no deben detener audio/video validos.

## Aceptacion

- PRD-010-A01: fixtures con periodos, offsets, cues superpuestos y segmentos
  producen mismos intervalos esperados en Kotlin/Swift o en adapters nativos.
- PRD-010-A02: pausa/seek/cambio de idioma y avance live muestran el cue correcto
  sin texto residual; validar visualmente en ambos sistemas.
- PRD-010-A03: sesion larga mantiene memoria/cache acotadas y una descarga
  malformada solo degrada la pista afectada con estado recuperable.

## Decisiones

Documentar subset TTML/estilos realmente necesario. Traduccion automatica,
generacion de subtitulos y soporte universal de todos los perfiles quedan fuera.

Referencias: [segmentos](../../src/services/TtmlSegmentService.js),
[TTML](../../src/utils/TtmlParser.js), [demux](../../src/utils/TtmlDemuxer.js),
[VTT](../../src/utils/VttParser.js).