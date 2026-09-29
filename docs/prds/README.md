# PRD de migracion nativa

Fecha de referencia: 2026-09-25. Rama de trabajo: `native-apps`.
Estado: borradores para revision; los requisitos propuestos no implican una
decision de producto aprobada ni una funcionalidad terminada.

## Objetivo de producto

Sustituir la aplicacion React Native por aplicaciones Android Kotlin e iOS Swift
que permitan descubrir un televisor HbbTV, seleccionar contenido complementario
y consumirlo sincronizado: audio privado, video alternativo, subtitulos y web
companion. Mantener interoperabilidad con los radiodifusores existentes y forks por marca.

Usuarios: espectadores, personas que utilizan contenido accesible, radiodifusores que
publican experiencias y equipos que distribuyen una marca de la aplicacion.

No se incluye cambiar los protocolos publicados por los televisores, desarrollar
firmware, cuentas de usuario, pagos, analitica comercial, casting generalista ni
DRM nuevo. Una necesidad adicional debe incorporarse mediante una decision de alcance.

## Inventario y orden

| PRD | Area | Dependencias principales | Estado al redactar |
| --- | --- | --- | --- |
| [001](001-native-foundations.md) | Proyectos Android e iOS | Ninguna | Bibliotecas existentes; sin apps |
| [002](002-brand-localization-accessibility.md) | Marca, idiomas y accesibilidad | 001 | Fuente de marca y traducciones en RN |
| [003](003-discovery.md) | DIAL/SSDP y pantalla de dispositivos | 001, 002, 012 | Core y transporte parciales |
| [004](004-session-lifecycle.md) | Sesiones y estado de producto | 001, 003 | Pendiente |
| [005](005-dvb-css.md) | WC, CII, TS y sincronizacion | 004 | Solo controlador de deriva portado |
| [006](006-compatibility-app2app.md) | Compatibilidad y App2App | 004, 005 | Pendiente |
| [007](007-content-catalog.md) | Contenido, MPD y pistas | 004, 005 | Pendiente |
| [008](008-native-playback.md) | Audio/video nativos | 005, 007 | Pendiente |
| [009](009-background-audio.md) | Segundo plano y rutas de audio | 004, 008 | Modulos Expo como referencia |
| [010](010-subtitles.md) | TTML, VTT y presentacion | 005, 007, 008 | Pendiente |
| [011](011-companion-web.md) | Web companion y DASH iOS | 002, 005, 006, 007, 012 | Implementacion RN como referencia |
| [012](012-security-permissions.md) | Seguridad, privacidad y permisos | 001 | Controles parciales en core |
| [013](013-validation-observability.md) | Pruebas, diagnostico y rendimiento | Todos los PRD funcionales | Pruebas JVM y CI iniciales |
| [014](014-release-cutover.md) | CI, distribucion y retirada RN | 001-013 | Pendiente |

Las dependencias son de integracion/aceptacion, no impiden trabajar en paralelo
con contratos y dobles de prueba. PRD-012 es transversal desde el primer incremento;
PRD-013 incorpora pruebas desde cada entrega, no solo al final.

## Hechos actuales y limites

- El estado de implementacion y la evidencia por requisito se mantienen en la
  [matriz de paridad](parity-matrix.md). La tabla anterior conserva el estado
  historico al redactar los PRD, no el estado actual.
- `native/android/core` contiene descubrimiento, sesiones, DVB-CSS, App2App,
  contenido, subtitulos y control de reproduccion. Se han ejecutado 59 tests JVM
  correctamente, incluido el recorrido contra el emulador de TV.
- Hay 985 decisiones de referencia JavaScript para el controlador de deriva.
- `native/ios` contiene el port Swift y pruebas. Compilacion y ejecucion en macOS
  siguen pendientes; ausencia de diagnosticos del editor no demuestra validez.
- Existen la app Android Compose y el target iOS SwiftUI (XcodeGen). El APK
  Android compila y lint no informa errores; no se ha generado un IPA.
- No se ha demostrado multicast ni reproduccion nativa en dispositivos fisicos.
- El descubrimiento reintenta M-SEARCH, resuelve hasta cuatro dispositivos
  concurrentemente y publica resultados incrementales en ambas plataformas.
- El [modelo de amenazas](threat-model.md) documenta controles y limites.
- La app React Native sigue siendo referencia funcional; no se eliminara antes
  de cumplir el gate de sustitucion de PRD-014.

## Hitos propuestos

1. M0: proyectos instalables, recursos por marca, permisos y CI de compilacion
   para ambas plataformas (001, 002, 012 y parte de 014).
2. M1: descubrir y seleccionar una TV real, cancelar y repetir sin fugas
   (003, 004; prueba de humo Android e iOS).
3. M2: recibir y mostrar estado de sincronizacion DVB-CSS y compatibilidad
   con fixtures y emulador reproducibles (005, 006).
4. M3: seleccionar y reproducir audio/video, con control de deriva, subtitulos
   y segundo plano (007-010).
5. M4: experiencias web y fallback DASH iOS con contrato bidireccional (011).
6. M5: beta, matriz de paridad, seguridad y distribucion firmada (012-014).

## Reglas de seguimiento

Cada requisito usa `PRD-NNN-Rxx`; cada aceptacion usa `PRD-NNN-Axx`. Al crear
issues, incluir ID, plataforma, responsable, dependencias y evidencia de cierre.
No se asignan fechas, responsables ni estimaciones inventadas en estos documentos.

Un requisito esta terminado cuando hay implementacion, pruebas aplicables,
evidencia en su plataforma y documentacion. Una excepcion necesita motivo,
impacto para usuarios y aprobacion registrada. El soporte asimetrico Android/iOS
debe ser visible: no marcar un PRD completo porque solo funciona en Android.

Prioridad P0: necesaria para sustitucion; P1: puede diferirse solo con excepcion
aprobada sin ocultar perdida de paridad; P2: mejora fuera del gate inicial.
Todos los requisitos son P0 salvo indicacion explicita.

## Decisiones que bloquean aceptacion

- Version minima y target de cada plataforma, toolchains y dispositivos soportados (001).
- Politica productiva de dispositivos DIAL no HbbTV (003; RN la habilita en configuracion).
- Seleccion activa unica frente a sesiones simultaneas (004; propuesta: una).
- Formatos/codecs reales, ruta DASH iOS y contenido protegido (007, 008, 011).
- Umbrales de precision, bateria, memoria, latencia y reconexion medidos y aprobados
  antes de aceptar resultados (013); no prometer precision sin medicion.
- Continuidad de identidad, firma, preferencias y publicacion (014).

## Referencias

- [Estado nativo](../../native/README.md)
- [Producto actual](../../README.md)
- [Sincronizacion actual](../MEDIA_SYNC.md)
- [Marca](../../src/brand/brand.config.js)

Estos PRD describen el producto objetivo a partir del repositorio. Los requisitos
de sistemas operativos, tiendas y SDK deben verificarse con documentacion oficial
al implementar y al publicar; no se fijan aqui politicas externas como hechos vigentes.