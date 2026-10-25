# Architecture Principles

(Qué es el producto y su taxonomía → `product.md`. Aquí solo principios de arquitectura y los gotchas de Bedrock.)

## AWS Architecture

- Serverless-first; reutiliza la arquitectura existente del repo antes de añadir.
- Lambda, DynamoDB, S3, API Gateway, CloudFront, Bedrock. Evita infra con coste en reposo.
- NO introducir RDS, ECS, EKS, OpenSearch ni vector DB sin justificación explícita (son V1 out-of-scope, ver `conventions.md`).
- Procesamiento asíncrono (SQS + worker) para imports multi-documento; nunca mantener abierta una request.
- Infra reproducible solo vía CDK (config a mano por CLI la pisa el siguiente deploy).

## Engineering

- TypeScript estricto. Zod en los límites externos.
- Lógica determinista preferida; reutiliza patrones del repo. Construye vertical (slice completo), no todas las capas backend primero.
- Mantén `make validate` verde.

## AI

- Bedrock es la única plataforma AI (sin abstracción multi-proveedor en V1).
- Salidas AI con esquemas estructurados; recomendaciones explicables, nunca un score opaco solo.
- Bedrock SOLO para extracción estructurada + explicación escrita (worker) y para draftear el perfil (`POST /profile/import|/sync`). Todo lo demás es determinista.

## Bedrock en eu-south-2 (gotchas que causaron bugs reales)

- La familia Nova en **eu-south-2 NO es invocable on-demand**: requiere un **inference profile**. El id on-demand (`amazon.nova-2-lite-v1:0`, sin prefijo) da `ValidationException`. Verifica con `list-foundation-models` (inferenceTypesSupported) + `list-inference-profiles`.
- **Default REAL del repo = perfil GLOBAL** `global.amazon.nova-2-lite-v1:0` (`BEDROCK_MODEL_ID` en `api-stack.ts`, overridable por env). Se eligió el GLOBAL (`global.*`) sobre el EU (`eu.*`) para que AWS enrute a la región menos cargada de toda la partición y reduzca throttling.
- **Un inference profile enruta a CUALQUIERA de sus regiones.** La policy IAM debe cubrir el `foundation-model` ARN de TODAS ellas o falla con `AccessDenied` intermitente según dónde enrute ese día. `api-stack.ts` ya lo resuelve por tipo de prefijo:
  - `global.*` → wildcard de región `arn:aws:bedrock:*::foundation-model/<id>` + inference-profile `arn:aws:bedrock:*:<acct>:inference-profile/<id>`.
  - `eu.*` → `arn:aws:bedrock:eu-*::foundation-model/<id>` (una lista hardcodeada omitió eu-south-1 → AccessDenied; por eso el wildcard `eu-*`).
  - on-demand sin prefijo → ARN regional único (no funciona para Nova aquí).
  - El `::` (namespace del owner) es seguro: no amplía cuentas. Diagnostica regiones reales con `get-inference-profile --query models[].modelArn`.
- Worker "silenciosamente degradado" (fetch OK, extracción OK con creds admin, pero la Lambda degrada el mismo input) suele ser el **rol de ejecución de la Lambda**, no el código. Añade logging estructurado en los puntos de fallo y persiste el `failureReason` real.
