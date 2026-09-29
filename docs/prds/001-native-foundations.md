# PRD-001: Proyectos nativos y arquitectura

Prioridad: P0. Estado: parcial en bibliotecas, pendiente en aplicaciones.
Dependencias: ninguna. Consumidores: todos los demas PRD.

## Objetivo y alcance

Obtener dos aplicaciones instalables e independientes de React Native/Expo,
manteniendo las bibliotecas de dominio separadas de UI, red y reproductor.
Android: Kotlin con Jetpack Compose. iOS: Swift con SwiftUI y adaptadores UIKit
cuando los componentes de plataforma lo requieran. No cambiar la app RN durante
el desarrollo paralelo ni ubicar fuentes en los outputs ignorados de Expo.

## Requisitos

- PRD-001-R01: crear modulo Android de aplicacion bajo `native/android` y target
  iOS versionado bajo `native/ios`; resolver explicitamente como reproducir el
  proyecto Xcode sin pasos manuales no documentados.
- PRD-001-R02: integrar los cores existentes; ninguna dependencia runtime de
  React Native, Hermes o Expo en los binarios finales. Node puede generar recursos.
- PRD-001-R03: separar descubrimiento, sesion, sincronizacion, catalogo, playback
  y web mediante contratos testeables. Inyectar reloj, transporte y reproductor.
- PRD-001-R04: definir propietarios de tareas, sockets y reproductores; aislar
  estado mutable y ejecutar red/parsing fuera del hilo UI. Cancelacion estructurada.
- PRD-001-R05: crear navegacion descubrimiento, detalle de TV, reproductor,
  experiencia web y ayuda; soportar regreso, rotacion y recreacion de pantalla.
- PRD-001-R06: separar identidad de desarrollo de produccion cuando se requiera
  coexistencia. No decidir IDs definitivos fuera de la fuente de marca.
- PRD-001-R07: fijar toolchains/dependencias compatibles, wrapper y procedimiento
  limpio de build; documentar SDK minimo/target y macOS/Xcode requeridos.
- PRD-001-R08: compilar y probar el core Swift antes de ampliar su integracion;
  resolver diferencias de APIs/Sendable con el compilador, no con el editor solo.

## Aceptacion

- PRD-001-A01: checkout limpio produce APK debug y app de simulador iOS con
  comandos documentados; arranque muestra navegacion sin Metro ni servidor Node.
- PRD-001-A02: pruebas de core Kotlin y Swift ejecutadas en CI; cero errores de
  compilacion. Inspeccion de dependencias confirma ausencia de runtime RN/Expo.
- PRD-001-A03: abrir/cerrar pantallas y recrear la actividad/vista no duplica
  workers ni recursos; prueba instrumentada y evidencia de logs.

## Pendientes y exclusiones

Elegir versiones minimas a partir de audiencia y APIs reales. Swift Package
por si solo no es una app iOS. Firmas/distribucion se aceptan en PRD-014;
funcionalidad de cada pantalla se acepta en su PRD, no con pantallas vacias.

Referencias: [core Android](../../native/android/core/build.gradle.kts),
[paquete Swift](../../native/ios/Package.swift), [App actual](../../App.js).