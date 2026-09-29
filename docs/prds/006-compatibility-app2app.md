# PRD-006: Modos de compatibilidad y canal App2App

Prioridad: P0. Estado: pendiente. Dependencias: 004, 005.

## Objetivo

Conservar TVs/experiencias que usan el transporte de compatibilidad y el canal
bidireccional de aplicacion, sin confundir disponibilidad con sincronizacion lograda.

## Requisitos

- PRD-006-R01: sondear nativo y compatibilidad independientemente y en paralelo;
  confirmar disponibilidad solo tras CII real con endpoints utilizables.
- PRD-006-R02: en compatibilidad validar que WC y TS corresponden al mismo
  perfil App2App; cancelar sondas al cambiar/abandonar terminal.
- PRD-006-R03: no iniciar el motor completo ni canal app durante la sonda;
  exponer solamente modos confirmados y ocultar selector hasta tener alguno.
- PRD-006-R04: respetar preferencia guardada esperando su sonda; fallback
  temporal no sobrescribe preferencia. Solo seleccion explicita la modifica.
- PRD-006-R05: implementar codec/transporte de compatibilidad a partir del
  contrato existente, incluyendo emparejamiento, cierre, reconexion y mensajes vacios.
- PRD-006-R06: parametros de control diferenciados por modo y live/VOD, con
  comportamiento de seeks compatible y mediciones separadas en pruebas.
- PRD-006-R07: canal `<prefix>-app` en ambos modos: carga opaca bidireccional,
  sin reescritura de contenido, limites de tamano/colas y descarte al cambiar sesion.
- PRD-006-R08: reflejar modo efectivo y estado de recuperacion; no alternar
  indefinidamente entre transportes ante errores intermitentes.

## Aceptacion

- PRD-006-A01: matriz nativo solo, compat solo, ambos, ninguno y sonda lenta;
  seleccion y preferencia resultantes coinciden con las reglas anteriores.
- PRD-006-A02: fixture con endpoints de perfiles distintos se rechaza;
  payloads App2App sobreviven ida/vuelta sin corrupcion ni cruce de sesiones.
- PRD-006-A03: cambiar modo cancela conexiones anteriores y reinicia correlacion;
  no aparecen dos correctores activos sobre el mismo reproductor.
- PRD-006-A04: perdida y retorno del canal recupera sin replay de mensajes
  de una sesion anterior; fallos de app-message no se confunden con fallo de CII.

## Decisiones

Definir limites de mensajes, buffering y estrategia de reconexion; mantener el
contrato de la web existente antes de proponer una nueva version del protocolo.

Referencias: [App2App](../../src/services/App2AppChannelService.js),
[preferencias](../../src/utils/MediaSyncModePreferences.js),
[orquestacion](../../src/services/MediaSyncService.js).