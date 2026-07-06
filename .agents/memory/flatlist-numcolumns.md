---
name: FlatList numColumns switching
description: Crash caused by switching numColumns on a FlatList between renders — fix and pattern.
---

## Rule
Any time two FlatLists with different `numColumns` values appear in the same conditional slot in the tree, each must have a distinct stable `key` prop.

**Why:** React reconciles by position. Without distinct keys, React reuses the same FlatList instance and tries to update `numColumns` in place, which throws an `Invariant Violation` at `componentDidUpdate`.

**How to apply:** Whenever `isSearchActive` (or any boolean) swaps between a grid list (`numColumns={2}`) and a single-column list (`numColumns={1}`), add `key="watchlist-grid"` and `key="search-results"` (or equivalent) to force unmount/remount.
