---
name: Orval query hook patterns
description: Gotchas when using orval-generated hooks in this workspace
---

## Always pass queryKey in query options

The orval config makes `queryKey` required in `UseQueryOptions`. When passing custom options to a query hook, always include the corresponding query key helper:

```tsx
// WRONG
useGetNotificationThread(userId!, { query: { enabled: !!userId } });

// CORRECT
useGetNotificationThread(userId!, {
  query: { queryKey: getGetNotificationThreadQueryKey(userId!), enabled: !!userId },
});
```

**Why:** The orval config sets `queryKey` as a required field in the generated `UseQueryOptions` type — leaving it out is a TypeScript error.

**How to apply:** Every time you pass a `query:` option to a generated hook, include `queryKey: get<OperationId>QueryKey(...)`.

## Search/query params are flat objects

For hooks that take query parameters (e.g. `useSearchUsers`), params are a flat object matching the OpenAPI path's query schema, NOT wrapped in `{ params: ... }`:

```tsx
// WRONG
useSearchUsers({ params: { q: debouncedQ } }, options);

// CORRECT
useSearchUsers({ q: debouncedQ }, options);
```

**Why:** Orval generates the param type directly from the OpenAPI schema — there's no nesting layer.

## Zod is not a built-in dep of api-server

`@workspace/api-server` only depends on `@workspace/api-zod` (the generated validators). If you write new route validation code using `zod` directly, add it:
```
pnpm --filter @workspace/api-server add zod
```
Also use `import { z } from 'zod'` (v3 is installed), NOT `zod/v4`.

## Platform must be explicitly imported in _layout.tsx

`Platform` from `react-native` is not auto-available in the Expo web bundler context. Add it:
```tsx
import { Platform } from 'react-native';
```
Guard all `expo-notifications` API calls with `if (Platform.OS === 'web') return;` since the notification APIs are native-only and throw on web.
