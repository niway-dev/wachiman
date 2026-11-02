#!/bin/sh
# The provider passes only an allowlist of variables to `claude` (no USER), and a local
# Claude Code login is read from the macOS keychain, which needs USER. In CI the engine uses
# ANTHROPIC_API_KEY instead. This restores USER and runs the real binary; nothing else changes.
USER="${USER:-$(id -un)}"
export USER
exec claude "$@"
