# PRD-004: Sesiones, navegacion y recuperacion

Prioridad: P0. Estado: pendiente. Dependencias: 001, 003.

## Objetivo

Seleccionar una TV y mantener un estado coherente entre conexion, contenido,
reproductor y companion web, incluso con cambios de red o de contenido.

## Requisitos

- PRD-004-R01: definir maquina de estados: desconectado, sondeando transportes,
  conectando, esperando contenido, sincronizando, listo, reproduciendo,
  recuperando y error. Exponer causa y acciones posibles, no solo booleanos.
- PRD-004-R02: un propietario de sesion controla CII/WC/TS/App2App, player,
  subtitulos y web. Identificador de generacion en operaciones asincronas.
- PRD-004-R03: propuesta inicial: una TV/sesion de reproduccion activa; cambiar
  de TV cancela y libera la anterior. Confirmar esta restriccion en matriz de paridad.
- PRD-004-R04: cambios de contentId, timeline o endpoints invalidan trabajo
  anterior y reconstruyen solo lo necesario, sin reproducir contenido obsoleto.
- PRD-004-R05: reconexion con backoff acotado, sin tormentas ni listeners
  duplicados; distinguir indisponibilidad temporal, contenido ausente y error fatal.
- PRD-004-R06: navegar atras, colapsar detalle, cerrar web y detener playback
  tienen semantica explicita; audio activo solo persiste conforme a PRD-009.
- PRD-004-R07: preservar preferencias de usuario con version/esquema de storage;
  no guardar URLs temporales como verdad ni reanudar automaticamente una sesion
  invalida tras muerte del proceso.
- PRD-004-R08: modelos de estado separados de UI, con errores tipados y pruebas
  usando reloj/transporte falsos. Ayuda y reintento disponibles desde fallos.

## Aceptacion

- PRD-004-A01: cambiar A -> B mientras A conecta nunca muestra datos ni reproduce
  pistas de A en B; todos los recursos de A quedan liberados.
- PRD-004-A02: TV pausada, sin contenido o apagada produce estados distintos;
  reconexion recupera solo si la generacion sigue vigente.
- PRD-004-A03: rotacion/recreacion no duplica conexiones; muerte de proceso y
  regreso recuperan preferencias sin intentar continuar con sockets antiguos.
- PRD-004-A04: pruebas de transiciones validas/invalidas y fallo en cada fase,
  incluyendo perdida/retorno de red y cancelacion en paralelo.

## Decisiones

Definir politica de continuar audio al salir del detalle y confirmacion al cambiar
de TV. Multi-TV simultanea no forma parte de la propuesta inicial.

Referencias: [orquestador](../../src/services/MediaSyncService.js),
[UI actual](../../src/components/TerminalItem.js),
[preferencias](../../src/utils/MediaSyncModePreferences.js).