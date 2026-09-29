# PRD-009: Segundo plano, interrupciones y rutas de audio

Prioridad: P0. Estado: pendiente en apps independientes. Dependencias: 004, 008.

## Objetivo

Mantener audio privado sincronizado al bloquear o minimizar, dentro de las
capacidades autorizadas por cada plataforma, y parar de forma predecible.

## Requisitos

- PRD-009-R01: Android: propietario de reproduccion/servicio foreground,
  notificacion y controles asociados a una sesion real. Revisar tipos de servicio,
  permisos y restricciones del target al implementar.
- PRD-009-R02: iOS: configurar sesion de audio y capacidad background apropiadas;
  verificar ejecucion con audio real. No usar audio silencioso para mantener procesos.
- PRD-009-R03: reloj, sockets y correccion no dependen del ciclo de dibujo UI;
  al volver a foreground validar frescura de correlacion antes de corregir.
- PRD-009-R04: foco de audio/interrupciones, llamada, auriculares desconectados,
  Bluetooth y cambio de salida tienen una politica explicita y segura.
- PRD-009-R05: controles del sistema reflejan estado; detener libera recursos.
  No anunciar controles de seek local si contradicen el timeline maestro.
- PRD-009-R06: reaccionar a perdida de red, TV apagada y fin del contenido;
  evitar servicio/notificacion huerfanos. Documentar limites tras cierre forzado.
- PRD-009-R07: medir latencia por ruta de audio, bateria y estabilidad; evaluar
  necesidad de compensacion de salida sin prometer sincronizacion Bluetooth universal.

## Aceptacion

- PRD-009-A01: sesion de audio de 30 minutos en dispositivo fisico, incluyendo
  bloqueo y regreso, con resultados de deriva/bateria registrados por plataforma.
- PRD-009-A02: interrupcion, desconexion de auriculares y cambio de ruta no
  producen audio inesperado; reanudacion sigue la politica aprobada.
- PRD-009-A03: detener desde UI o sistema elimina audio y recursos; muerte del
  proceso no deja estado falso al abrir de nuevo.
- PRD-009-A04: reproducir sin UI no necesita runtime RN; comportamiento de
  segundo plano web se prueba aparte y no hereda esta garantia automaticamente.

## Decisiones y riesgos

Definir politica de auto-reanudacion y presupuesto de bateria. La elegibilidad
background del SO no garantiza ejecucion indefinida ni excepcion a sus restricciones.

Referencias: [wrapper actual](../../src/utils/ForegroundSync.js),
[modulo actual](../../modules/foreground-sync), [configuracion](../../app.config.js).