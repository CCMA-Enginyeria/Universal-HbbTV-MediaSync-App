# PRD-014: CI/CD, distribucion y sustitucion de React Native

Prioridad: P0. Estado: CI de core inicial; distribucion nativa pendiente.
Dependencias de cierre: 001-013.

## Objetivo

Entregar builds firmadas y actualizables para ambas plataformas y retirar RN
solo cuando exista evidencia de paridad y una estrategia de recuperacion.

## Requisitos

- PRD-014-R01: pipelines de checkout limpio: recursos de marca, tests, build
  Android debug/release e iOS simulador/archive. macOS para las etapas iOS requeridas.
- PRD-014-R02: secretos de firma/provisioning por entorno, acceso minimo,
  artefactos identificados por version/commit y firmas verificadas sin exponer claves.
- PRD-014-R03: decidir continuidad de package/bundle IDs, firma, versionCode/build
  y distribucion actual. No prometer actualizacion in-place sin verificar identidad.
- PRD-014-R04: inventario de preferencias RN; migrar las necesarias con esquema
  versionado e idempotente, o aprobar reset comunicado. No copiar caches/sesiones caducas.
- PRD-014-R05: pruebas de instalacion limpia y actualizacion desde version RN;
  validar enlaces/esquemas, permisos, preferencias, assets y comportamiento offline.
- PRD-014-R06: beta por plataforma con matriz de dispositivos y checklist de
  seguridad/accesibilidad. Publicacion gradual y criterios de pausa de rollout.
- PRD-014-R07: revisar requisitos de tienda, privacidad, capturas, textos en los
  idiomas soportados, soporte y licencias en el momento de publicar.
- PRD-014-R08: plan de recuperacion con build correctiva compatible y versiones
  monotonicamente crecientes; no asumir que tiendas permiten downgrade de binarios.
- PRD-014-R09: retirar dependencias/workflows RN solo despues del gate de paridad;
  conservar implementacion de referencia y fixtures en historial/tag documentado.
- PRD-014-R10: actualizar README, instrucciones de fork/build y soporte para que
  Expo/Metro no sean pasos necesarios del producto nativo publicado.

## Aceptacion

- PRD-014-A01: APK/AAB y archive iOS firmados desde CI autorizada, con logs y
  dependencias auditables; builds funcionan sin entorno de desarrollo.
- PRD-014-A02: instalacion/actualizacion reproducidas en dispositivos reales;
  identidad, preferencias y permisos cumplen la decision de migracion aprobada.
- PRD-014-A03: gate PRD-013 aprobado para ambas plataformas y revision PRD-012
  cerrada; diferencias de paridad aprobadas antes de anunciar sustitucion.
- PRD-014-A04: ensayo documentado de detener rollout y emitir build correctiva;
  responsables y canales de soporte definidos antes de produccion.
- PRD-014-A05: nuevo fork produce sus builds con su configuracion y firma,
  sin editar codigo funcional ni incorporar credenciales del proyecto original.

## Decisiones y exclusiones

Confirmar propietarios de cuentas, claves y autorizaciones; estos PRD no autorizan
publicar, subir secretos, crear tags ni eliminar la app RN. Publicacion efectiva
y cambios de identidad requieren aprobacion explicita del responsable del producto.

Referencias: [pipeline Android actual](../../.github/workflows/build-android.yml),
[marca](../../src/brand/brand.config.js), [estado nativo](../../native/README.md).