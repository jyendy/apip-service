# Modelo de datos DynamoDB (APIP)

## Tablas desplegadas

| Tabla        | CloudFormation | Uso |
|-------------|----------------|-----|
| `apip-core` | `data-stack.yaml` → `ApipCoreTable` | **Single-table** de entidades de negocio |
| `apip-audit` | `data-stack.yaml` → `ApipAuditTable` | Auditoría append-only (evolución futura) |

**Modo de capacidad**: `PAY_PER_REQUEST` (on-demand).

## Single-table `apip-core`

### Claves

| Atributo | Uso |
|----------|-----|
| `PK` | Partition key — `TENANT#{tenantId}` |
| `SK` | Sort key — patrón por entidad (ver abajo) |

### Índices globales

| Índice | PK | SK | Uso |
|--------|----|----|-----|
| `GSI1` | `GSI1PK` | `GSI1SK` | Listar **activos por proyecto**: `TENANT#{tenantId}#PROJECT#{projectId}` → `ASSET#{assetId}` |
| `GSI2` | `GSI2PK` | `GSI2SK` | Listar **activos por tipo**: `TENANT#{tenantId}#TYPE#{assetType}` → `ASSET#{assetId}` |

Proyección: `ALL` (items completos en GSI).

### Registro global de tenants (admin)

| Uso | PK | SK |
|-----|----|-----|
| Listado de todos los tenants | `PLATFORM#REGISTRY` | `TENANT#{tenantId}` |

Se escribe al crear/actualizar un tenant (`putTenant`). Permite `Query` eficiente sin `Scan`. Los tenants creados antes de esta convención requieren backfill (ver `doc/todos.md`).

### Patrones de SK (implementación en `src/lib/keys.ts`)

| Entidad | SK típico |
|---------|-----------|
| Meta tenant | `META#TENANT` |
| Portfolio | `PORTFOLIO#{portfolioId}` |
| Project | `PROJECT#{projectId}` |
| Asset | `ASSET#{assetId}` |
| Revenue fact (por activo) | `ASSET#{assetId}#REV#{factId}` |
| Cost fact (por activo) | `ASSET#{assetId}#COST#{factId}` |
| Proyecto Flipping (1:1 con activo `flip`) | `FLIP#PROJECT#{assetId}` |
| Ítem due diligence Flipping | `FLIP#DD#{assetId}#{itemId}` |
| Rehabilitación Flipping | `FLIP#REHAB#{assetId}#{rehabId}` |
| Import job | `IMPORT#{jobId}` |

### Atributos por ítem

Todos los ítems incluyen `tenantId` y `entityType` para filtrado en queries amplias donde aplique.

- **Asset**: incluye `portfolioId`, `projectId`, `initialInvestment`, y opcionalmente **`financialModel`** (simulación: ingresos/costo mensuales estimados, horizonte, tasas de crecimiento).
- **RevenueFact / CostFact**: `date` ISO, `amount`, `category`, `source` (`manual`, `import`, `api`, `real_estate`, `flipping`); agregación mensual en el servicio de métricas. Los rehabs Flipping crean `CostFact` con `sourceRef: { kind: flip_rehab, id }`.
- **FlipProject / FlipDueDiligenceItem / FlipRehab**: datos operativos del módulo Flipping; no duplican métricas calculadas.

### Diseño

- Un **tenant** no comparte PK con otro; el aislamiento es estricto por `PK = TENANT#{id}`.
- Los hechos de ingreso/costo se almacenan como ítems hijos bajo el mismo PK tenant con SK que prefija el `assetId`, permitiendo `Query` por prefijo `ASSET#{assetId}#REV#` / `#COST#`.
- No se requiere tabla adicional para el modelo dual **simulación + real**: la simulación vive en el documento del **Asset**; la operación real en **facts** (y opcionalmente import jobs en S3 referenciados por metadata).

## Tabla `apip-audit`

- Claves: `PK`, `SK` (diseño libre por evento).
- Uso previsto: eventos de dominio y trazabilidad; no bloquea el MVP de lectura/escritura core.

## Despliegue

```bash
aws cloudformation deploy --stack-name apip-data --template-file infra/cloudformation/stacks/data-stack.yaml ...
```

Los nombres de tabla se exportan (`apip-core-table-name`, etc.) para consumo por el stack `api-stack`.
