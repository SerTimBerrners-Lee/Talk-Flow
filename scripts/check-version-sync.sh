#!/usr/bin/env bash

set -euo pipefail

exec bun scripts/check-version-sync.mjs
