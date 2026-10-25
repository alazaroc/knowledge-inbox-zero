# Project Structure

```
.
├── shared/             # @app/shared — tipos, constantes, zod, lógica MKV pura (build primero)
├── frontend/           # React SPA (Vite + Tailwind + PWA + Amplify/Cognito)
│   └── src/{components,context,lib,pages/{app,auth}}  # api.ts con retry/backoff; AuthContext
├── backend/            # Lambdas por dominio
│   └── src/{handlers,lib,__tests__}
├── infra/cdk/          # CDK: bin/app.ts + lib/{storage,auth,api,frontend}-stack.ts, naming.ts
├── mcp-server/         # servidor MCP standalone (no es workspace de build; ver docs/mcp.md)
├── browser-extension/  # extensión de navegador (empaquetada aparte)
├── scripts/            # deploy.sh, create-user.sh, set-password.sh, dev-frontend.sh
└── Makefile            # interfaz única de comandos
```

Convenciones de handlers backend → `conventions.md` (no duplicar aquí).

## Dominios (un handler Lambda cada uno, salvo pre-signup que es trigger Cognito)

- **`profile`** (`/profile` GET/PUT, `/profile/import` POST, `/profile/sync` POST): CRUD del `Profile` único por usuario. Determinista EXCEPTO `import` (draftea perfil desde texto/CV pegado con una llamada Bedrock; no persiste, solo prellena) y `sync` (re-fetch LIVE del fichero fuente configurado y refresca el perfil). Lee/escribe el Secret `profile-tokens` (token privado por usuario para repos privados).
- **`imports`** (`/imports`, `/imports/{batchId}`): crea batches desde URLs pegadas, canonicaliza+dedup, encola análisis a SQS, sirve progreso. Determinista. Nunca llama a Bedrock.
- **`documents`** (`/documents` GET, `/documents/{id}` GET/PATCH/DELETE, `/documents/{id}/reanalyze` POST): library (agrupada + counts + paginación) y detalle. GET/PATCH/DELETE + reanalyze NO es read-only: reanalyze resetea el doc a pending, ajusta COUNTS, crea un batch de un doc y re-encola a SQS. No llama a Bedrock directamente (lo hace el worker).
- **`analysis-worker`**: disparado por SQS (no es ruta API). Pipeline por doc: fetch → readability → extracción Bedrock → scoring MKV determinista → explicación Bedrock → persiste → counters atómicos. **Único que escribe en el bucket S3 de contenido**; invoca Bedrock (como `profile`).
- **`users`** (`/users`, `/users/me`, `/users/{username}`): gestión Cognito. Todo requiere rol ADMIN salvo `/users/me`.
- **`pre-signup`**: trigger Cognito. Auto-confirma la cuenta (`autoConfirmUser=true`) pero deja `email_verified=false` a propósito → la verificación es un banner no-bloqueante in-app, no un paso obligatorio. **Sign-up es público** (`selfSignUpEnabled: true`), no invite-only.

## Dónde va cada cosa

- **Tipos/schemas/constantes + lógica pura** → `shared/src` (property-tested una vez, reusado por API y worker).
- **Lógica API** → `backend/src/handlers/<dominio>.ts`.
- **Helpers backend** → `backend/src/lib/`: `auth`, `dynamo` (doc client `ddb`), `handler-utils` (authenticate/parseBody), `response`, `ids` (newId/now), `zod-errors`, `bedrock`, `retrieve` (fetch + Readability). No inlinear en handlers.
- **Infra**: tablas + bucket en `storage-stack.ts`; rutas, Lambdas, SQS queue/DLQ, Secret `profile-tokens`, IAM, GSIs y policy Bedrock en `api-stack.ts`; Cognito en `auth-stack.ts`.
- **Páginas front** → `frontend/src/pages/`; backend vía `lib/api.ts`, sesión vía `context/AuthContext.tsx`, rutas en `App.tsx`.

## Modelo de datos (DynamoDB, una tabla por entidad, PAY_PER_REQUEST, PITR, RETAIN)

4 tablas (`users, profiles, batches, documents`) + 1 Secret (`profile-tokens`) + bucket S3.

- **`profiles`** — un item por usuario. PK `userId` (Cognito `sub`). Sin SK ni GSI.
- **`batches`** — un item por batch. PK `batchId`. GSI `byOwner` (PK `ownerId`, SK `createdAt`, newest-first). Líneas rechazadas en array acotado dentro del item.
- **`documents`** — un item por URL canónica por owner. PK `documentId` = `sha256(ownerId#canonicalUrl)` → re-import = upsert idempotente. GSIs: `byOwner` (library+cursor, SK `documentId`), `byOwnerState` (filtro por estado, SK `stateKey`), `byBatch` (worker+progreso). Item agregado de counts por owner (`documentId="COUNTS#<ownerId>"`) con `ADD` atómico → counts O(1) independientes de paginación.
- **`users`** — perfil de app (auth vive en Cognito). PK `userId`, GSI `byEmail`.
- **Bucket S3 contenido** (`{project}-content-{env}`, BLOCK_ALL, SSE-S3, RETAIN): offload de texto extraído cuando supera 300 KB. Key `{ownerId}/{documentId}.txt`; el doc guarda `s3ContentRef`.

## Naming

- Recursos AWS: `{project}-{domain}-{env}` (`naming.standard()`).
- Paquetes internos: scope fijo `@app/*`.
- Imports ESM de `.ts` locales usan extensión `.js` (`../lib/dynamo.js`).
