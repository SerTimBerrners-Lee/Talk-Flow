# Release Review v0.4.2

## Release

- Version: 0.4.2
- Release branch: `release/v0.4.2`
- Target tag: `v0.4.2`
- Reviewer: Codex
- Date: 2026-07-21

## Scope

- Key changes included in this release:
  - Adds a guided first-run flow for permissions, local STT model installation, hotkey setup, and a real dictation test.
  - Reuses shared hotkey controls, live key previews, and local STT model cards between onboarding and Settings.
  - Adds managed OPUS-MT English-to-Russian translation and target-aware fallback between the two OPUS directions and NLLB.
  - Removes leading Qwen `<think>` blocks from selected-text translation output.
  - Separates ordinary dictation microphone fallback from call-capture routing so a missing explicitly selected call microphone cannot silently duplicate system audio.
  - Prevents batch-only local STT models from inheriting a verified API adapter's streaming capability.
  - Fixes onboarding completion when an empty recording removes its placeholder history entry, and evaluates the raw STT result before cleaned or translated text.
  - Rebuilds the bundled macOS `talkis-llm` sidecar for the 0.4.2 workspace version.
- User-facing changes:
  - New users can complete local setup without navigating through the full Settings window.
  - The onboarding test shows the configured hotkey, tracks the active recording, and reports no-speech results instead of remaining in a processing state.
  - Local model cards and hotkey controls are visually and behaviorally consistent between onboarding and Settings.
  - Users can deselect an active local text model without deleting its downloaded file.
  - Selected English text can use the managed OPUS-MT English-to-Russian model, including fallback from the opposite OPUS pair.
  - Call capture fails explicitly when a selected microphone disappears instead of silently substituting a potentially duplicated default input.
- Risky areas:
  - First-run state transitions across permissions, model download, runtime warm-up, settings persistence, hotkey registration, and history events.
  - Microphone selection behavior differs intentionally between ordinary voice fallback and dual-track call capture.
  - Local translator catalog consistency between React settings and the Rust CTranslate2 runtime.
  - Cross-platform bundles and updater signing must pass GitHub Release Preflight on the exact release commit.

## Checks run

- `git diff v0.4.1 --check`: passed.
- Secret-pattern scan of changed TypeScript, Rust, JSON, and Markdown: passed; no credential-like values found.
- `bun run check:versions`: passed at `0.4.2` for `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- `bunx tsc --noEmit`: passed.
- Focused frontend tests for onboarding, hotkey preview, local LLM selection, microphone routing, streaming eligibility, and selected-text translation: passed, `49/49`.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- Focused Rust local-translator tests: passed, `5/5`; one installed-model integration test is ignored unless `TALKIS_NLLB_TEST_MODEL` is provided.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: passed, `108/108`; the same installed-model NLLB test is ignored by default.
- `bun run check:release`: passed.
  - Version synchronization, sidecar preparation, TypeScript, `cargo check`, six hotkey smoke tests, and the Vite production build passed.
  - Vite repeated the existing mixed `SummaryModal.tsx` import and 893.69 kB main-chunk warnings tracked in `talkis-pc-884`.
- Full `bun test` auto-discovery: unavailable in this removable-volume workspace because Bun exits before test execution with `ProcessFdQuotaExceeded`; the changed surfaces pass through the explicit 49-test invocation and the mandatory release smoke suite passes `6/6`.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' bun run build:release:macos`: passed outside the filesystem sandbox.
  - Built release sidecars, frontend, Rust binary, `Talkis.app`, signed updater `.app.tar.gz`, `.sig`, and `Talkis_0.4.2_aarch64.dmg`.
  - Strict recursive `codesign` verification passed with `Identifier=com.trixter.talkis`.
  - `hdiutil verify` reports the final DMG checksum as valid.
  - SHA-256: DMG `f355b730161c5f7d36752f673d39e0d5c0964d1466ab57a00eadb86cc5d1cf07`; updater archive `b3cca3a7f42e571fba37b2eb234a988714b87391154447132cc37215d6c15bbf`; signature file `6d95237eba6599922ae09b1de1191bb222d529d24ac19b843a850afd07068808`.
- GitHub Release Preflight: pending for the exact final release commit.
- Native/GitHub Windows build: pending Release Preflight.
- Native/GitHub Linux build: pending Release Preflight.
- Additional manual checks:
  - Reviewed the complete `v0.4.1..release/v0.4.2` diff and the onboarding terminal-event fix recorded as `talkis-pc-d62`.
  - No OS-level microphone, permission-dialog, or global-hotkey session was run during this release pass; automated state, routing, and hotkey checks are green.

## Manual review

- Hotkey flow: shared capture and preview code, apply-without-restart event flow, and conflict-aware settings integration were reviewed; 49 focused tests and six mandatory smoke tests pass.
- Onboarding permissions: permission UI is reused as the first step, preserves the existing completion callback, supports scrolling, and advances into model setup; no native permission dialog was manually exercised.
- Widget position and notice behavior: positioning constants are unchanged; terminal onboarding events are scoped to the active history entry and empty STT now produces no-speech feedback.
- Transcription quality and short-utterance handling: existing hallucination filters are unchanged; raw STT is preferred for onboarding phrase validation, batch-only local models no longer enter API streaming, and empty results terminate cleanly.
- README refreshed: yes, `README.md` and `README.ru.md` document v0.4.2 behavior and limitations.

## Findings

- Blockers:
  - Do not merge or tag until `Preflight macos`, `Preflight windows`, and `Preflight linux` are green on the exact final release commit.
- Non-blocking issues:
  - `talkis-pc-884`: Vite reports a mixed static/dynamic `SummaryModal.tsx` import and an 893.69 kB main JavaScript chunk.
  - Bun 1.2.13 full-suite auto-discovery intermittently exhausts file descriptors on this removable-volume workspace; explicit focused invocations and the release smoke suite pass.
  - The first sandboxed macOS postprocess attempt could not access `hdiutil`; the same full signed release command passed outside the sandbox.
- Follow-ups after release:
  - Resolve `talkis-pc-884` without coupling bundle optimization to this functional release.

## Decision

- Ready for `main` merge: no, pending exact-commit Release Preflight.
- Release preflight green on exact tag commit: pending.
- Ready for tag publish: no, pending exact-commit Release Preflight.
