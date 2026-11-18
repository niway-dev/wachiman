# Command identity

**Status: proposed shortcut; this documentation does not change the published package.**

Wachiman remains the product name, npm package name and canonical CLI command. The owner wants
`wachi` as an optional shortcut. The intended implementation is a second npm `bin` entry pointing
at the same Node launcher as `wachiman`, with identical arguments, configuration, state and exit
codes. It does not add `wm`, change PR mentions, or rename stored data.

The shortcut must be verified from a packed, temporarily installed package, including version,
help, safe setup dry-run, error behavior and `npm exec` resolution. An existing executable named
`wachi` is an installation conflict to document, not a reason to force an overwrite.

This applies the optional-short-command direction in the
[one-name decision](../adr/0023-one-name-for-every-surface-people-type.md#reopen-when).
Implementation and release remain separate work. Until then, use `wachiman`.
