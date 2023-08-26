## 🪦 Deprecation Checklist

### 🔥 New deprecations in this PR

- [ ] 📢 Are called out in [`docs/breaking-changes.md`][]
- [ ] ⚠️ Use the deprecation helpers in [`lib/common/deprecate.ts`](https://github.com/electron/electron/blob/main/lib/common/deprecate.ts) to warn about usage (including events)
- [ ] 📝 Are marked as deprecated in the docs, using `_Deprecated_` (including properties and events)
- [ ] 🧪 Relevant tests are updated to expect deprecation messages using the helpers in [`spec/lib/deprecate-helpers.ts`](https://github.com/electron/electron/blob/main/spec/lib/deprecate-helpers.ts)

### 🗑️ Previous deprecations being removed in this PR

- [ ] 🏷️ Pull request is labeled as https://github.com/electron/electron/labels/semver%2Fmajor
- [ ] 📢 Are called out as removed in [`docs/breaking-changes.md`][]
- [ ] 📝 Are fully removed from the docs
- [ ] ⌨️ All relevant code is removed
- [ ] 🧪 [`spec/ts-smoke`](https://github.com/electron/electron/tree/main/spec/ts-smoke) is updated to use `@ts-expect-error` for the removed APIs

---

@electron/wg-releases: Please confirm these deprecation changes conform to our deprecation policies listed in [`docs/breaking-changes.md`][], then check the applicable items in the checklist and remove any non-applicable items.

[`docs/breaking-changes.md`]: https://github.com/electron/electron/blob/main/docs/breaking-changes.md
