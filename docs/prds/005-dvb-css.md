# PRD-005: Motor DVB-CSS y control de sincronizacion

Prioridad: P0. Estado: controlador portado; WC/CII/TS y orquestacion pendientes.
Dependencias: 004. Consumidores: 006-011.

## Objetivo

Derivar la posicion de TV desde reloj y timeline y gobernar un reproductor sin
depender de timers JavaScript. Conservar precision numerica y comportamiento
observable antes de retocar los parametros para nativo.

## Requisitos

- PRD-005-R01: cliente CSS-CII con actualizaciones parciales, contentId,
  endpoints, selectores de timeline y cambios de disponibilidad.
- PRD-005-R02: cliente CSS-WC UDP: codec binario, tipos de mensaje usados por
  la implementacion actual, timestamps, RTT, offset, dispersion y descarte de
  muestras invalidas/obsoletas. Probar endianess, rangos y overflow.
- PRD-005-R03: cliente CSS-TS WebSocket: setup, control timestamps, velocidad,
  pausa y timeline no disponible. Seleccionar timeline anunciado, no asumir
  universalmente PTS a 90 kHz aunque sea el caso habitual.
- PRD-005-R04: reloj monotono local y correlacion con WC; no usar fecha de pared
  para calcular deriva. Preservar enteros grandes al decodificar y convertir unidades.
- PRD-005-R05: extrapolar posicion, frescura e incertidumbre; detener correccion
  cuando no haya una correlacion fiable, con estado visible para el usuario.
- PRD-005-R06: integrar SyncController existente con configuracion real de la
  app por modo/live, no solo defaults. Distinguir none/rate/seek y reset de sesion.
- PRD-005-R07: evitar doble correccion por eventos simultaneos, seeks solapados
  y oscilacion tras buffering. Aplicar periodo de asentamiento medido.
- PRD-005-R08: gestionar reconexion independiente y cambio de endpoints;
  recursos y correlaciones antiguas no sobreviven a una sesion nueva.
- PRD-005-R09: capturar medidas reproducibles de deriva, RTT y dispersion con
  unidades y origen; no prometer una precision fisica a partir solo del modelo.

## Aceptacion

- PRD-005-A01: fixtures equivalentes Kotlin/Swift para codecs y timeline,
  incluidos pausa, salto, rollover/rangos, paquetes truncados y endpoints cambiantes.
- PRD-005-A02: mantener las 985 decisiones del controlador como gate; sumar
  casos de configuracion usada en RN y muestras malformadas en la frontera.
- PRD-005-A03: TV/emulador reproduce, pausa, busca y cambia contenido sin
  corregir contra un timeline anterior; reconexion recupera correlacion valida.
- PRD-005-A04: registrar precision en dispositivos conforme al protocolo y
  umbrales aprobados en PRD-013, por plataforma, modo y ruta de audio.

## Limites y riesgos

El port del controlador no equivale a un motor sincronizado completo. No se
garantiza sincronizacion con una TV que no ofrece timeline valido. Retocar
dead-time/ganancias requiere medicion; cambios de comportamiento deben documentarse.

Referencias: [diseno actual](../MEDIA_SYNC.md),
[WC](../../src/services/CSSWCServiceUDP.js), [CII](../../src/services/CSSCIIService.js),
[TS](../../src/services/CSSTSService.js), [configuracion](../../src/utils/config.js).