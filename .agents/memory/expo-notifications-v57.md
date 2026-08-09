---
name: expo-notifications v57 API shape
description: Correct API for expo-notifications@57 (paired with Expo 54) — NotificationBehavior and permission status fields changed from older docs.
---

# expo-notifications v57 API changes

**Why:** The installed version (57.x with Expo 54) has breaking changes from older examples.

## NotificationBehavior (setNotificationHandler)
Must include `shouldShowBanner` and `shouldShowList` (not the deprecated `shouldShowAlert`):
```ts
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
```

## Permission status
`NotificationPermissionsStatus` extends `PermissionResponse` from `expo`, but TypeScript can't resolve that cross-package inheritance in the mobile tsconfig. Use `as any` cast:
```ts
const existing = await Notifications.getPermissionsAsync() as any;
const granted: boolean = existing.granted ?? existing.status === 'granted';
```

## How to apply
Any future code using expo-notifications permission checks or notification handlers must use this shape, not old `shouldShowAlert` / `.status` patterns.
