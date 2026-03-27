# Release Review

## Release

- Version: `0.1.5`
- Release branch: `release/v0.1.5`
- Target tag: `v0.1.5`
- Reviewer: OpenCode
- Date: 2026-03-27

## Scope

- Key changes included in this release:
  - hard-block onboarding completion when the release app is launched outside `Applications`
  - make the onboarding actions open `/Applications` instead of letting the user get stuck in a broken accessibility flow
  - bump the app version from `0.1.4` to `0.1.5`
- User-facing changes:
  - the permission screen now explicitly routes the user to `Applications` when the app is launched from DMG or App Translocation
  - avoids the misleading state where accessibility can never validate but the app still asks the user to continue checking
- Risky areas:
  - onboarding-only UX changes; no backend permission API changes in this release branch

## Checks run

- `bun run check:release` - passed
- `bun run build:release:macos` - passed
- Additional manual checks:
  - confirmed the permission screen now opens `/Applications` when install location is invalid

## Manual review

- Hotkey flow: unchanged in this release branch
- Onboarding permissions: updated; invalid install location is now treated as a hard blocker with a direct action path
- Widget position and notice behavior: unchanged in this release branch
- Transcription quality and short-utterance handling: unchanged in this release branch
- README refreshed: yes

## Findings

- Blockers: none yet
- Non-blocking issues: none yet
- Follow-ups after release:
  - validate the downloaded GitHub artifact end-to-end by copying the app from the DMG into `Applications`

## Decision

- Ready for `main` merge: yes
- Ready for tag publish: yes
