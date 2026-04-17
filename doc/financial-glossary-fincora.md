# Glosario financiero — Fincora (Asset Intelligence Platform)

Documento para **equipos no financieros** y referencia técnica. Las fórmulas descritas coinciden con el motor del **backend** (`src/services/metrics.ts`, `src/financial/engine.ts`). La interfaz **no recalcula** métricas; solo muestra lo que devuelve la API.

**Versión de cálculo** (`calculationVersion` en respuestas): ver constante `CALCULATION_VERSION` en `src/financial/engine.ts`.

---

## 1. Conceptos base

### Inversión inicial (CAPEX)

**Qué es:** dinero que se paga al adquirir o poner en marcha el activo (una sola vez, al inicio).

**En la plataforma:** `initialInvestment` del activo.

**Para no financieros:** es el “precio de entrada” del proyecto; lo demás son entradas y salidas mes a mes.

---

### Serie mensual unificada

**Qué es:** mes a mes, desde la fecha de adquisición, se construye **un solo flujo** que mezcla datos reales y proyección del modelo cuando falten hechos.

**En la plataforma:** array `cashFlow[]` en métricas del activo. Cada punto tiene `revenue`, `costs`, `netCashFlow`, `cumulativeCashFlow`, `mode` (`ACTUAL` o `PROJECTED`).

**Para no financieros:** es la “película” mes a mes del activo: un mes puede ser dato real y el siguiente estimado, pero la secuencia es continua para poder calcular TIR y VAN de forma coherente.

---

### Modo de datos (`dataMode`)

| Valor        | Significado breve                                      |
| ------------ | ------------------------------------------------------- |
| `SIMULATION` | Solo proyección con `financialModel` (sin hechos).      |
| `ACTUAL`     | Todo el horizonte cubierto con hechos operativos.        |
| `HYBRID`     | Mezcla de meses reales y meses proyectados.            |

**Para no financieros:** indica cuánto de lo que ves es “contabilidad real” y cuánto es “supuesto del modelo”.

---

## 2. Flujo de caja y utilidad por mes

### Ingreso y costo del mes

**Ingreso mensual** \( \text{rev}_m \): suma de ingresos reales del mes o, si no hay hechos, ingreso proyectado del modelo.

**Costo mensual** \( \text{cost}_m \): suma de costos por categoría (directos, operación, mantenimiento, depreciación, otros) o costo proyectado del modelo.

**En la plataforma:** `cashFlow[].revenue`, `cashFlow[].costs`.

---

### Flujo de caja neto (mes)

**Definición:**

\[
\text{netCashFlow}_m = \text{rev}_m - \text{cost}_m
\]

**Para no financieros:** “cuánto queda en la caja ese mes” después de pagar costos, antes de pensar en la inversión inicial como flujo del mismo formato (la inversión se trata aparte en TIR; ver sección TIR).

---

### Flujo acumulado

**Definición:**

\[
\text{cumulative}_m = \sum_{k=0}^{m} \text{netCashFlow}_k
\]

**Para no financieros:** va sumando mes a mes lo que va quedando; sirve para ver tendencia y se relaciona con el concepto de recuperación de la inversión.

---

### Proyección con crecimiento (modelo)

Si no hay datos reales para un mes pero sí hay `financialModel`, el motor proyecta ingreso y costo con tasas de crecimiento **anual en puntos porcentuales** (ej. `3` = 3 % anual).

Para el mes índice \(i\) (0 = primer mes desde adquisición):

\[
g_{\text{rev}} = \frac{\text{revenueGrowthRate}}{100 \cdot 12}, \quad
g_{\text{cost}} = \frac{\text{costGrowthRate}}{100 \cdot 12}
\]

\[
\text{rev}_i = \text{estimatedMonthlyRevenue} \cdot (1 + g_{\text{rev}})^{i}, \quad
\text{cost}_i = \text{estimatedMonthlyCost} \cdot (1 + g_{\text{cost}})^{i}
\]

**Para no financieros:** el modelo puede suponer que ingresos y costos crecen un poco cada mes según el % anual que configuraste.

---

## 3. Agregados del horizonte (activo)

### Ingresos acumulados

\[
\text{accumulatedRevenue} = \sum_m \text{rev}_m
\]

---

### Costos totales

\[
\text{totalCosts} = \sum_m \text{cost}_m
\]

(suma de todos los buckets de costo del motor).

---

### Costos operativos (campo `operatingCosts` en métricas)

**Definición en código:** costos operativos + mantenimiento + depreciación (no incluye solo “operativos” del mapa de hechos; es un agregado reportado).

\[
\text{operatingCosts} = \text{operational} + \text{maintenance} + \text{depreciation}
\]

(sumas acumuladas en el horizonte).

**Para no financieros:** bloque de gastos recurrentes y contables que el producto agrupa bajo esa etiqueta en el API.

---

### EBITDA (definición del motor)

\[
\text{EBITDA} = \text{accumulatedRevenue} - \text{directCosts} - \text{operational} - \text{maintenance}
\]

(es decir, ingresos acumulados menos esos costos; **no** resta depreciación ni “other” en esta fórmula del motor).

**Para no financieros:** aproxima “ganancia operativa bruta” del periodo analizado según las categorías que usa la plataforma; no es un EBITDA contable auditado si los datos de entrada no lo son.

---

### Utilidad neta (`netProfit`)

\[
\text{netProfit} = \sum_m \text{netCashFlow}_m
\]

(suma de todos los flujos netos mensuales del horizonte).

