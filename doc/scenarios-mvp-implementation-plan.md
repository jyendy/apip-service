# Plan de Implementacion MVP - Scenarios

## Objetivo

Permitir que el usuario analice metricas por contexto de decision sin duplicar el motor financiero:

- `actual`: activos reales (estado actual del portafolio)
- `simulated`: activos de escenarios de planeacion
- `combined`: reales + assets del escenario simulado seleccionado

Resultado esperado de producto:

1. Ver lo que tiene hoy.
2. Modelar lo que tendra.
3. Ver impacto combinado sin doble conteo.

## Decisiones cerradas (acordadas)

- `scenarioId` nulo se interpreta como `actual` (compatibilidad hacia atras).
- No se agregara `scenarioType` en `Asset` (se deriva desde `Scenario.type`).
- No se implementara `quantity` en MVP.
- Se agregaran indices/patrones de acceso desde el inicio.
- Semantica temporal limitada en MVP para reducir complejidad.
- RBAC de escenarios sera igual al de assets reales en MVP.
- `dashboard` e `insights` soportaran `?scenario=` en MVP.
- Se hara migracion masiva para escenario `actual` (entornos con datos de prueba).
- CRUD de escenarios sera completo en MVP.
- Auditoria de escenarios al mismo nivel que el resto de entidades.
- Un asset pertenece a un solo escenario a la vez.
- No se usara `linkedAssetId` en MVP.
- Para `simulated` y `combined` se selecciona un solo escenario activo.

## Alcance MVP

Incluye:

- Entidad `Scenario`.
- Soporte de `scenarioId` en `Asset`.
- Filtro de escenarios en endpoints de metricas.
- Modo `combined` simple (`actual + escenario simulado seleccionado`).
- UI con selector `Actual | Plan | Total` y badge de contexto.
- Flujo basico para crear escenario y agregar activos simulados.

No incluye:

- Versionado de escenarios.
- Comparacion multi-escenario avanzada.
- Flujos complejos de linking/reconciliacion.
- Logica temporal avanzada por fecha efectiva.

## Modelo de dominio propuesto

### `Scenario`

Campos:

- `id: string`
- `tenantId: string`
- `portfolioId: string`
- `projectId: string`
- `name: string`
- `type: "actual" | "simulated"`
- `createdAt: string`
- `createdBy: string`

Reglas:

- Cada `projectId` debe tener exactamente 1 escenario `actual` por defecto.
- Puede haber multiples escenarios `simulated` en BD por proyecto.
- Para metricas `simulated` o `combined` el cliente envia un solo `scenarioId` (el escenario simulado activo en UI); los calculos usan solo ese escenario.

### `Asset`

Cambios:

- Agregar `scenarioId?: string` (opcional por compatibilidad).

Reglas:

- Si `scenarioId` es `null`/ausente, el activo se considera `actual`.
- Si `scenarioId` existe, debe apuntar a un `Scenario` valido del mismo `tenantId` y `projectId`.
- Un activo solo puede pertenecer a un escenario a la vez.
- Convertir `simulated -> actual`: `PATCH /v1/assets/{id}` con `scenarioId` igual al **id** del escenario `actual` del proyecto (no un string magico `actual`), mas auditoria. Alternativa compatible: `scenarioId` nulo si se mantiene la regla de fallback a actual.

## Semantica de calculo (MVP)

Se reutiliza el motor actual (`computeAssetMetrics` y agregaciones existentes).  
Escenario solo actua como filtro de seleccion de activos.

### `scenario=actual`

Incluir:

- Activos con `scenarioId` nulo.
- Activos cuyo `scenarioId` referencia un `Scenario.type = "actual"`.

### `scenario=simulated`

Incluir:

- Activos del unico `scenarioId` simulado seleccionado por el usuario.

### `scenario=combined`

Incluir:

- Todos los activos `actual`.
- Activos del unico `scenarioId` simulado seleccionado.

## API y contratos

### Extensiones a endpoints existentes

- `GET /v1/assets/{id}/metrics?scenario=actual|simulated|combined`
- Endpoints de `dashboard` e `insights` con el mismo query param.

Reglas:

- Default `scenario=actual`.
- Si llega un valor invalido, responder `400 VALIDATION`.
- Para `scenario=simulated` y `scenario=combined` se requiere `scenarioId`.
- Si falta `scenarioId` en esos modos, responder `400 VALIDATION`.

### Nuevos endpoints (CRUD completo de escenarios)

