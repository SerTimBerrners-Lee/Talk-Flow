# Release Review Template

Copy this file to `docs/release/review-vX.Y.Z.md` for each release.

## Release

- Version:
- Release branch:
- Target tag:
- Reviewer:
- Date:

## Scope

- Key changes included in this release:
- User-facing changes:
- Risky areas:

## Checks run

- `bun run check:release`
- `bun run build:release:macos`
- GitHub Release Preflight:
- Native/GitHub Windows build:
- Native/GitHub Linux build:
- Additional manual checks:

## Manual review

- Hotkey flow:
- Onboarding permissions:
- Widget position and notice behavior:
- Transcription quality and short-utterance handling:
- README refreshed:

## Findings

- Blockers:
- Non-blocking issues:
- Follow-ups after release:

## Decision

- Ready for `main` merge: yes/no
- Release preflight green on exact tag commit: yes/no
- Ready for tag publish: yes/no
