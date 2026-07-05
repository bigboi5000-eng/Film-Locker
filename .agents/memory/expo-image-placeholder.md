---
name: expo-image placeholder prop types
description: The placeholder prop on expo-image's Image component does not accept a { color } object — valid values are require() references or URI strings.
---

## The rule
`expo-image` Image component's `placeholder` prop accepts:
- `require('@/assets/images/some-image.png')` (static asset)
- A URI string  
- A blurhash string

It does NOT accept `{ color: '#hexvalue' }` — this causes TS2353 "Object literal may only specify known properties".

**Why:** The expo-image type for placeholder is `string[] | ImageSource | ImageSource[] | SharedRef`, not a color object.

**How to apply:** Use `placeholder={require('@/assets/images/icon.png')}` as a simple loading placeholder, or omit placeholder entirely.
