# Contributing to Wachiman

Wachiman is maintained by Cristian Sotomayor ([@csdev19](https://github.com/csdev19)) and published
by NIWAY (Niway S.A.C.) under the [Functional Source License](LICENSE) (`FSL-1.1-ALv2`). It is
source available, not open source. It is a small project handled on a best-effort basis, with no response-time
promise.

## Pull requests from outside the team are not accepted for now

The code is public, but the repository restricts pull request creation to collaborators, so
outside pull requests cannot be opened. The contributor license agreement below is still an
unreviewed draft, and that is why.

- Bugs, questions and ideas: open a [GitHub issue](https://github.com/niway-dev/wachiman/issues).
- Security reports: use GitHub's private vulnerability reporting, never a public issue. See
  [SECURITY.md](SECURITY.md).

The rest of this page applies when outside contributions open.

## Before you write code

- Open an issue first for anything beyond a typo or a documentation fix, so nobody writes a change
  the project will not take.
- Read [docs/architecture.md](docs/architecture.md) and the [ADRs](docs/adr/). A change that
  contradicts an ADR needs to say which one and why.

## The contributor license agreement

Outside contributors must accept [CLA.md](CLA.md) once by ticking the PR-template checkbox.
Acceptance covers later contributions until withdrawn for future submissions; NIWAY checks the
acceptance record before merging. You keep the copyright to your work. NIWAY gets a license
broad enough to keep licensing the whole project, including selling commercial licenses that cover
your contribution and changing the terms for future versions. Versions already published keep their
license. Each version published under FSL-1.1-ALv2 also becomes available under Apache 2.0 two
years after that version is made available.

A pull request without the accepted agreement is not merged. Code pasted in an issue is read as a
report and is merged only after its author has accepted the agreement.

## Pull requests

- One behavior per pull request; refactors travel separately.
- Titles follow [Conventional Commits](https://www.conventionalcommits.org/), because releases and
  the changelog are generated from them (see the README, "Commit messages").
- Run `bun test`, `bun run fmt` (writes the formatting), `bun run lint` and `bun run check` before you
  push. The last two compare with `scripts/ratchet-baseline.json`: a change may not add a lint
  diagnostic or a type error, and may remove some (then run `bun run ratchet:update` and commit the
  baseline). The tools run on pinned Bun versions through `bunx`; see
  [ADR 0061](docs/adr/0061-bun-is-the-development-toolchain-with-a-ratchet-for-what-already-exists.md).
- A change that makes Wachiman send any usage or diagnostic data must: (a) honor `doNotTrack()` in
  `src/tracking.ts`, so a set `DO_NOT_TRACK` always wins over a stored opt-in; (b) be listed in
  `docs/on-your-machine.md` before the release; (c) add an entry for its release version to
  `wachimanDataCollection` in `package.json`, which `wachiman upgrade` prints; and (d) be called out
  in `CHANGELOG.md`.
- Say whether an AI tool wrote part of the change, and confirm you ran it.
- Do not add a dependency without an issue first. The review engine has none on purpose (ADR 0002);
  the only runtime dependencies are `chalk`, `@clack/prompts` and `bun`, the first two for the
  terminal screens only. Every dependency has to be compatible with the license.

## Try a change before it is released

`scripts/dev-build.sh` packs your checkout the way a release does and installs it as
`wachiman-dev`, next to the released `wachiman`. Nothing is published.

```sh
scripts/dev-build.sh               # from any branch or worktree; run it again after each change
wachiman-dev --version             # <version>-dev-<commit>, with .dirty when changes are uncommitted
wachiman-dev                       # the interactive launcher, as a user would get it
scripts/dev-build.sh --as-wachiman # the same, and `wachiman` (hooks, skills) runs this build too
scripts/dev-build.sh --uninstall   # removes wachiman-dev and its files; gives `wachiman` back
```

It installs into `~/.local/share/wachiman-dev` and links `~/.local/bin/wachiman-dev`. A failed build
leaves the previous one working. With `--as-wachiman` it also points `~/.local/bin/wachiman` at the
build and saves the link that was there, which `--uninstall` puts back. It reads
the same `~/.wachiman` profiles as `wachiman`, so a review it runs is a real review on your
account, and `wachiman-dev skills install` updates the Wachiman skills it installed before (a copy you edited is
left alone) to this build's version.

## License of your contribution

Your contribution is distributed under the project's license, `FSL-1.1-ALv2`, and NIWAY may
license it on other terms under the agreement above.