**Para no financieros:** resultado global del periodo sumando mes a mes lo que sobra o falta.

---

## 4. ROI (retorno sobre la inversión) — API

**Definición en backend:**

\[
\text{ROI}_{\%} = \frac{\text{netProfit}}{\text{initialInvestment}} \times 100
\]

Si `initialInvestment` es 0, el ROI devuelto es 0.

**Para no financieros:** “por cada 100 pesos invertidos, cuántos pesos de ganancia neta acumulada obtuve en el horizonte”, en porcentaje. Es un indicador **simple** sobre todo el periodo, **no** anualizado obligatoriamente.

**Nota UI:** en el detalle de activo puede existir otro indicador tipo “margen simple anualizado” basado solo en el mes 1 del modelo; **no** es el mismo número que el `roi` de la API. El ROI de métricas es el de la fórmula anterior.

---

## 5. TIR / IRR (tasa interna de retorno) — API

### Idea

Es la tasa de descuento **mensual** \(r\) que hace que el valor presente de **todos** los flujos (incluida la inversión inicial como salida en el mes 0) sea cero.

**Serie que usa el motor:**

\[
F_0 = -\text{initialInvestment}, \quad F_m = \text{netCashFlow}_{m-1} \quad (m = 1, 2, \ldots)
\]

(índice 0 = inversión; los meses del activo siguen en \(F_1, F_2, \ldots\)).

### Ecuación del VAN mensual

\[
\text{NPV}(r) = \sum_{t=0}^{T} \frac{F_t}{(1+r)^t} = 0
\]

El backend resuelve \(r\) con **Newton-Raphson** y, si hace falta, **bisección** en un intervalo acotado; luego convierte a **tasa anual efectiva**:

\[
\text{IRR}_{\text{anual \%}} = \left( (1+r)^{12} - 1 \right) \times 100
\]

**Para no financieros:** responde “¿qué rentabilidad anual equivaldría a este calendario de entradas y salidas?”, asumiendo reinversión al mismo ritmo mes a mes (tasa efectiva anual).

**Importante:** lo que ves en tablas/gráficos como “neto del mes” es \(F_1, F_2, \ldots\). La inversión inicial **no** aparece en esa fila del mes, pero **sí** entra en el cálculo de la TIR como \(F_0\).

---

## 6. VAN / NPV (valor presente neto) — API

**Entrada:** solo los flujos **netos mensuales** del activo (sin prefijar \(-I\) en el array de esta función; el motor usa `nets`).

**Tasa:** en el código actual de métricas se usa **descuento anual fijo 10 %** (`0.1`) convertido a tasa mensual equivalente:

\[
d = (1 + 0.1)^{1/12} - 1
\]

\[
\text{NPV} = \sum_{t=0}^{T-1} \frac{\text{nets}_t}{(1+d)^t}
\]

**Para no financieros:** “¿cuánto vale hoy la suma de los flujos futuros si exijo ganar al menos un 10 % anual?”. Si el VAN es positivo, el proyecto supera ese umbral; si es negativo, no lo supera **al 10 %** (no es “bueno o malo” en absoluto sin ver la tasa elegida).

---

## 7. Payback (meses de recuperación)

**Definición en código:** primer mes en el que la suma acumulada de `nets` (solo flujos operativos mensuales, **sin** modelar el signo de la inversión dentro de `nets`) alcanza o supera `initialInvestment`:

Se recorre `nets` en orden acumulando hasta que `cum >= initialInvestment`; el resultado es el número de meses (1-based) o la longitud total si nunca se alcanza.

**Para no financieros:** “¿en cuántos meses, sumando solo los excedentes mensuales, recupero lo invertido?” Puede diferir de definiciones contables que descuenten intereses o usen flujos distintos.

---

## 8. Simulador de inversión (API `/v1/simulations`)

Construye una serie mensual de ingresos/costos con crecimiento:

\[
g = \frac{\text{growthRatePercent}}{100 \cdot 12}
\]

Cada mes \(i\): ingresos y costos multiplicados por \((1+g)^i\); el neto es ingreso − costo. La TIR y el VAN de la simulación siguen la misma lógica del motor (`src/http/router.ts` + `engine.ts`).

**Para no financieros:** es un “jugador de escenarios” con reglas fijas de la plataforma, alineado al backend.

---

## 9. Agregados en portfolio / proyecto / inversor

Suelen aparecer:

- **ROI ponderado por inversión:** suma de \((\text{ROI del activo} \times \text{inversión})\) dividida entre capital total desplegado.
- **IRR promedio:** media aritmética de las TIR de los activos considerados (no siempre coincide con la TIR de un flujo consolidado único).

**Para no financieros:** son resúmenes de cartera; la TIR media **no** es lo mismo que “TIR del portfolio fusionado”.

---

## 10. Depuración y alertas

- **`APIP_DEBUG_IRR_CASHFLOWS`:** variable de entorno del **servicio** (p. ej. Lambda). Si vale `1` o `true`, se registran detalles de flujos y resolución de TIR en logs (CloudWatch en AWS).
- **Advertencia de TIR:** si la TIR anual efectiva queda fuera de \([-100\%, +100\%]\), el servicio emite un `console.warn` (casos extremos o proyectos muy cortos con rentabilidad enorme anualizada).

---

## 11. Lecturas relacionadas

- `doc/financial-engine.md` — principios de producto y motor híbrido.
- `doc/api-contract.md` — contrato de métricas y campos obligatorios.

Si cambia la versión de cálculo, actualizar este glosario cuando las fórmulas diverjan del código.
