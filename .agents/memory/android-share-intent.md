---
name: Android share intent setup
description: How share-from-Instagram is wired into Film Locker — package, platform stubs, intent filter.
---

## Package
`react-native-receive-sharing-intent` (v2) — available through Replit's package firewall.
`react-native-share-menu` is NOT usable — its post-install script creates a temp directory that Metro then tries to watch and crashes with ENOENT.
`expo-receive-sharing-intent` is NOT available through Replit's package firewall.

## Platform stub pattern
Metro platform-specific file resolution: `ShareIntentHandler.tsx` (native) + `ShareIntentHandler.web.tsx` (returns null). Metro picks `.web.tsx` for web builds automatically — no metro.config.js changes needed.

## Android intent filter
Added to `app.json` under `android.intentFilters`:
```json
{ "action": "android.intent.action.SEND", "data": [{"mimeType": "text/plain"}], "category": ["android.intent.category.DEFAULT"] }
```

## New Architecture risk
`react-native-receive-sharing-intent` uses the legacy NativeModules bridge. With `newArchEnabled: true` (Expo 54 / RN 0.81) the interop layer should forward calls, but this is untested on-device. If the share intent doesn't fire on first real APK test, try setting `newArchEnabled: false` in `app.json` as the first debug step.

## Key implementation notes
- Component must early-return (`if Platform.OS !== 'android') return null`) — web stub handles web but iOS also hits the native file.
- `useEffect` must return cleanup: `ReceiveSharingIntent.clearReceivedFiles()` + `mountedRef.current = false` to prevent post-unmount setState.
- Reset `handledRef.current = null` in the catch block so a failed share can be retried.
- Shared URL from Instagram arrives as `files[0].weblink`; plain text shares use `files[0].text`.
