# Release Review v0.4.4

## Release

- Version: 0.4.4
- Release branch: `release/v0.4.4`
- Target tag: `v0.4.4`
- Reviewer: Codex
- Date: 2026-07-31

## Scope

- Key changes included in this release:
  - Opens the existing model chat in production builds instead of gating it behind `import.meta.env.DEV`.
  - Treats `chat` as a normal settings destination for URL and application-event navigation.
  - Adds a Chat item to the desktop tray on all supported desktop platforms.
  - Preserves the existing local IndexedDB namespace so development chat history survives the product upgrade.
  - Rebuilds the tracked macOS `talkis-llm` sidecar for the synchronized `0.4.4` workspace version, matching the established release process.
- User-facing changes:
  - Chat is available from the settings sidebar and system tray on macOS, Windows, and Linux.
  - Users can search and cite Talkis records, summarize transcripts and calls, find tasks, translate text, and use the configured Cloud, API, or local text model.
- Risky areas:
  - Production navigation and deep-link handling for the newly visible tab.
  - Text-model availability and existing local-history search behavior in a wider product audience.
  - Cross-platform tray routing to the settings window.

## Checks run

- Focused Chat tests for product navigation, scope enforcement, and local-history search: passed, `29/29`.
- `bunx tsc --noEmit`: passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `CARGO_INCREMENTAL=0 cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- `CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --lib tray::tests::maps_supported_tray_menu_actions`: passed, `1/1`.
- `bash scripts/check-version-sync.sh`: passed at `0.4.4`.
- `CARGO_INCREMENTAL=0 bun run check:release`: passed, including version sync, TypeScript/Rust checks, sidecar preparation, hotkey smoke `6/6`, and production frontend build.
- `CARGO_INCREMENTAL=0 bun run build:release:macos`: passed; produced the signed application bundle, DMG, updater archive, and updater signature.
- Built `Talkis.app` version: verified as `0.4.4` from `CFBundleShortVersionString`.
- `codesign --verify --deep --strict`: passed for the built and installed application bundles, including all four sidecars.
- `hdiutil verify`: passed for `Talkis_0.4.4_aarch64.dmg`.
- Release artifact SHA-256:
  - `Talkis_0.4.4_aarch64.dmg`: `4f469f911859a850b62dc7f13f026764177894ab014ad4724b794b5478c10d7a`
  - `Talkis.app.tar.gz`: `5ac3f74718e55f67258dfcc4c5af7ad255a2af54a8c1772b4060635640523a3c`
  - `Talkis.app.tar.gz.sig`: `16e6fd78272c20e8d382a0a6e201362ec48288323cd3113b4281efb403133bdf`
- GitHub Release Preflight: pending.
- Native/GitHub Windows build: pending Release Preflight.
- Native/GitHub Linux build: pending Release Preflight.
- Additional manual checks:
  - Installed `/Applications/Talkis.app` reports version `0.4.4`, passes strict code-signature verification, and launches successfully.
  - The previous installed `0.4.3` bundle was moved to the macOS Trash as `Talkis-0.4.3-before-v0.4.4.app` before replacement.
  - Static inspection of the compiled production asset confirms `chat` is in the normal settings tab set and `DevChatTab` is rendered without a development-mode gate.
  - A direct visual click-through to Chat was not performed because the freshly signed local bundle opened the macOS permissions onboarding; system privacy settings were intentionally not changed during release verification.

## Manual review

- Hotkey flow: unchanged; mandatory release smoke test passed, `6/6`.
- Onboarding permissions: unchanged.
- Widget position and notice behavior: unchanged.
- Transcription quality and short-utterance handling: unchanged.
- README refreshed: yes, `README.md` and `README.ru.md` document the product Chat.

## Findings

- Blockers:
  - Exact-commit three-platform preflight is still pending.
- Non-blocking issues:
  - Bun 1.2.13 initially returned the known intermittent false `Cannot find module` error on the external-volume workspace; the immediate focused retry passed `2/2`.
  - The first Rust test/check attempts stalled in the external-volume incremental directory after an interrupted compile. Repeating them with `CARGO_INCREMENTAL=0` passed; CI uses a fresh runner.
- Follow-ups after release:
  - None identified yet.

## Decision

- Ready for `main` merge: no; exact-commit three-platform preflight is pending.
- Release preflight green on exact tag commit: no; pending.
- Ready for tag publish: no; pending.
