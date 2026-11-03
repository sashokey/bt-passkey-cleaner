Violentmonkey userscript that removes `uk` and `passkey` from tracker URLs while preserving the info hash.

1. Install [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Install the [userscript](https://raw.githubusercontent.com/sashokey/bt-passkey-cleaner/master/bt-passkey-cleaner.user.js).
3. Sign in to the supported site, reload a release page, and use its download button. The browser saves `bt-id<id>-clean.torrent`.

The script runs in Violentmonkey's `content` context on supported release pages and handles a single download link to the main site or its declared download host. Same-origin downloads include the current login session. Allow access to the download host if Violentmonkey prompts for a cross-origin request. Saving uses the browser's regular download mechanism.

Only `uk` and `passkey` query parameters in `announce` and `announce-list` are removed. The original `info` bytes, arbitrary binary dictionary keys, and other metadata stay unchanged. Invalid files, malformed links, and failed requests are not saved. Requests time out after 30 seconds. Removing or replacing the active download target, changing its URL, or leaving the route cancels the operation; queued responses cannot save an obsolete file. Native Navigation API events cover history changes where supported, with `popstate`, `hashchange`, and `pagehide` fallbacks and a final URL and target check before saving. Repeated initialization and concurrent clicks do not add duplicate downloads.

`bt-passkey-cleaner.src.ts` is the authoritative source. `bt-passkey-cleaner.user.js` is its generated installable distribution. All authored executable code, including tests and build tools, is TypeScript checked with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and type-aware lint rules.

## Checks

Use Node.js 24 or later:

```bash
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run check
```

`npm run build` type-checks, compiles with esbuild, and minifies with Terser. `npm run check:build` checks JavaScript syntax, metadata preservation, and exact reproducibility of the shipped file. `npm test` runs the complete browser test suite against both the unminified compiled `.build/bt-passkey-cleaner.js` and shipped distribution. It uses synthetic torrent responses, a DOM fixture based on the authenticated target page, real browser downloads, and a typed boundary double for cross-origin GM requests. Coverage includes byte/hash preservation, binary keys, failures, timeout, cancellation, late responses, route changes, target replacement, and repeated initialization. GitHub Actions runs these commands on pushes and pull requests.

All authored TypeScript, including tests and helpers, uses `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and type-aware unsafe-operation lint rules. `allowJs` is disabled. `skipLibCheck` applies only to overlapping third-party browser declarations; authored files remain checked. Dependencies and tool versions are pinned in `package-lock.json`.
