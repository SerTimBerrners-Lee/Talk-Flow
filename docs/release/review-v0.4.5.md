# Release Review v0.4.5

## Release

- Version: 0.4.5
- Release branch: `release/v0.4.5`
- Target tag: `v0.4.5`
- Reviewer: Codex
- Date: 2026-08-05

## Scope

- Key changes included in this release:
  - Makes Talkis Cloud dictation batch-only so the widget and pasted result use the same accurate full-audio transcription.
  - Rejects clearly silent recordings before Cloud STT and filters known refusal, caption, and unexpected short-script hallucinations before history or paste.
  - Keeps Talkis Cloud selected after sign-in and when returning to Models by clearing stale local STT endpoint/key state.
  - Rounds Cloud balance, usage, and reservations to whole tokens and keeps progress below 100% while the balance is incomplete.
  - Distinguishes real Cloud diarization timeouts from other speaker-separation and gateway failures, with raw diagnostic logging.
  - Documents the upgraded Cloud speaker-separation route for long recordings and the Cloud batch-only behavior.
- User-facing changes:
  - Cloud dictation shows recording/processing state without a lower-quality realtime transcript, then inserts only the final batch result.
  - Silent or noisy dictation no longer inserts stock refusal text or unrelated short Korean fragments for a selected Russian language.
  - Token amounts are displayed as whole numbers throughout the desktop app.
  - The realtime transcription control is visibly unavailable in Cloud mode but remains available for supported API and Local models.
  - Speaker-separation failures now show an error that matches the actual failure category.
- Risky areas:
  - Routing between Cloud batch dictation and existing own-key/local streaming paths.
  - Silence thresholds and transcript rejection heuristics for short utterances.
  - Settings normalization when switching from a stale local STT configuration to Talkis Cloud.
  - Cloud wallet progress when reservations are present.

## Checks run

- `bun test`: passed, `253/253` tests across 33 files.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `CARGO_INCREMENTAL=0 bun run check:release`: passed, including synchronized version `0.4.5`, TypeScript/Rust checks, sidecar preparation, hotkey smoke `6/6`, and production frontend build.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/talkis-updater.key CARGO_INCREMENTAL=0 bun run build:release:macos`: compiled the optimized application and all release sidecars and produced `Talkis.app` plus the updater archive; final updater signing could not decrypt the local password-protected key because its password is unavailable in this shell.
- Built `Talkis.app` version: verified as `0.4.5` from `CFBundleShortVersionString`.
- `codesign --force --deep --sign - --identifier com.trixter.talkis` followed by `codesign --verify --deep --strict`: passed for the locally built application and all four sidecars.
- GitHub Release Preflight: pending for the exact review commit.
- Native/GitHub Windows build: pending GitHub Release Preflight.
- Native/GitHub Linux build: pending GitHub Release Preflight.
- Additional manual checks:
  - Full diff from `v0.4.4` reviewed file by file; no unintended binary or generated-file changes are included.
  - Version sync passed for `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and the Talkis workspace entries in `Cargo.lock`.
  - Cloud diarization server path was deployed before the desktop release; an authenticated smoke request completed with HTTP 200.
  - The checked local private key's public key does not match the updater public key embedded in `tauri.conf.json`; release/preflight CI must therefore remain the authoritative signing check using repository secrets.

## Manual review

- Hotkey flow: unchanged; mandatory hotkey FSM smoke passed, `6/6`, and the complete frontend suite passed.
- Onboarding permissions: unchanged.
- Widget position and notice behavior: layout unchanged; Cloud live transcript creation is disabled at both session creation and final-result reconciliation boundaries.
- Transcription quality and short-utterance handling: silent-audio short circuit, known hallucination filtering, cleanup fallback, language-aware Hangul handling, and Cloud batch reconciliation are covered by focused tests.
- README refreshed: yes, both `README.md` and `README.ru.md` describe v0.4.5 and Cloud batch-only dictation.

## Findings

- Blockers:
  - Exact-commit GitHub Release Preflight has not run yet.
- Non-blocking issues:
  - The local Talkis updater key cannot be used for the final signature without its password and does not match the public updater key currently embedded in the app. The exact-commit macOS preflight will verify the configured repository signing secrets instead.
  - Vite reports the existing mixed static/dynamic `SummaryModal` import and a main chunk above 500 kB; the production build still passes.
- Follow-ups after release:
  - Rotate the Cloud transcription provider credential tracked in `talkis-pc-z5b` without exposing its replacement in chat or logs.
  - Restore a secure local copy of the active Talkis updater signing key/password if local updater-signature verification is required in future releases.

## Decision

- Ready for `main` merge: no; wait for exact-commit preflight.
- Release preflight green on exact tag commit: no; pending.
- Ready for tag publish: no; pending exact-commit preflight.
