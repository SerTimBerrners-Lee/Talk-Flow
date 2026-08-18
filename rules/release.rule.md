# Release Rule

This file defines the mandatory release workflow for Talkis. Follow it for every release without skipping steps.

## Naming

- Release branch: `release/vX.Y.Z`
- Release review file: `docs/release/review-vX.Y.Z.md`
- Git tag: `vX.Y.Z`
- Release preflight workflow: `.github/workflows/release-preflight.yml`

## Mandatory sequence

1. Collect all local changes and push them to the release branch first.
2. Update version numbers consistently in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
3. Refresh `README.md` before every release so the documented behavior, supported platforms, commands, and release notes are current.
4. Run the release checks locally:
   - `bun run check:release`
   - `TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/talkis-updater.key bun run build:release:macos`
   - On native Windows/Linux runners, run `bun run build:release:windows` and `bun run build:release:linux` before claiming those artifacts are ready.
   - If the updater private key is password-protected, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
5. Perform a detailed self-review of the full release diff.
6. Write the review results to `docs/release/review-vX.Y.Z.md` using the review template.
7. Run GitHub Actions release preflight on the release branch before merging or tagging:
   - Push `release/vX.Y.Z` and wait for `.github/workflows/release-preflight.yml`.
   - Required green checks on the exact release commit: `Preflight macos`, `Preflight windows`, and `Preflight linux`.
   - If preflight fails, fix the same release branch and rerun preflight. Do not create a tag just to test CI.
8. If there are blockers, risks, or recommendations that need a decision, ask the user before merging to `main`.
9. Only after review is complete, questions are resolved, and all preflight checks are green, merge or push the approved changes to `main`.
10. Create and push the release tag `vX.Y.Z` from `main`.
11. Let GitHub Actions build and publish the release for all currently supported release platforms.

## Hard release gate

- Do not create or push `vX.Y.Z` until release preflight has succeeded for macOS, Windows, and Linux on the exact commit that will be tagged.
- The release workflow verifies those preflight check-runs before building. A tag without green preflight must fail before publishing artifacts.
- Failed release preflight runs are fixed on the release branch. Failed tag-triggered release runs are exceptional and should not be used as the normal validation loop.

## Review checklist

- Working tree is clean and the release branch diff is intentional.
- README reflects the current product behavior and release process.
- Hotkey flow works, including capture, apply-without-restart, and onboarding interactions.
- Widget position, notices, and onboarding permissions behave correctly.
- Short or noisy recordings do not paste obvious hallucinated text.
- `bun run check:release` passes.
- Local production build passes via `bun run build:release:macos`; Windows/Linux production builds pass on their native runners or in GitHub Actions.
- Release preflight is green for `Preflight macos`, `Preflight windows`, and `Preflight linux` on the exact release commit.
- Version numbers and release tag match.
- The GitHub Actions release workflow still matches the documented process.
- GitHub repository secrets include `TAURI_SIGNING_PRIVATE_KEY` and, if the key is password-protected, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- GitHub repository secrets include the macOS Developer ID values `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, and `APPLE_SIGNING_IDENTITY`; macOS release and preflight builds must fail rather than publish an ad-hoc-signed update.
- The macOS app passes `codesign --verify --deep --strict` and reports both `Authority=Developer ID Application:` and a real `TeamIdentifier`, so Accessibility permission remains tied to the same application identity across updates.
- GitHub Release includes `latest.json`, macOS `.app.tar.gz`, Windows `.exe`, Linux `.AppImage`, and matching `.sig` files.

## GitHub Actions release source of truth

- Workflow file: `.github/workflows/release.yml`
- Preflight workflow file: `.github/workflows/release-preflight.yml`
- Tag push is the canonical release trigger.
- Release preflight is the canonical build validation before tag push.
- The updater metadata endpoint is `https://github.com/SerTimBerrners-Lee/talkis/releases/latest/download/latest.json`.
- Build all platforms that are actually ready in the workflow. Do not claim unsupported platforms in release notes.

## Output expectations

For each release, produce:

- release branch `release/vX.Y.Z`
- review file `docs/release/review-vX.Y.Z.md`
- updated `README.md`
- updated version files
- green release preflight on the release commit
- pushed `main`
- pushed tag `vX.Y.Z`
- GitHub Release artifacts created by Actions
