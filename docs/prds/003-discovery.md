# PRD-003: Descubrimiento y seleccion de televisores

Prioridad: P0. Estado: core/transporte parcial; UI y validacion fisica pendientes.
Dependencias: 001, 002, 012. Entrega: M1.

## Objetivo y recorrido

Al abrir la app, el usuario puede buscar TVs en la red local, ver resultados
progresivos, seleccionar una y repetir o cancelar sin resultados obsoletos.
Estados: permiso necesario, sin red, buscando, resultados, sin resultados y error.

## Requisitos

- PRD-003-R01: integrar M-SEARCH DIAL, respuestas unicast, descripcion XML,
  Application-URL y consulta HbbTV. No inferir Application-URL desde LOCATION.
- PRD-003-R02: preservar parsing con namespaces, nombres/modelos, filtro HbbTV,
  limite de cuerpos y rechazos seguros existentes; probar TVs reales que usen
  variantes de cabeceras antes de endurecer compatibilidad adicional.
- PRD-003-R03: publicar resultados incrementales en Android e iOS; deduplicar
  peticiones pendientes y dispositivos. Identidad estable no dependiente del nombre.
- PRD-003-R04: elegir interfaz de red apropiada, gestionar IPv4 multicast y
  cambios de Wi-Fi/VPN; informar falta de conectividad sin afirmar que no hay TVs.
- PRD-003-R05: reintentos M-SEARCH acotados y resolucion HTTP con concurrencia
  limitada, para que una TV lenta no bloquee el resto. Parametros configurables.
- PRD-003-R06: cancelar sockets, HTTP, callbacks y timers al reemplazar escaneo;
  ignorar resultados de generaciones antiguas y mantener resultados al finalizar.
- PRD-003-R07: diferenciar timeout, permiso denegado, fallo de envio y respuesta
  no compatible; ofrecer reintento y acceso contextual a ajustes/ayuda.
- PRD-003-R08: decidir y propagar explicitamente allowNonHbbtvDevices. Si se
  habilita, mostrar la limitacion y no ofrecer sincronizacion inexistente.
- PRD-003-R09: pruebas del transporte Swift equivalentes a Kotlin, incluidos
  cancelacion HTTP, redirecciones, limites de cuerpo y timeout global.

## Aceptacion

- PRD-003-A01: TV/emulador responde a M-SEARCH y aparece una vez con nombre y
  estado; una segunda TV lenta no retrasa todos los resultados hasta el timeout.
- PRD-003-A02: veinte ciclos buscar/cancelar/rebuscar no acumulan sockets ni
  resultados antiguos; callback de peticion vieja no actualiza la lista nueva.
- PRD-003-A03: descubrimiento demostrado en Android e iPhone fisicos con permisos
  concedidos; denegacion y cambio de red tienen estados recuperables.
- PRD-003-A04: tests de protocolo, red local y UI pasan; registrar latencia de
  descubrimiento y tasa de exito para el gate de PRD-013.

## No incluido y decisiones

No escanear rangos IP ni enviar informacion fuera de la red para encontrar TVs.
Soporte IPv6 y multiples interfaces simultaneas: P2 salvo necesidad demostrada.
Revisar politica de reintento, expiracion de resultados e identidad del terminal.

Referencias: [servicio actual](../../src/services/DIALDiscoveryService.js),
[transporte Kotlin](../../native/android/core/src/main/kotlin/mediasync/core/DialDiscoveryScan.kt),
[transporte Swift](../../native/ios/Sources/MediaSyncCore/DialDiscoveryScan.swift).