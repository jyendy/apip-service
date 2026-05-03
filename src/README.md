# Código (Lambda)

Handlers y módulos compartidos en **TypeScript**, empaquetados para Node.js 20.x.

Convención sugerida (ajustar al scaffolding real):

- Handlers por dominio o por recurso REST (`handlers/`, o agrupación por feature)
- Lógica de dominio desacoplada de API Gateway (`services/`, `domain/`)
- Validación de entrada (p. ej. Zod)
- Cliente DynamoDB y utilidades en `lib/` o `shared/`

Añade `package.json`, `tsconfig.json` y tests cuando se inicialice el toolchain.
