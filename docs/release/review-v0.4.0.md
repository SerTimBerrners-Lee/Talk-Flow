# Release Review v0.4.0

## Release

- Version: 0.4.0
- Release branch: `release/v0.4.0`
- Target tag: `v0.4.0`
- Reviewer: Codex
- Date: 2026-07-17

## Scope

- Key changes included in this release:
  - Adds live system-audio translation through Talkis Cloud and verified OpenAI/Gemini Realtime adapters, with optional translated voice playback on macOS.
  - Adds streaming dictation for supported Cloud, API, and local STT configurations.
  - Replaces duplicated hotkey capture with one transactional capture, registration, persistence, rollback, and stale-request flow for dictation and selected-text translation.
  - Adds two-track call/live-translation audio handling so microphone and system audio can be saved and synchronously played from history.
  - Improves file diarization presentation: the first detected speaker is shown as `Вы`, other speakers as `Гость N`, and speaker names use stable draft editing.
  - Expands the experimental history chat with general offline semantic intent templates, lexical ranking, optional embeddings, and explicit all-record retrieval.
  - Improves widget/text overlay sizing, dark theme, drag behavior, immediate request replacement, terminal auto-dismiss, history action positioning, permission recovery, and persisted settings.
  - Adds technical architecture documentation for Cloud/API/Local modes and a consolidated business-requirements document.
- User-facing changes:
  - Synchronous translation appears while media is playing and keeps consecutive parts of one channel in a compact speaker turn.
  - Selected-text translation immediately replaces an older request instead of waiting for its overlay to close.
  - Saved call/live-translation audio contains both the user microphone and the remote/system side.
  - File speaker names can be edited without caret jumps, and the initial first-speaker label is `Вы`.
  - The Models and Translation UI clearly separates live translation, which is available only through Cloud/API, from functionality that remains available locally.
- Risky areas:
  - Native Core Audio, WASAPI loopback, and PipeWire capture behavior.
  - Realtime provider protocol parsing, commit/reconnect timing, audio replay, voice playback, and feedback prevention.
  - Concurrent microphone recording without mic translation when session audio saving is enabled.
  - Runtime replacement of two global hotkeys and rollback after partial failures.
  - Settings migrations and local/cloud/API routing after application restart.
  - Cross-platform bundle generation and updater signing.

## Checks run

- `git diff --check main`: passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- Secret-pattern scan of changed source, documentation, scripts, and workflows: passed; no credential-like values found.
- `bash scripts/check-version-sync.sh`: passed at `0.4.0`.
- `bun run check:release`: passed.
  - Sidecar preparation passed.
  - `bunx tsc --noEmit` passed.
  - `cargo check` passed.
  - Hotkey smoke tests passed, `6/6`.
  - Vite production build passed.
- Frontend tests: all 23 test files passed individually, `203/203` tests.
  - A plain repository-wide `bun test` invocation hit Bun 1.2.13 path/FD discovery errors on the external volume. Running each existing entrypoint with an explicit `./` path passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: passed, `92/92` tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --bin talkis-stt`: passed, `14/14` tests.
  - Realtime localhost WebSocket tests require execution outside the restricted network sandbox; they passed there.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key bun run build:release:macos`:
  - Release sidecars, frontend, Rust binary, `Talkis.app`, and updater `.app.tar.gz` were built successfully.
  - Updater signature and final DMG were not produced locally because `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is unset and the key requires an interactive password.
- GitHub Release Preflight: pending for `Preflight macos`, `Preflight windows`, and `Preflight linux` on the final release commit.
- Native/GitHub Windows build: pending Release Preflight.
- Native/GitHub Linux build: pending Release Preflight.
- Additional manual checks:
  - The user reported on 2026-07-17 that the remaining application behavior is working and approved starting the `0.4.0` release.
  - Earlier development testing covered live translation, selected-text translation, streaming transcription, permissions after restart, file transcription, call audio, history UI, and widget/overlay behavior.

## Manual review

- Hotkey flow: capture completion, physical-key normalization, autorepeat, cancellation, conflicts, registration, persistence, rollback, stale request IDs, and restart behavior are covered by frontend and Rust tests. The user confirmed working application behavior before release preparation.
- Onboarding permissions: native microphone/accessibility checks, restart recovery, and the stable signed macOS development bundle path were reviewed and previously exercised during development.
- Widget position and notice behavior: edge padding, wider streaming layout, dark overlay, dragging, terminal auto-dismiss, immediate replacement, and bottom-edge menu positioning were reviewed and have focused tests where practical.
- Transcription quality and short-utterance handling: existing hallucination filters remain in place; realtime commit, overlap removal, reconnect, replay, partial/final merge, and batch fallback tests pass.
- Call/live-translation audio: microphone capture is started whenever audio saving requires it, but mic PCM is sent to translation only when the user enables microphone translation. Both saved tracks are loaded and played together in history.
- File speaker identity: the first observed speaker ID is mapped to `Вы` as a presentation rule, not biometric voice identification; rename commits update all segments for the same speaker ID.
- README refreshed: yes, `README.md` and `README.ru.md` document v0.4.0 behavior, mode availability, current platforms, and architecture/business documentation.

## Findings

- Blockers:
  - Do not merge or tag until Release Preflight is green for macOS, Windows, and Linux on the exact release commit.
  - The missing local updater signature must be cleared by a green signed macOS Preflight build using repository secrets, or by rerunning the local build with `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set.
- Non-blocking issues:
  - Local Node.js is `22.6.0` while Vite recommends `20.19+` or `22.12+`; production builds still completed successfully.
  - Vite reports an approximately 848 kB main chunk and the existing mixed static/dynamic `SummaryModal.tsx` import warning.
  - Bun 1.2.13 repository-wide test discovery is unreliable on this external volume; explicit test entrypoints pass.
  - The empty `rustdoc` stage of an unfiltered `cargo test` run stalled on the external volume; explicit library and STT binary test targets pass cleanly.
  - The local Beads/Dolt command did not return reliably during this work, so release tracking could not be updated through `bd`.
- Follow-ups after release:
  - Upgrade the local development Node version to `22.12+` or newer.
  - Split the main frontend bundle and remove the mixed `SummaryModal` import mode.
  - Decide whether the experimental history chat should become a production feature and define its default context/privacy limits.
  - Evaluate provider-native API diarization and voice playback on Windows/Linux separately from this release.

## Decision

- Ready for `main` merge: no, pending green Release Preflight on the final commit.
- Release preflight green on exact tag commit: pending.
- Ready for tag publish: no, pending the same cross-platform preflight and signed macOS updater artifact.
