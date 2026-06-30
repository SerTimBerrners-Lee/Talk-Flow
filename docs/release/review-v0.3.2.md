# Release Review

## Release

- Version: 0.3.2
- Release branch: release/v0.3.2
- Target tag: v0.3.2
- Reviewer: Codex
- Date: 2026-06-30

## Scope

- Key changes included in this release: single-instance focus fix for Windows/Linux, auth flow cancellation guard, subscription/account card cleanup, main-page stats glass card with rotating help/support hint, settings navigation order update, first-launch signing guidance in README/site/release notes.
- User-facing changes: widget should no longer duplicate on repeated launch on Windows/Linux; logout should not immediately re-authenticate from stale auth flow; subscription CTA/status states are clearer; the settings menu puts general settings at the bottom.
- Risky areas: cloud auth deep-link/polling flow, settings model tab conditional rendering, release artifact workflow text, UI layout around the main stats panel.

## Checks run

- `git diff --check`: passed
- `bun run check:release`: passed
- `TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/talkis-updater.key bun run build:release:macos`: failed at DMG bundling in this sandboxed environment after `.app` build; `hdiutil` reports `Cannot start hdiejectd because app is sandboxed` / `Device not configured`.
- Native/GitHub Windows build: expected via GitHub Actions after tag
- Native/GitHub Linux build: expected via GitHub Actions after tag
- Additional manual checks: release diff reviewed statically; no browser/Playwright pass requested.

## Manual review

- Hotkey flow: no hotkey registration code changed; main screen still renders the configured hotkey on the first hint slide.
- Onboarding permissions: no permission/onboarding flow changes in this release.
- Widget position and notice behavior: single-instance handler now unminimizes/shows/focuses the existing widget on Windows/Linux.
- Transcription quality and short-utterance handling: no transcription pipeline or hallucination-filter changes in this release.
- README refreshed: README.md and README.ru.md include first-launch instructions for unsigned builds.

## Findings

- Blockers: local macOS DMG packaging could not be completed in the current sandboxed environment.
- Non-blocking issues: Windows/Linux release artifacts are validated by GitHub Actions runners, not locally on this macOS machine.
- Follow-ups after release: continue paid code-signing/certification work to reduce first-launch OS warnings.

## Decision

- Ready for `main` merge: no, blocked until DMG build is validated outside this sandbox or by CI.
- Ready for tag publish: no, blocked until release artifacts are validated.
