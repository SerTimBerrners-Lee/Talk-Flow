# Release Review v0.3.13

## Release

- Version: 0.3.13
- Release branch: release/v0.3.13
- Target tag: v0.3.13
- Reviewer: Codex
- Date: 2026-07-15

## Scope

- Key changes included in this release:
  - Adds live system-audio translation through Talkis Cloud or verified OpenAI/Gemini Realtime API adapters, with optional translated voice playback on macOS.
  - Adds realtime dictation for supported local and API STT models with live partial text and a final batch fallback.
  - Reworks dictation and selected-text hotkeys into one transactional capture and runtime registration path with conflict checks, rollback, and stale-request protection.
  - Adds macOS, Windows, and Linux system-audio capture for call transcription and stores live-translation sessions and audio tracks in local history.
  - Improves the floating widget, text overlay, permission recovery, history action menus, settings persistence, and macOS development app runner.
  - Adds the authenticated Talkis Cloud Realtime client-secret endpoint in `talkis-proxy` v0.1.9 without exposing the provider API key to the desktop app.
- User-facing changes:
  - Live translation starts from the widget and displays compact translated speaker turns while audio is still playing.
  - Selected text can be translated with a separate configurable global shortcut.
  - Streaming text replaces stale overlay content immediately; completed overlays can be dragged and close automatically after ten seconds.
  - Live-translation history keeps its saved audio track available after the full entry loads.
- Risky areas:
  - Native system-audio capture differs across Core Audio, WASAPI loopback, and PipeWire.
  - Realtime provider protocols, reconnect/commit timing, optional voice playback, and feedback prevention.
  - Runtime replacement of two global hotkeys and settings rollback.
  - macOS TCC permission persistence and signed development app relaunch.
  - Cross-platform release bundles must pass GitHub Release Preflight on the exact release commit.

## Checks run

- `git diff --check`: passed.
- Secret-pattern scan of changed source and scripts: passed; no credentials found.
- `node --check scripts/run-tauri.mjs` and `zsh -n scripts/run-macos-dev-app.sh`: passed.
- `bun test`: passed, 193 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: passed, 89 tests.
- `bun run check:release`: passed.
  - Version sync passed for `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` at 0.3.13.
  - Sidecar preparation, `bunx tsc --noEmit`, `cargo check`, hotkey smoke tests, and Vite production build passed.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key bun run build:release:macos`: passed.
  - Built release sidecars, frontend, Rust binary, `Talkis.app`, updater `.app.tar.gz`, updater `.sig`, and `Talkis_0.3.13_aarch64.dmg`.
- Talkis Cloud proxy: `go test ./...` passed; endpoint commit `1f366a7` and deploy hardening through `db49bc2` were pushed to `main` and published as `v0.1.9`.
  - Deploy run `29451482082` passed SSH setup, exact-directory Docker build, container restart, active Nginx config update, and internal/public route probes.
  - Public verification passed: `/health` returns `200`, while unauthenticated `POST /api/realtime/client-secret` returns the expected `401` instead of exposing a credential.
- GitHub Release Preflight: pending for `Preflight macos`, `Preflight windows`, and `Preflight linux` on the final release commit.
- Native/GitHub Windows build: pending Release Preflight.
- Native/GitHub Linux build: pending Release Preflight.
- Additional manual checks:
  - The user confirmed live translation streaming behavior during development.
  - A final short smoke test is required for the latest hotkey transaction, Cloud deployment, history audio retention, and restart/permission fixes before `main` merge and tag publish.

## Manual review

- Hotkey flow: capture state machine, physical-key normalization, conflict, registration, persistence, rollback, stale request, and restart behavior are covered by frontend and Rust tests; final OS-level smoke test pending.
- Onboarding permissions: native microphone/accessibility checks and signed dev-app relaunch path reviewed; final restart smoke test pending.
- Widget position and notice behavior: edge padding, wider streaming layout, immediate replacement, dragging, terminal auto-dismiss, dark theme, and bottom-edge menu positioning reviewed and covered by focused tests where practical.
- Transcription quality and short-utterance handling: existing filters remain in place; realtime commit, reconnect, replay, partial/final merge, and batch fallback tests pass.
- README refreshed: yes, `README.md` and `README.ru.md` document v0.3.13 behavior and supported platforms.

## Findings

- Blockers:
  - Do not merge or tag until the final manual smoke test is confirmed.
  - Do not merge or tag until Release Preflight is green for macOS, Windows, and Linux on the exact release commit.
- Non-blocking issues:
  - Local Node.js is 22.6.0 while Vite recommends 20.19+ or 22.12+; both production frontend builds still completed successfully.
  - Vite reports the existing large main chunk and mixed static/dynamic `SummaryModal.tsx` import warnings.
  - The local Beads Dolt database is unavailable because its journal is corrupted, so release tracking could not be updated through `bd`.
- Follow-ups after release:
  - Consider migrating OpenAI live translation to the dedicated Realtime translation endpoint after the current generic Realtime flow has shipped and can be regression-tested separately.
  - Optimize frontend chunk splitting without coupling it to this functional release.

## Decision

- Ready for `main` merge: yes after the manual smoke test and final Release Preflight pass.
- Release preflight green on exact tag commit: pending.
- Ready for tag publish: yes after the same two gates pass.
