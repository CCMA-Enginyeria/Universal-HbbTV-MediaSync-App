# PRD-002: Marca, idiomas y accesibilidad

Prioridad: P0. Estado: pendiente en las apps nativas. Dependencias: 001.

## Objetivo

Permitir que un radiodifusor cree su fork cambiando una fuente de marca, conservando
los siete idiomas y un uso accesible en ambas plataformas.

## Requisitos

- PRD-002-R01: generar recursos Android/iOS en build desde la configuracion
  central: nombre, IDs, esquema, version, colores, iconos, splash, canal App2App,
  idioma, URLs y opt-in de camara. No duplicar valores a mano entre plataformas.
- PRD-002-R02: exportar textos para ca, es, eu, en, de, it y fr; validar claves,
  placeholders y plurales. Idioma del dispositivo y fallback de marca equivalentes.
- PRD-002-R03: no incluir textos UI hardcoded; nombres ausentes de TV/pistas,
  errores, permisos, botones y ayudas deben ser localizados.
- PRD-002-R04: adaptar los tokens de tema existentes a componentes nativos,
  incluyendo estados de foco, seleccion, carga, error y deshabilitado.
- PRD-002-R05: nombres y orden de foco para TalkBack/VoiceOver, escalado de
  texto sin recorte, contraste legible, controles tactiles accesibles y estado
  no expresado solo mediante color. No anunciar el timecode cada tick.
- PRD-002-R06: conservar ayuda de conexion, marcas de TV/canales cuando formen
  parte del flujo, soporte y explicacion de modos/permisos. Revisar vigencia del
  contenido, no copiar instrucciones que solo sirven para RN.
- PRD-002-R07: configurar orientacion y areas seguras: descubrimiento usable
  en movil/tablet y transicion a video horizontal sin romper navegacion.

## Aceptacion

- PRD-002-A01: cambiar una marca de prueba genera ambos conjuntos de recursos;
  IDs, iconos, canal y URLs correctos sin editar fuentes Kotlin/Swift.
- PRD-002-A02: comprobacion automatica de claves y placeholders en siete idiomas;
  capturas con textos largos y tamano de letra ampliado sin botones inaccesibles.
- PRD-002-A03: completar descubrimiento, seleccion y parada con TalkBack y
  VoiceOver; adjuntar evidencia en dispositivos representativos.

## Decisiones y limites

Elegir formato intermedio generado y politica de versionado; conservar inicialmente
la fuente CommonJS. No introducir nuevos idiomas ni rediseno de marca en este hito.

Referencias: [marca](../../src/brand/brand.config.js),
[traducciones](../../src/i18n/translations.js), [tema](../../src/theme.js),
[ayuda](../../src/screens/HelpScreen.js).