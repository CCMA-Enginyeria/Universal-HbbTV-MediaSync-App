# PRD-011: Companion web, Custom Tabs y fallback DASH

Prioridad: P0. Estado: pendiente en apps nativas. Dependencias: 002, 005-007, 012.

## Objetivo

Mantener experiencias web sincronizadas y comunicacion App2App sin exigir a
los radiodifusores que reescriban sus paginas al sustituir React Native.

## Requisitos

- PRD-011-R01: Android: Custom Tabs con canal validado cuando sea viable y
  fallback WebView explicito. iOS: WKWebView con puente nativo equivalente;
  no asumir que un navegador externo ofrece el mismo canal bidireccional.
- PRD-011-R02: preservar envelope versionado, init, position, app-message y
  sync-ack; conservar campos, unidades y semantica de companionProtocol existente.
- PRD-011-R03: compatibilidad con listener message, callback legacy y retorno
  usado por paginas existentes. Exponer adaptador compatible si la pagina espera
  `window.ReactNativeWebView.postMessage`, sin incluir runtime React Native.
- PRD-011-R04: handshake antes de enviar, cadencia acotada, descarte de mensajes
  obsoletos y nuevo init tras navegacion/recreacion. Asociar mensajes a sesion/origen.
- PRD-011-R05: App2App bidireccional conserva payload; limitar tipos, tamanos,
  colas y rechazar mensajes/origen no autorizados. No evaluar codigo recibido.
- PRD-011-R06: cambio web -> web recarga de forma coherente; web -> media o fin
  de contenido informa y permite cerrar. Cierre restaura pantalla y limpia puente.
- PRD-011-R07: conservar ruta DASH iOS con reproductor web configurado por marca
  hasta demostrar alternativa aceptada. Distinguir esta via del playback AVPlayer.
- PRD-011-R08: camara solo por opt-in de marca, origen y accion legitima, con
  permiso SO; denegar microfono y otras capacidades no aprobadas.
- PRD-011-R09: errores de validacion de Custom Tabs, carga, handshake y red
  tienen fallback visible y recuperacion; no abrir multiples instancias por reintento.
- PRD-011-R10: medir sincronizacion en web, fullscreen y segundo plano por separado;
  documentar limites antes de afirmar paridad con audio nativo.

## Aceptacion

- PRD-011-A01: demo actual recibe init/position y devuelve sync-ack/app-message
  desde WebView Android, WKWebView y Custom Tab validada cuando corresponda.
- PRD-011-A02: fixtures prueban contrato y legacy; mensajes de pagina anterior,
  origen distinto y tamano excesivo son rechazados sin contaminar otra sesion.
- PRD-011-A03: fallo de validacion o falta de proveedor Custom Tabs permite
  continuar por fallback sin perder contexto ni asumir un canal inexistente.
- PRD-011-A04: contenido DASH de referencia funciona en iPhone por la ruta
  aprobada; cambios de contenido y permisos de camara se prueban fisicamente.

## Decisiones y limites

Verificar Digital Asset Links, origen validado y APIs actuales en implementacion.
Browser externo sin puente no cuenta como sustituto de experiencia sincronizada.
Redisenar paginas de radiodifusores o cambiar version del protocolo requiere acuerdo aparte.

Referencias: [protocolo](../../src/utils/companionProtocol.js),
[apertura](../../src/utils/companionWebLaunch.js),
[Custom Tabs](../../src/utils/CustomTabsMessaging.js),
[demo](../../www/hbbtv_examples/sync_app/index.html).