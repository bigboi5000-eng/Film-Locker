---
name: Orval zod barrel duplicate export fix
description: Orval regenerates lib/api-zod/src/index.ts with both generated/api and generated/types exports, causing TS2308 when schemas are named the same as Zod validators.
---

## The rule
After orval runs (in the `zod` codegen output), it regenerates `lib/api-zod/src/index.ts` with two `export *` lines — one for `./generated/api` (Zod schemas) and one for `./generated/types` (TypeScript types). Both export identically-named symbols, causing TS2308 "already exported" errors.

**Fix:** The `lib/api-spec/package.json` codegen script includes a Node one-liner after the orval call to overwrite `lib/api-zod/src/index.ts` with only `export * from "./generated/api";`.

```json
"codegen": "orval --config ./orval.config.ts && node -e \"const fs=require('fs');fs.writeFileSync('../../lib/api-zod/src/index.ts','export * from \\\"./generated/api\\\";\\n')\" && pnpm -w run typecheck:libs"
```

Also: the `schemas` option was removed from the orval zod output config in `lib/api-spec/orval.config.ts` to avoid generating the types subfolder at all.

**Why:** Orval's split mode generates both Zod validators and TypeScript type aliases with the same names. The barrel re-exports both, creating TS namespace ambiguity.

**How to apply:** Any time the OpenAPI spec is changed and codegen is re-run, this patch runs automatically. Do not manually restore the two-line barrel.
