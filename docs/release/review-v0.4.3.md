# Release Review v0.4.3

## Release

- Version: 0.4.3
- Release branch: `release/v0.4.3`
- Target tag: `v0.4.3`
- Reviewer: Codex
- Date: 2026-07-22

## Scope

- Key changes included in this release:
  - Restores the standard compact hotkey field in Settings while preserving onboarding-only keycaps.
- User-facing changes:
  - The main hotkey setting again matches the selected-text translation hotkey control.
- Risky areas:
  - Shared dictation hotkey rendering between Settings and onboarding.

## Checks run

- `git diff v0.4.2 --check`: passed.
- Secret-pattern scan of the release text/config/code diff: passed; no credential-like values found.
- `bun run check:versions`: passed at `0.4.3` for `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- `bun run check:release`: passed.
  - Sidecar preparation, TypeScript, `cargo check`, six hotkey smoke tests, and the Vite production build passed.
  - Vite repeated the existing mixed `SummaryModal.tsx` import and 894.00 kB main-chunk warnings tracked in `talkis-pc-884`.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' bun run build:release:macos`: passed.
  - Built optimized release sidecars, frontend, Rust binary, `Talkis.app`, signed updater `.app.tar.gz`, `.sig`, and `Talkis_0.4.3_aarch64.dmg`.
  - Strict recursive `codesign` verification passed with `Identifier=com.trixter.talkis`.
  - `hdiutil verify` reports the final DMG checksum as valid.
  - SHA-256: DMG `5ecac3ca2103e382dd4f09e62b2f43eec5d111a370826173fb744b4b6d6563eb`; updater archive `70d72135f438e465cdde6341f175a6a85614a6c5abee11ec3b00d76de2e59fc4`; signature file `00795453db718cf8c9cacfed7aed28787990b5a6a75dfa69ef0c72030e8bcfaa`.
- GitHub Release Preflight: pending.
- Native/GitHub Windows build: pending.
- Native/GitHub Linux build: pending.
- Additional manual checks:
  - Reviewed the complete `v0.4.2..release/v0.4.3` source/config/documentation diff and the rebuilt arm64 `talkis-llm` sidecar.
  - Verified the macOS app reports version `0.4.3`, bundle identifier `com.trixter.talkis`, and arm64 Mach-O application/LLM binaries.

## Manual review

- Hotkey flow: reviewed the shared control branch; Settings uses the standard text field and onboarding remains explicitly configured with `appearance="keycaps"`. Capture/apply logic is unchanged and six mandatory smoke tests pass.
- Onboarding permissions: unchanged.
- Widget position and notice behavior: unchanged.
- Transcription quality and short-utterance handling: unchanged.
- README refreshed: yes, `README.md` and `README.ru.md`.

## Findings

- Blockers:
  - Local release checks, signed macOS build, and exact-commit GitHub Release Preflight must pass before tagging.
- Non-blocking issues:
  - `talkis-pc-884`: Vite reports a mixed static/dynamic `SummaryModal.tsx` import and an 894.00 kB main JavaScript chunk.
- Follow-ups after release:
  - None identified yet.

## Decision

- Ready for `main` merge: no, pending exact-commit Release Preflight.
- Release preflight green on exact tag commit: no, pending.
- Ready for tag publish: no, pending.
