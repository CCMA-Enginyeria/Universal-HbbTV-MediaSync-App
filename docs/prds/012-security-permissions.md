# PRD-012: Seguridad, privacidad y permisos

Prioridad: P0 transversal. Estado: controles de parser/transporte parciales.
Dependencias: 001; debe acompanar 003-011 desde su implementacion.

## Objetivo

Tratar televisores, anuncios de red, manifests y paginas web como entradas no
confiables, sin romper el uso local legitimo ni solicitar permisos innecesarios.

## Requisitos

- PRD-012-R01: documentar threat model: UDP no autenticado, URLs anunciadas,
  XML/JSON/binario, recursos multimedia, navegacion y mensajes del puente.
- PRD-012-R02: aplicar limites de paquetes, cuerpos, nesting, tiempos, colas,
  concurrencia y reintentos; cerrar recursos ante fallo y cancelar descargas antiguas.
- PRD-012-R03: politica de esquemas/origenes/redirects/credenciales y destinos
  locales frente a contenido CDN. No bloquear indiscriminadamente LAN necesaria,
  ni conceder acceso arbitrario a archivos o esquemas internos.
- PRD-012-R04: XML sin DTD/entidades externas, validacion numerica de protocolos
  y resistencia a datos truncados; fuzz/property tests en puntos de entrada.
- PRD-012-R05: declarar y solicitar red, notificaciones, background y camara
  segun plataforma/target y marca; probar conceder, denegar y revocar.
- PRD-012-R06: iOS: validar entitlement multicast, uso de red local y politica
  ATS; Android: politica de cleartext limitada al caso de uso, permisos y foreground.
  Verificar reglas oficiales al implementar; no sortear restricciones del sistema.
- PRD-012-R07: puente web autorizado por origen y sesion, denegar capacidades
  no previstas; aislar cookies/storage conforme a politica acordada del companion.
- PRD-012-R08: logs sin payloads opacos, tokens, URLs sensibles ni identificadores
  persistentes innecesarios. Diagnostico exportable solo por accion del usuario.
- PRD-012-R09: no incluir secretos de firma en fuentes, artefactos de prueba ni
  logs CI. Revisar dependencias/licencias y configurar actualizacion controlada.
- PRD-012-R10: inventariar datos almacenados/transmitidos, retencion y borrado;
  informar de que las paginas de terceros pueden tener su propia politica.

## Aceptacion

- PRD-012-A01: corpus hostil no provoca crash, lectura local, solicitudes fuera
  de politica ni crecimiento ilimitado; pruebas de red y puente incluidas.
- PRD-012-A02: permisos denegados/revocados tienen UI recuperable y no dejan
  capturas o tareas activas; camara deshabilitada por marca nunca se concede.
- PRD-012-A03: revision documentada de modelo de amenazas y permisos por target;
  inspeccion de build/logs sin secretos; hallazgos criticos resueltos antes de beta.

## Decisiones

Definir origenes/destinos permitidos sin impedir radiodifusores externos, retencion y
contenido del soporte exportado. Cumplimiento de tiendas se verifica en PRD-014;
este PRD no constituye certificacion legal ni de seguridad.