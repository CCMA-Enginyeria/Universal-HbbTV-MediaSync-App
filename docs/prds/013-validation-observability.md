# PRD-013: Calidad, paridad y observabilidad

Prioridad: P0. Estado: tests de core/loopback Kotlin y fixtures iniciales.
Dependencias: requisitos funcionales 001-012; pruebas se desarrollan con cada uno.

## Objetivo

Demostrar que las apps sustituyen la referencia RN con evidencia reproducible,
sin confundir simulacion matematica con sincronizacion audiovisual percibida.

## Requisitos

- PRD-013-R01: matriz requisito -> caso -> plataforma -> dispositivo -> evidencia;
  inventario de paridad firmado antes de retirar funcionalidades RN.
- PRD-013-R02: unit tests de codecs, estados y controladores; fixtures compartidos
  y tolerancias explicitas. Cambiar fixtures exige revisar cambio de comportamiento.
- PRD-013-R03: integracion con TV emulator y servidores locales para perdida,
  jitter, retrasos, paquetes malformados, endpoints cambiantes y desconexiones.
- PRD-013-R04: pruebas UI instrumentadas y matriz fisica: Android/iOS, versiones
  minimas y representativas, varios fabricantes TV, Wi-Fi y rutas de audio.
- PRD-013-R05: medir arranque, descubrimiento, tiempo a primera pista, deriva
  p50/p95/max, seeks, reconexion, memoria, CPU y bateria. Separar nativo/compat/web.
- PRD-013-R06: protocolo audiovisual de referencia para medir desfase real;
  indicar instrumento, fuente temporal, duracion y condiciones, no solo logs internos.
- PRD-013-R07: logs estructurados con IDs efimeros, estados y unidades;
  diagnostico de transporte/reloj/player sin contenido personal por defecto.
- PRD-013-R08: soak tests y repeticion de ciclos de escaneo, playback y cambio
  de contenido para detectar fugas; probar background e interrupciones reales.
- PRD-013-R09: CI falla si un test requerido no se ejecuta. Reportes conservados
  con commit/toolchain; test Swift pendiente se representa como pendiente, no aprobado.

## Presupuestos y gate

Antes de beta, medir RN en la misma matriz y aprobar umbrales numericos para
descubrimiento, startup, precision por modo/ruta, recuperacion y consumo. Registrar
valores y responsable en una tabla versionada. Umbral sin definir bloquea el gate,
no significa aprobado. Objetivo inicial: sin regresion frente a baseline aprobado.

## Aceptacion

- PRD-013-A01: todas las pruebas requeridas Kotlin/Swift y UI pasan en CI o en
  matriz fisica documentada; excepciones explicitas y aprobadas.
- PRD-013-A02: cada metrica tiene baseline, umbral, resultado y evidencia;
  ningun requisito de precision se cierra solo por las 985 decisiones del controlador.
- PRD-013-A03: 30 minutos de playback y 20 ciclos de descubrimiento/cancelacion
  por plataforma sin acumulacion de recursos; analizar tambien cambios de red.
- PRD-013-A04: matriz de paridad no tiene P0 omitidos, pruebas no ejecutadas
  presentadas como exito ni crashes/bloqueos conocidos sin resolver.

## No incluido

Telemetria remota obligatoria o tracking de espectadores. Cualquier incorporacion
requiere decision de privacidad y cambio de alcance.

Referencias: [emulador](../../tools/tv-emulator),
[CI core](../../.github/workflows/native-core.yml), [fixtures](../../native/fixtures/sync-controller.tsv).