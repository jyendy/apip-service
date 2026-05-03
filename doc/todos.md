# APIP — backlog y seguimiento

Documento vivo para decisiones técnicas pendientes. Actualizar al cerrar ítems.

## Motor financiero (simulación + real)

- [x] **Motor híbrido** en `computeAssetMetrics` (`SIMULATION` / `ACTUAL` / `HYBRID`, serie mensual unificada). Ver `doc/financial-engine.md`.
- [x] `GET /v1/assets/{id}/metrics`: `dataMode`, `coverage`, `totalCosts`, `cashFlow[].mode`.
- [x] Tests básicos (`src/services/metrics.test.ts`) para solo modelo, solo hechos, híbrido.
- [ ] Casos límite documentados en tests: activo sin `financialModel` y sin hechos (serie vacía); validación con datos reales de negocio.

## Importaciones

- [ ] Procesamiento asíncrono de `POST /v1/imports/assets` (SQS/Lambda worker, validación de filas, reporte de errores en S3).
- [ ] Plantilla CSV documentada y versionada (`templateVersion`).

## Tenants y admin

- [ ] **Migración**: tenants creados antes de `PLATFORM#REGISTRY` no aparecen en `GET /v1/admin/tenants` hasta ejecutar script de backfill del registro.
- [ ] Grupo Cognito `apip-platform-admin` (o el definido en `PLATFORM_ADMIN_GROUP`) creado y asignación de usuarios root documentada.
- [ ] (Opcional) `DELETE /v1/admin/tenants/{id}` con política de borrado en cascada o prohibición si hay datos.
- [ ] **Onboarding requests (pricing → solicitud de alta)**:
  - [ ] **Anti-spam**: rate limit por IP/email (TTL) y/o challenge (Turnstile/hCaptcha) en `/v1/public/onboarding-requests`.
  - [ ] **Idempotencia/dedupe**: evitar duplicados por email en ventana corta; devolver el request existente si aplica.
  - [ ] **SLA**: definir promesa de respuesta (p. ej. 24h hábiles) y reflejarla en UI + correos/manual.
  - [ ] **Consentimiento**: checkbox obligatorio de Términos/Privacidad antes de enviar solicitud.

## Operacional (TMS, Real Estate, etc.)

- [ ] Contrato de **eventos** o **API de ingesta** por módulo operativo hacia `PUT /v1/assets/{id}/cash-flows` o facts granulares.
- [ ] Metadatos por tipo de asset (`metadata` en Asset + convenciones por `type`).

## API Gateway / CORS

- [ ] Validar preflight desde el dominio real del front (restringir `AllowOrigins` en producción).
- [ ] Si algún cliente requiere credenciales (`AllowCredentials: true`), ajustar CORS y orígenes (no compatibles con `*`).

## Observabilidad

- [ ] Correlación `requestId` en logs Lambda.
- [ ] Métricas de error 4xx/5xx por ruta.

## Seguridad y repositorios

- [ ] **Revisión de datos sensibles en repos** (`apip-front`, `apip-service`, `apip-policies`): inspeccionar historial y árbol actual (`.env*`, claves, tokens, secretos en YAML/CI); rotar credenciales si hubo exposición; purgar del historial lo versionado por error si aplica; validar `.gitignore`, hooks opcionales y revisión en PR/CI.
