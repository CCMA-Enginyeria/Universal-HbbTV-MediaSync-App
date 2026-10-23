# PRD-015: Asistentes de voz (Siri/App Intents, Gemini/App Functions)

Prioridad: P2. Estado: fases 1-3 implementadas. Android (App Functions y
herramientas de pagina) validado en Pixel 8a (Android 17) con un televisor Vewd
real y la pagina del asistente 3Cat; iOS sin compilar ni probar en dispositivo.
Dependencias: 003, 004, 007, 011, 012.

## Objetivo

Que Siri, Atajos, Spotlight y Gemini puedan consultar los televisores disponibles,
el estado de la sincronizacion y el contenido, y lanzar la escucha privada sin
tocar la pantalla. Lo que dependa del contenido del radiodifusor (EPG, fichas,
votaciones, estadisticas...) lo aporta la web sincronizada, no la app.

## Decisiones

- La app no integra EPG ni DVB-I. Un radiodifusor que quiera responder a
  "que estan emitiendo" carga una web sincronizada que lo ofrece y expone esa
  capacidad como herramienta (fase 3).
- Una fachada por plataforma (`AssistantCommands`) sobre los mismos modelos que
  la UI: un comando de voz y un toque tienen el mismo efecto y no hay estado propio.
- Los cores no cambian salvo reglas compartidas; la eleccion de audio
  (`AudioPreference`) vive en ambos cores con fixture `audioPreference`.
- Textos en `native/i18n/native-strings.json` (`native.assistant.*`, 7 idiomas).
  Las frases de Siri (`native.assistant.phrases.*`) se exportan solo a iOS
  `AppShortcuts.strings`, con clave igual al literal ingles del codigo Swift;
  `export-brand.cjs --check` verifica que existen y que nombran la app.

## Requisitos

- PRD-015-R01: verbos comunes en ambas plataformas: buscar televisores, estado,
  conectar (con modo opcional), escuchar (elige audio) y detener.
- PRD-015-R02: respuestas en segundos: descubrimiento acotado a 4 s, conexion a
  10 s y contenido a 10 s mas; si no se alcanza se responde "conectando", no error.
- PRD-015-R03: sin televisor explicito se usa el abierto o el unico compatible;
  con varios, el asistente pregunta cual.
- PRD-015-R04: conectar y escuchar abren la app (permiso de red local, reproductor
  web DASH en el dock, servicio en primer plano en Android).
- PRD-015-R05: audio elegido: todo antes que audiodescripcion, luego idiomas del
  usuario (ISO 639-1 o 639-2), luego rol principal, luego orden del manifiesto.
- PRD-015-R06: diagnostico estructurado sin nombres de televisor, URLs ni payloads.
- PRD-015-R07 (fase 3): la web sincronizada declara herramientas (forma WebMCP:
  nombre, descripcion, JSON Schema) por el puente companion; la app las expone con
  una accion generica. Solo origenes permitidos por la marca, sin acceso a comandos
  nativos y con confirmacion para acciones con efectos.

## Fases

1. iOS: App Intents (iOS 17+) y App Shortcuts; `native/ios/App/Sources/Assistant*.swift`.
2. Android: App Functions (Android 16+, `androidx.appfunctions` alpha, exige
   compileSdk 37 y AGP 9.1) en `native/android/app/.../assistant/`.
3. Herramientas de la web sincronizada (R07): sobres `tools`, `tool-call` y
   `tool-result` en ambos cores (fixture `companionTools`); Android las expone con
   `listCompanionTools` y `runCompanionTool`. Las intents iOS equivalentes faltan.

## Contrato de herramientas de pagina

- Pagina -> app: `{"version":1,"type":"tools","tools":[{name,description,inputSchema}]}`
  (maximo 16; nombre `^[A-Za-z][A-Za-z0-9_.-]{0,63}$`; descripcion <= 1024; esquema
  objeto <= 8 KB; las entradas invalidas se descartan). Reenviar en cada `init`.
- App -> pagina: `{"version":1,"type":"tool-call","id","name","arguments":{...}}`.
- Pagina -> app: `{"version":1,"type":"tool-result","id","result"?,"error"?}`;
  objetos se serializan; resultado <= 16 KB.
- Cliente de referencia: `registerTools()` e `installModelContext()` (shim WebMCP)
  en `custom-tabs-sync-client.js` (repositorio dvb-i-mcp).

## Limitaciones conocidas

- Android bloquea abrir una actividad desde el servicio de App Functions (BAL): la
  reproduccion arranca igualmente (el servicio en primer plano se permite mientras el
  sistema mantiene el servicio enlazado), pero una pagina no abierta solo se abre con
  la app en primer plano. Pendiente: devolver un `PendingIntent` que lance el agente.
- Las paginas deben servirse con `Cache-Control: no-cache` o versionar sus scripts:
  el WebView reutiliza copias antiguas.

## Aceptacion

- PRD-015-A01: en iPhone, "Escucha la tele con <app>" con un unico televisor
  compatible abre la app, conecta y reproduce el audio del idioma del sistema.
- PRD-015-A02: con dos televisores Siri pregunta cual; con ninguno responde por que.
- PRD-015-A03: el estado describe televisor, sincronizacion, pista y paginas web.
- PRD-015-A04: fixtures `audioPreference` pasan en Kotlin y Swift.
