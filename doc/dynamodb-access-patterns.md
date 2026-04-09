# DynamoDB — patrones de acceso (tabla core single-table)

Tabla física: `PK` (HASH), `SK` (RANGE). Índices: **GSI1**, **GSI2**.

## Entidades

| PK | SK | entityType | GSI1 | GSI2 |
|----|-----|------------|------|------|
| `TENANT#<id>` | `META#TENANT` | TENANT | — | — |
| `TENANT#<id>` | `PORTFOLIO#<id>` | PORTFOLIO | — | — |
| `TENANT#<id>` | `PROJECT#<id>` | PROJECT | — | — |
| `TENANT#<id>` | `ASSET#<id>` | ASSET | GSI1PK=`TENANT#..#PROJECT#..`, GSI1SK=`ASSET#..` | GSI2PK=`TENANT#..#TYPE#..`, GSI2SK=`ASSET#..` |
| `TENANT#<id>` | `ASSET#<aid>#REV#<fid>` | REV_FACT | — | — |
| `TENANT#<id>` | `ASSET#<aid>#COST#<fid>` | COST_FACT | — | — |
| `TENANT#<id>` | `IMPORT#<jobId>` | IMPORT | — | — |

## Patrones

1. **Obtener tenant / portfolio / proyecto / activo** — `GetItem(PK, SK)`.
2. **Listar portfolios** — `Query PK=TENANT#.. AND SK begins_with PORTFOLIO#`.
3. **Listar proyectos** — `Query PK=TENANT#.. AND SK begins_with PROJECT#` + filtro opcional `portfolioId` en app.
4. **Listar activos por proyecto** — `Query GSI1` con `GSI1PK=TENANT#..#PROJECT#..`.
5. **Listar activos por tipo** — `Query GSI2` con `GSI2PK=TENANT#..#TYPE#..`.
6. **Listar activos (todos en tenant)** — `Query PK` + `FilterExpression entityType=ASSET` (MVP; optimizar con entidad secundaria si crece).
7. **Hechos de ingreso/costo por activo** — `Query PK` + `SK begins_with ASSET#<aid>#REV#` o `#COST#`.
8. **Import jobs** — `GetItem` con `SK=IMPORT#..`.

## Tablas auxiliares (fuera de esta tabla)

- **Auditoría** (`APIP_AUDIT_TABLE_NAME`): append-only, consulta por tiempo/tenant (definir en stack aparte).
- **Jobs de import** (opcional): puede permanecer en core como `IMPORT#` hasta volumen alto.

Actualizar este documento cuando cambien GSIs o se extraigan entidades a nuevas tablas.
