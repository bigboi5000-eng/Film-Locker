---
name: EAS build pitfalls for pnpm monorepo
description: Two bugs that break EAS Android builds — intent filter namespacing and prebuild package.json mutation.
---

## Rule 1: Expo intent filter short-form names

In `app.json` `android.intentFilters`, use SHORT names without the Android namespace prefix. Expo's config plugin prepends the prefix automatically during prebuild.

**Wrong:**
```json
{ "action": "android.intent.action.SEND", "category": ["android.intent.category.DEFAULT"] }
```

**Correct:**
```json
{ "action": "SEND", "category": ["DEFAULT"] }
```

**Why:** `@expo/config-plugins` prepends `android.intent.action.` and `android.intent.category.` when writing the AndroidManifest.xml. Using full names results in double-prefixed values like `android.intent.action.android.intent.action.SEND`, which never match any share intent.

**How to apply:** Always verify with `npx expo prebuild --platform android --no-install` and check the generated `AndroidManifest.xml` for the `data-generated="true"` intent filter block before submitting an EAS build.

---

## Rule 2: expo prebuild mutates package.json — clean up after

`npx expo prebuild` adds `expo`, `react`, and `react-native` to the `dependencies` section of the film-locker `package.json`, even when they already exist in `devDependencies` with different version ranges. This creates a version conflict that fails the EAS "Install dependencies" phase with `UNKNOWN_ERROR`.

**Fix:** After running prebuild locally for inspection, check `package.json` and remove any duplicate peer deps (expo, react, react-native) that prebuild added to `dependencies`. Only `react-native-receive-sharing-intent` (and other non-Expo native libs) should be in `dependencies`.

**Why:** pnpm workspace dependency resolution throws when the same package appears in both `dependencies` and `devDependencies` with incompatible version ranges.

**How to apply:** After any local prebuild run, always delete the generated `android/` and `ios/` directories AND inspect `package.json` for mutations before committing.
