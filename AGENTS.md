# Repository Guidelines

## Project Structure & Module Organization
This MV3 extension ships as plain ES modules with no bundler. `manifest.json` loads `manager.js` as the background service worker and `options.html`/`options.js` as the configuration UI. Assets stay in `css/`, `js/`, `fonts/`, and `icons/`, while `_locales/en/messages.json` owns translatable strings and `migration.js` plus `offscreen.html` handle the legacy storage migration.

## Build, Test, and Development Commands
- `google-chrome --load-extension="$(pwd)"`: Load the unpacked extension for local debugging (or use the equivalent flow in `chrome://extensions`).
- `zip -r dist/download-organizer.zip . -x 'dist/*' 'AGENTS.md'`: Produce the upload bundle; run `mkdir -p dist` once.
- `npm exec web-ext lint --source-dir .`: Optional manifest validation if `web-ext` is available.

## Coding Style & Naming Conventions
Use 4-space indentation, prefer `const`/`let`, and keep single-quoted strings for consistency with `manager.js` and `options.js`. New modules should stay ESM and live at the project root or alongside their HTML counterpart; avoid mixing CommonJS helpers. When touching DOM code, follow the existing jQuery pattern and mirror element IDs already defined in `options.html`, and route user-visible text through `_locales`.

## Testing Guidelines
Automated tests are not present, so plan for manual QA. Load the unpacked extension, watch the service worker console, and download representative files to confirm rule matches, conflict actions, and `${date:...}` substitutions. Use the Blocklist tab in `options.html` to ensure skipped URLs bypass filename suggestions, and flip the toolbar toggle (pinned action icon) to verify downloads pass through untouched while disabled. Clear `chrome.storage.local` (and `chrome.storage.sync` if used) when verifying the first-run migration flow.

## Commit & Pull Request Guidelines
Keep commit subjects short, imperative, and scoped (`Add conflict action docs`, `Remove unused migration`); avoid trailing punctuation and bundle unrelated work in the same commit. Pull requests should outline the behaviour change, list the manual checks you ran, and attach screenshots or log excerpts whenever the UI or rule logging changes. Flag any adjustments to permissions, storage keys, or default rules so reviewers can focus on release notes.

## Security & Configuration Tips
The extension only needs the declared `downloads`, `storage`, and `offscreen` permissions—do not add new scopes without a release note and reviewer sign-off. Store only rule configuration in extension storage; never embed credentials or personally identifiable data. Update `_locales` in lockstep with new strings to keep the Chrome Web Store listing consistent.