- `POST /v1/scenarios`
- `GET /v1/scenarios?projectId=...`
- `GET /v1/scenarios/{id}`
- `PATCH /v1/scenarios/{id}`
- `DELETE /v1/scenarios/{id}`
- `POST /v1/scenarios/{id}/assets`
- `GET /v1/scenarios/{id}/assets`

Notas:

- En MVP, permisos de estos endpoints = mismos permisos que gestion de assets.
- Auditoria obligatoria con el mismo nivel aplicado a otras entidades.

## Persistencia e indices (desde dia 1)

Objetivo: evitar degradacion en listados y agregaciones por filtro de escenario.

Minimo recomendado:

1. Indice para assets por contexto:
   - `tenantId + projectId + scenarioId`
2. Indice para activos actuales por fallback:
   - `tenantId + projectId` (para resolver `scenarioId` nulo de forma eficiente)
3. Indice para escenarios:
   - `tenantId + projectId + type`

Nota: ajustar nombres concretos de PK/SK/GSI a la estrategia actual de Dynamo del servicio.

## Migracion

Estrategia sin downtime y idempotente:

1. Desplegar backend con logica de lectura compatible (`scenarioId` nulo => `actual`).
2. Crear `Scenario actual` por proyecto (script/migrador idempotente).
3. Backfill por lotes para asignar `scenarioId` default a activos existentes (incluido en MVP).
4. Mantener fallback aun despues del backfill para robustez.

## Plan por fases (implementacion)

### Fase 1 - Backend base

- Crear entidad/repositorio de `Scenario`.
- Extender schema `Asset` con `scenarioId`.
- Validaciones de integridad (`tenantId`/`projectId` consistentes).
- Tests unitarios de dominio.

### Fase 2 - Motor y endpoints

- Agregar `scenario` como filtro en servicios de metricas/agregacion.
- Agregar `scenarioId` obligatorio para `simulated/combined`.
- Implementar logica `actual/simulated/combined`.
- Exponer query param en endpoints relevantes.
- Tests de no regresion del motor + casos de doble conteo.

### Fase 3 - Frontend MVP

- Selector de escenario a nivel proyecto (`Actual | Plan | Total`).
- Badge persistente de contexto de vista.
- Reutilizar vistas actuales cambiando solo fuente de datos (`scenario` param).
- CRUD completo de escenarios (crear, listar, editar y eliminar).
- Crear flujo de alta de activos simulados por escenario.

### Fase 4 - Migracion y rollout

- Ejecutar migracion idempotente de escenarios default.
- Validar rendimiento y exactitud de metricas.
- Activacion gradual por entorno (dev -> stg -> prd).

## Estrategia de pruebas

### Unitarias

- Filtro por cada modo de escenario.
- `combined` incluye `actual + escenario simulado seleccionado`.
- Validacion de defaults (`scenario=actual`, `scenarioId` nulo).
- Validacion de regla: un activo pertenece a un solo escenario a la vez.
- Validacion: `simulated/combined` fallan sin `scenarioId`.

### Integracion

- Flujo completo: crear escenario -> agregar activos simulados -> consultar metricas por modo.
- Compatibilidad con activos antiguos sin `scenarioId`.

### Regresion financiera

- Mismo input `actual` debe producir mismas metricas que antes del feature.
- Comparar snapshots de KPIs clave en proyectos reales.

## Riesgos y mitigaciones

- Riesgo: confusion por seleccionar escenario incorrecto.
  - Mitigacion: selector unico visible + badge persistente + validaciones de API.
- Riesgo: inconsistencias entre asset y scenario.
  - Mitigacion: validaciones de integridad en escritura.
- Riesgo: impacto de performance en agregaciones.
  - Mitigacion: indices desde inicio + pruebas de carga basicas en dev/stg.

## Checklist de salida a produccion

- [ ] Endpoints aceptan `scenario` y mantienen default `actual`.
- [ ] KPIs de `actual` no cambian vs baseline previo.
- [ ] `combined` refleja `actual + escenario seleccionado` segun regla 1-asset-1-scenario.
- [ ] UI muestra claramente el contexto de escenario.
- [ ] Migracion idempotente ejecutada.
- [ ] Monitoreo/alertas revisados post deploy.

## Decision cerrada - conversion `simulated -> actual`

- `PATCH /v1/assets/{id}` con `scenarioId` apuntando al escenario `actual` canonico del proyecto (o `null` si el producto unifica con fallback), siempre con auditoria igual que otros cambios de asset.

## Siguiente paso sugerido

Cuando se retome este trabajo, iniciar por un PR de backend pequeno (Fase 1 + parte de Fase 2) con tests de compatibilidad hacia atras, y luego encadenar frontend en un PR separado.
