# Changelog

> **Licensing.** Releases up to and including v1.3.0 were published under the GNU Affero General
> Public License version 3 or any later version. Later releases are published under the Functional Source License 1.1
> (`FSL-1.1-ALv2`). The `LICENSE` file in each release tag says which applies. See the README and
> [ADR 0013](docs/adr/0013-license-fsl-1-1-alv2.md).

## [1.8.0](https://github.com/niway-dev/wachiman/compare/v1.7.0...v1.8.0) (2026-11-05)


### Features

* **cli:** a dry run can ignore the previous-review marker ([dc33978](https://github.com/niway-dev/wachiman/commit/dc339786fbf20f7e900c1af298432d58af650d1f))
* **cli:** agent-review history lists, judges and forgets local runs ([6c8e954](https://github.com/niway-dev/wachiman/commit/6c8e9544286f4161ffc37a0b5894b16427baf752))
* **cli:** agent-review local reviews the committed branch on the signed-in claude ([6ae3ceb](https://github.com/niway-dev/wachiman/commit/6ae3ceb15f30dab194abcf01d438c3e2559b029c))
* **history:** an on-laptop store of local review runs ([62ee611](https://github.com/niway-dev/wachiman/commit/62ee61118f641d2b6a2053d0f61cb59a820e78d6))
* **history:** deterministic fingerprints for findings ([c05cba5](https://github.com/niway-dev/wachiman/commit/c05cba502a1e4cb9c113e596be4618b544e6acb2))
* **history:** match findings across runs and replay the state ([2cc84a4](https://github.com/niway-dev/wachiman/commit/2cc84a427bb6760fe051807dc9614cfd9e221e47))
* local review on the developer's own subscription ([f70f3d4](https://github.com/niway-dev/wachiman/commit/f70f3d4e1c6976d3b91318f09522657d9168ab89))
* **local:** --history saves the run and labels findings against earlier runs ([e3844b2](https://github.com/niway-dev/wachiman/commit/e3844b2d11a0a6f3ebb20654192ad94e5ad7f738))
* **local:** a local-git connector that builds the review input from a clone ([29b1036](https://github.com/niway-dev/wachiman/commit/29b1036f142f2130175b46f48c93624b2d2249d3))
* **local:** isolated Claude profiles under ~/.wachiman ([b2d45b7](https://github.com/niway-dev/wachiman/commit/b2d45b725a11c4d11f8f93291060653e766fc611))
* **local:** review from a start commit with a maximum depth ([f93af04](https://github.com/niway-dev/wachiman/commit/f93af041649cc9efe6803a2ba6cef3ad54bbd7fe))
* **local:** review from a start commit with a maximum depth ([a0a7446](https://github.com/niway-dev/wachiman/commit/a0a74462cc53c2501502d1b24ec15bf90440e068))
* **local:** terminal, Markdown and JSON renderings of a review result ([51d355c](https://github.com/niway-dev/wachiman/commit/51d355cc18f315654e0f1ec5215fcfd7df9e9edb))
* **providers:** a subscription mode for the Claude Code adapter ([1205965](https://github.com/niway-dev/wachiman/commit/1205965a61691bfeb139c974abe3425176a59c6e))


### Bug Fixes

* **engine:** remove each batch's run directory after the call ([d013ea1](https://github.com/niway-dev/wachiman/commit/d013ea196cbb3004b2b0b6a64bc133bdeb2b2745))
* **history:** leave run files of another format version in place ([6dc2992](https://github.com/niway-dev/wachiman/commit/6dc2992f9a3103b18ab1f04740de20e32f1d5143))
* **history:** match every finding by line hash before any by title ([b7a40be](https://github.com/niway-dev/wachiman/commit/b7a40bed190276ec597119701dbc760497725a14))
* **history:** reject --all-repos together with --forget ([235f454](https://github.com/niway-dev/wachiman/commit/235f4549d01c22e6ab9537a059270104cf3cef3d))
* **history:** report a failed prune on its own and keep the saved run's annotation ([3659d84](https://github.com/niway-dev/wachiman/commit/3659d848bb6417999a1835c6e23bf4af6d6cc6a7))
* **history:** settle a finding only when its last head is an ancestor of this run's head ([4d583c0](https://github.com/niway-dev/wachiman/commit/4d583c040c6a8924cac3a8736ddadc18b82db40d))
* **history:** strip userinfo before parsing the remote and never store an unparsed one ([bcde0c4](https://github.com/niway-dev/wachiman/commit/bcde0c44b056197c5706c8031ef28033762219a4))
* **history:** tighten directory modes on every save and correct the docs ([0f9da86](https://github.com/niway-dev/wachiman/commit/0f9da86f30e538b9cbb0c5a1cc4249b37ffcfc76))
* **history:** validate run files and make replay tolerate missing fields ([f756419](https://github.com/niway-dev/wachiman/commit/f7564196241dcbafcb642e10a5da6389ea5b71c0))
* **local:** say "1 commit", not "1 commits", in the depth line ([494479c](https://github.com/niway-dev/wachiman/commit/494479c3ea42d70f97eef58bb89f9d6edd5a10c3))
* **local:** show a cost under a cent instead of $0.00 ([01a0b61](https://github.com/niway-dev/wachiman/commit/01a0b61f3c9ebcb036a91638ad19bc5cf18a9918))
* **local:** show a sub-cent batch cost in the Markdown table ([8846958](https://github.com/niway-dev/wachiman/commit/88469586474234bfec4a46c3e656ef494a564a09))
* **local:** show a sub-cent batch cost in the Markdown table ([1754b4a](https://github.com/niway-dev/wachiman/commit/1754b4af74561d994783d33102e45fb213501cc5))


### Code Refactoring

* **engine:** extract reviewChange behind a source port and a sink port ([d2c4c8a](https://github.com/niway-dev/wachiman/commit/d2c4c8ae27c0c1ace5cc1b11ee1188c4b53de5a5))
* **engine:** PrFile is ReviewFile; the old name stays as an alias ([d92334e](https://github.com/niway-dev/wachiman/commit/d92334edef96522b47b07f85d4a4d6d360cbea91))
* **engine:** the batch pipeline reads its head directory and change description from its context ([423253b](https://github.com/niway-dev/wachiman/commit/423253b95cdbe4a6e4f0d489fdc6dda023649f85))

## [1.7.0](https://github.com/niway-dev/wachiman/compare/v1.6.0...v1.7.0) (2026-11-04)


### Features

* add a readable log line for each provider call ([9f05cbc](https://github.com/niway-dev/wachiman/commit/9f05cbcfa630c16fe5a7d2ceeebeb60d69821a9a))
* **engine:** add a readable log line for each provider call ([5f34e5d](https://github.com/niway-dev/wachiman/commit/5f34e5dfc92581086888ff0f55f036055aba813f))

## [1.6.0](https://github.com/niway-dev/wachiman/compare/v1.5.0...v1.6.0) (2026-11-04)


### Features

* **engine:** record a dead model call as an unknown cost, and debounce pushes in the copy template ([052291d](https://github.com/niway-dev/wachiman/commit/052291ddad67921478b72a612bb884ce43170cd3))
* **engine:** report the cost of every model call, and debounce pushes before spending ([8e0e848](https://github.com/niway-dev/wachiman/commit/8e0e8485598a5428381fda55c6d6c874c96994c8))
* **providers:** classify provider errors and keep the CLI's error text ([642e304](https://github.com/niway-dev/wachiman/commit/642e3045e0e3dc0ac18d27f06d8ca1cd4f9049aa))
* report the cost of every model call and debounce pushes before spending ([1e6fcc6](https://github.com/niway-dev/wachiman/commit/1e6fcc6e33f96a794f9ca37194056f6772010323))


### Bug Fixes

* **engine:** count a killed call at its cap and keep Codex cache writes ([ec36941](https://github.com/niway-dev/wachiman/commit/ec369417eb39980f2ee66db9266834b37ccbb2e3))
* **engine:** keep restored and renamed rows when narrowing a merge's changes ([6906e5d](https://github.com/niway-dev/wachiman/commit/6906e5d1fefea582c7ce89f5dcd40c50f4c00e78))
* **engine:** post a notice instead of failing when the provider rejects the call ([0685f46](https://github.com/niway-dev/wachiman/commit/0685f463969e11339099fe166baf5b0b1c94f20e))
* **engine:** price Codex cache writes and stop treating a missing Claude cost as free ([61a9d2f](https://github.com/niway-dev/wachiman/commit/61a9d2fe398a7339c5d906cb1dc4de051842a3c3))
* **engine:** send the whole patch when prior ownership is unknown ([cd0c4c0](https://github.com/niway-dev/wachiman/commit/cd0c4c0ae70403c2cfc937dd873e169c709a7e7f))
* keep restored and renamed rows in incremental re-review ([2cb26b9](https://github.com/niway-dev/wachiman/commit/2cb26b99f2316fa945c99fb363e83f6f5a1aba13))
* post a notice instead of failing when the provider rejects the call ([a936b21](https://github.com/niway-dev/wachiman/commit/a936b2184e04a4671b46c9c173b8c8d623c79b68))
* **providers:** do not classify a bare "billing" as a billing rejection ([7540b0b](https://github.com/niway-dev/wachiman/commit/7540b0b5c3bcbcf5f571151916ef46cc6f681ce9))
* **questions:** remove logging before deciding a catch handled the read error ([bf818f1](https://github.com/niway-dev/wachiman/commit/bf818f1b5c3619744cc211e6d59b23490d0ee204))
* **questions:** skip quoted text when removing logging calls ([d6ad7b4](https://github.com/niway-dev/wachiman/commit/d6ad7b4c44b7f01392a700899ef916de4dc53173))


### Reverts

* **questions:** leave the read-error scanner as on main ([6cf2d67](https://github.com/niway-dev/wachiman/commit/6cf2d67fcfbc47561fef87a40d7187949bbdf301))

## [1.5.0](https://github.com/niway-dev/wachiman/compare/v1.4.0...v1.5.0) (2026-11-02)


### Features

* ask data-path questions only where the added lines show the pattern ([3246663](https://github.com/niway-dev/wachiman/commit/3246663ed0ab5551ae5a89b54b6d0105bde4e99b))
* cap automatic runs per pull request and answer thread replies without a push ([c24be7a](https://github.com/niway-dev/wachiman/commit/c24be7a08d6172b68eb3cd64f1c5359f9de40ee0))
* measure question firing, skip tests in read-error-as-empty, ADR 0016 ([bc15d40](https://github.com/niway-dev/wachiman/commit/bc15d4075c4b748572043adf7d9f5b8b7251b096))
* **questions:** add the bounded-wait data-path question ([7c69df8](https://github.com/niway-dev/wachiman/commit/7c69df898fa32de1d5116bf6410d9a44adc4b2d3))
* **questions:** ask what a write-back does to another writer's change ([41727a1](https://github.com/niway-dev/wachiman/commit/41727a1b832d3e708ef81554e2168c8f283267fd))
* **questions:** ask what two overlapping calls do to shared state ([c42b1f7](https://github.com/niway-dev/wachiman/commit/c42b1f7922f473e46a97ea1b11d83892fe336ce1))
* **questions:** ask whether an unreadable file is treated as empty and written back ([bf87115](https://github.com/niway-dev/wachiman/commit/bf87115229500c2258df7a96adc252898eb6cfd3))
* **questions:** ask whether destructive steps re-verify their target ([1f9bdc6](https://github.com/niway-dev/wachiman/commit/1f9bdc633aa5a545eda7d7b64baee6999e25076d))
* select data-path questions per batch from the added lines ([0102135](https://github.com/niway-dev/wachiman/commit/010213552ad798d0896bfdbfe17a5f8e9be24308))


### Bug Fixes

* a merge into a re-reviewed file sends only the author's rows ([17bfb19](https://github.com/niway-dev/wachiman/commit/17bfb19bc9d449be60ccff5bce0cfc9aea86aa1d))

## [1.4.0](https://github.com/niway-dev/wachiman/compare/v1.3.0...v1.4.0) (2026-11-02)


### Features

* ask flow and failure questions, return contracts and confidence ([c364f13](https://github.com/niway-dev/wachiman/commit/c364f13453822c2c99db5f094c6e0871650fcda8))
* ask flow and failure questions, return contracts and confidence ([22cf113](https://github.com/niway-dev/wachiman/commit/22cf113b7c46679787df2bdac68cebe79797af75))
* cap agent turns and kill calls at a wall-clock limit ([8a67abb](https://github.com/niway-dev/wachiman/commit/8a67abb63035c493a94015bf0240274a030abc76))
* cap agent turns and kill calls at a wall-clock limit ([57c94d4](https://github.com/niway-dev/wachiman/commit/57c94d4dcab6911f78591d447a71b859df0fd2aa))
* give each batch the sibling call sites of the symbols it newly calls ([4842d98](https://github.com/niway-dev/wachiman/commit/4842d98c989fc8085580d7ea00a2c26390bf7d67))
* give each batch the sibling call sites of the symbols it newly calls ([afb8f38](https://github.com/niway-dev/wachiman/commit/afb8f383261171fb596e78a47dbbe2bee89dee93))
* make the model's reasoning effort an explicit, logged input ([#56](https://github.com/niway-dev/wachiman/issues/56)) ([e15e5cc](https://github.com/niway-dev/wachiman/commit/e15e5ccf7dc6e5402315c08eb998950664823fa3))
* relicense future releases under FSL-1.1-ALv2 and add a trademark policy ([531d4a0](https://github.com/niway-dev/wachiman/commit/531d4a0995b5595848e8e27cbaf44a8aed4b9357))
* relicense future releases under FSL-1.1-ALv2 and add a trademark policy ([0a610a5](https://github.com/niway-dev/wachiman/commit/0a610a58017b2500a2a5557d065d830893405892))
* review every push incrementally and skip rebases with no content change ([709defd](https://github.com/niway-dev/wachiman/commit/709defddc6b2d7e4740d6b6c629afa3b59ba918a)), closes [#43](https://github.com/niway-dev/wachiman/issues/43)
* review every push incrementally; a rebase with no content change costs nothing ([c4cc8d3](https://github.com/niway-dev/wachiman/commit/c4cc8d39c612613a569b11f3b6e811b6512000db))


### Bug Fixes

* a merge of the base branch reviews none of the base's files ([c3965f5](https://github.com/niway-dev/wachiman/commit/c3965f5df6f2387a152fd6254dcd566c4ab063dc))
* enforce the confidence rule in code and pin the one-review contract ([5f2dda1](https://github.com/niway-dev/wachiman/commit/5f2dda122437e43649e602811027ebc5f507d508))
* enforce the confidence rule in code; pin the one-review contract ([#17](https://github.com/niway-dev/wachiman/issues/17)) ([25c95a8](https://github.com/niway-dev/wachiman/commit/25c95a86269a954914ca1db363c62554b5e9107e))
* name Niway S.A.C. as licensor and fill the legal placeholders ([6893774](https://github.com/niway-dev/wachiman/commit/6893774a9b11a398c1daf0baf139b07f8a0f0a6a))
* name Niway S.A.C. as licensor and fill the legal placeholders ([e585ca0](https://github.com/niway-dev/wachiman/commit/e585ca030bdb8d203502728336e6cced4f45ad28))
* qualify the Apache conversion in ADR 0013 and complete the FAQ Competing Use summary ([b87fcd7](https://github.com/niway-dev/wachiman/commit/b87fcd7bd878d30fd3dbabdfa16618bf624626e4))
* scope the Apache conversion to FSL versions and tighten the license summaries ([795c52d](https://github.com/niway-dev/wachiman/commit/795c52de9e300c866573741def8c735f546ed29c))

## [1.3.0](https://github.com/niway-dev/wachiman/compare/v1.2.1...v1.3.0) (2026-10-31)


### Features

* open every posted comment with the Wachi Reviewer brand ([8953788](https://github.com/niway-dev/wachiman/commit/8953788288ab72d3afd4af113b2c2a74903a8f31))
* open every posted comment with the Wachi Reviewer brand ([6c607e7](https://github.com/niway-dev/wachiman/commit/6c607e78f1f0ca199cfa831829b2bbeb015da758))
* rename the tool to Wachiman ([e5c3845](https://github.com/niway-dev/wachiman/commit/e5c3845c1284b5fccd4f739b73d71f4713ed6b25))
* rename the tool to Wachiman ([64d3434](https://github.com/niway-dev/wachiman/commit/64d3434004937c748bb1fd8dd51d65ab8016006b))

## [1.2.1](https://github.com/niway-dev/wachi-reviewer/compare/v1.2.0...v1.2.1) (2026-10-31)


### Bug Fixes

* accept markers only in the engine footer and end the legacy window ([c884536](https://github.com/niway-dev/wachi-reviewer/commit/c88453694ab948059c1a37ef9619525979f53583)), closes [#39](https://github.com/niway-dev/wachi-reviewer/issues/39) [#40](https://github.com/niway-dev/wachi-reviewer/issues/40)
* date reviews by submitted_at, the field GitHub review objects carry ([2ea9899](https://github.com/niway-dev/wachi-reviewer/commit/2ea9899cb2227676198ef1d7e38f35adc138b11c)), closes [#40](https://github.com/niway-dev/wachi-reviewer/issues/40)
* keep the fallback body under the limit when findings fill it before the Summary ([6e6f751](https://github.com/niway-dev/wachi-reviewer/commit/6e6f7513c66ef8a67c199c3afcdb5c9d245c6e23)), closes [#41](https://github.com/niway-dev/wachi-reviewer/issues/41)
* match the review attempt, classify nested errors, keep the fallback under the limit ([acffca5](https://github.com/niway-dev/wachi-reviewer/commit/acffca5ec7da688e5ce047cee3a288df034c5d72)), closes [#41](https://github.com/niway-dev/wachi-reviewer/issues/41)
* only the engine can write review markers and signatures ([4f3d426](https://github.com/niway-dev/wachi-reviewer/commit/4f3d426942b1d6c040d04ddc01ab3a1f5e9f0e67))
* only the engine can write review markers and signatures ([a6d21d9](https://github.com/niway-dev/wachi-reviewer/commit/a6d21d9aa4288db60d3bb6ae7780c32a7cc8a2f5)), closes [#39](https://github.com/niway-dev/wachi-reviewer/issues/39) [#40](https://github.com/niway-dev/wachi-reviewer/issues/40)
* read review instructions from the base commit ([35415e3](https://github.com/niway-dev/wachi-reviewer/commit/35415e33bf92f1b93bc1d62ef8c70f5d44bb126e))
* read review instructions from the base commit ([325b696](https://github.com/niway-dev/wachi-reviewer/commit/325b696aa54fd74ce24018ebb3574820ad08dd12)), closes [#10](https://github.com/niway-dev/wachi-reviewer/issues/10)
* retry transient review errors and fall back only on validation failures ([7d4fe1d](https://github.com/niway-dev/wachi-reviewer/commit/7d4fe1d7d96805f8c6a6ababe1f1768546d8ef44))
* retry transient review errors and fall back only on validation failures ([d5cb48e](https://github.com/niway-dev/wachi-reviewer/commit/d5cb48e32970425007d88b024443ddbd9feb4082)), closes [#41](https://github.com/niway-dev/wachi-reviewer/issues/41)
* start the provider outside the head so it cannot load its instructions ([84298bb](https://github.com/niway-dev/wachi-reviewer/commit/84298bbbdf3bc020d3961dee0a02da7fd5486557)), closes [#10](https://github.com/niway-dev/wachi-reviewer/issues/10)

## [1.2.0](https://github.com/niway-dev/agent-review/compare/v1.1.0...v1.2.0) (2026-10-27)


### Features

* add a Codex provider for reviews by OpenAI models ([afb778d](https://github.com/niway-dev/agent-review/commit/afb778d00febcee5bead2806e16168ecd28f7341))
* add a Codex provider for reviews by OpenAI models ([947d7d3](https://github.com/niway-dev/agent-review/commit/947d7d3a1f473646ba77d5421251012ff814cc27))
* answer /wachi, a command that notifies no GitHub account ([89ec9f9](https://github.com/niway-dev/agent-review/commit/89ec9f904a20f945204fd774a2f59e2ecab0b1ee))
* rename to Wachi Reviewer with a /wachi command that pings nobody ([315d915](https://github.com/niway-dev/agent-review/commit/315d9155d385550c0b2924e6aeb3ef5824fc6bbe))
* require evidence before a finding is stated as a fix ([2c1f323](https://github.com/niway-dev/agent-review/commit/2c1f323dd2e2bccadea90b0796ca5aab17ffa439))
* require evidence before a finding is stated as a fix ([ad29f24](https://github.com/niway-dev/agent-review/commit/ad29f2435f4201b0b679039f3d7cd4c44a728baf))

## [1.1.0](https://github.com/niway-dev/agent-review/compare/v1.0.0...v1.1.0) (2026-10-26)


### Features

* label findings on two axes, severity and topic ([2b91c90](https://github.com/niway-dev/agent-review/commit/2b91c9070ca95f0b8e30a776e45c8e9300e56fcc))
* label findings on two axes, severity and topic ([43efd27](https://github.com/niway-dev/agent-review/commit/43efd270a801ffc6542d90dc02934ef3691a80bf))

## [1.0.0](https://github.com/niway-dev/agent-review/compare/v1.0.0-rc.1...v1.0.0) (2026-10-26)


### Bug Fixes

* apply the engine, workflow, adapter, test and docs changes ([81f7b97](https://github.com/niway-dev/agent-review/commit/81f7b97e1e5d62da2941fff94ded58559ddd9a10))
* run the engine outside the reviewed head and refuse placeholder operators ([dce52be](https://github.com/niway-dev/agent-review/commit/dce52be569019a3944702ab97c87cd14b62b405d))
* run the engine outside the reviewed head; refuse placeholder operators ([2646cdd](https://github.com/niway-dev/agent-review/commit/2646cdd7fdbe6ca7430cb4e596573290ea7d3980))

## 1.0.0-rc.2 (hand-written, before release-please)

This section and everything below it were written by hand. From the first release-please release
(`1.0.0`) on, new sections are generated above it. Its heading is a version number on purpose:
release-please inserts each new release above the first version heading it finds.

### Release automation

- Releases are cut by release-please from Conventional Commits: merging its release PR creates the
  exact `vX.Y.Z` tag and a GitHub Release, bumps `package.json` and updates this file, then moves
  the floating `v1` tag. See `docs/releasing.md`.

### Documentation

- `docs/architecture.md` (how the engine and the workflow fit together and what a change must keep) and ADR 0002 (TypeScript on Bun, no runtime dependencies).
- `docs/install.md` and `docs/releasing.md` reflect the first tags (`v1.0.0-rc.1` and the floating `v1`).

### Security

- The reusable workflow checks the reviewed head out into `head/` and the engine into a sibling
  `engine/`, and runs Bun from `engine/` with `--no-env-file --config=bunfig.toml`, so a
  `bunfig.toml` `preload` or a `.env` in the head is never loaded into the process that holds the
  API key. New `--repo-dir <dir>` option (default `.`) for the head's path; the engine uses it for
  file reads and as the agent's working directory. New engine-owned `bunfig.toml`. The copy-the-files
  template uses the same flags and documents that it cannot fully separate engine and head. (#7)
- The Claude Code adapter builds the agent's environment from an allowlist (`PATH`, `HOME`,
  `TMPDIR`, `TERM`, `LANG`, `LC_*`, `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, `CI`,
  `GITHUB_ACTIONS`) instead of the parent's environment minus two tokens. (#7)
- Hostile fixture `test/fixtures/hostile/` and tests for the Bun flags and the environment. (#7)
- The reusable workflow fails early when `operator` is empty or a template placeholder
  (`EDIT…`, `your-github-login`), and `comment` refuses the same values from
  `AGENT_REVIEW_OPERATOR`. (#12)

### Supply chain

- Workflows: `actions/checkout` and `oven-sh/setup-bun` are pinned by full commit SHA with the
  version in a trailing comment (also in `templates/caller-workflow.yml`); the actionlint image
  in CI is pinned by digest. Dependabot (`.github/dependabot.yml`) updates the action pins weekly.
- Claude Code install: the reusable workflow and the copy template no longer pipe
  `claude.ai/install.sh` into a shell. `src/install-claude-code.sh` downloads the pinned version
  and fails unless its SHA-256 matches the publisher's manifest. New optional input
  `claude_code_sha256` pins the hash independently. Default `claude_code_version` stays 2.1.304.
- Docs: how the binary is verified (`docs/providers/claude-code.md`), ruleset protection of
  `main` and `v*` tags (`docs/releasing.md`), supply-chain note (`SECURITY.md`).

## 1.0.0-rc.1 (2026-10-25)

Initial import of the review engine from a private kit. First release candidate.

- `src/claude-review.ts`: the engine. Reviews a pull request with `claude -p` in batches ordered
  by risk, posts inline review comments, and answers the operator's `@claude` comments.
- `src/claude-review.test.ts`: tests for the pure functions (no network).
- `src/engine-settings.json`: the engine's own Claude Code settings (denies `Bash` and `/proc`).
- `templates/caller-workflow.yml`: the four-file workflow template.
- `docs/setup-copy.md`: setup by copying the files.
- `docs/adr/0001-distribution-and-trust.md`: why the tool is public, how it will be distributed,
  and where its trust ends.
- `README.md`, `SECURITY.md`, `LICENSE` (GNU AGPL-3.0).

### CLI contract and provider adapter

- `src/cli.ts`: the command-line entry point (`review <pr> [paths…]`, `comment <pr>`, `--help`,
  `--version`), with exit codes 0 (posted or nothing to do), 1 (engine error) and 2 (usage error).
  `package.json` gets a `bin` entry. Documented in `docs/cli.md`.
- `src/providers/`: the `ProviderAdapter` interface (`types.ts`), the Claude Code adapter
  (`claude-code.ts`, with its settings file renamed to `claude-code.settings.json`) and
  `getProvider`. The engine no longer contains any Claude Code flag or binary name. Documented in
  `docs/providers/claude-code.md`.
- `src/claude-review.ts` is renamed `src/engine.ts`; settings are read once by `src/config.ts`.
- Environment variables are now `AGENT_REVIEW_*`; each falls back to the old `CLAUDE_REVIEW_*` with
  a deprecation notice. New: `AGENT_REVIEW_PROVIDER`, `AGENT_REVIEW_MENTION`,
  `AGENT_REVIEW_OPERATOR` and, optionally, `AGENT_REVIEW_COMMENT_AUTHOR`.
- The review marker written is `<!-- agent-review sha=… -->`; the old `<!-- claude-review sha=… -->`
  is still read.
- The mention keyword is `@agent-review` (configurable); `@claude` is accepted as an alias.
- The footer names the provider and model, for example "Claude Sonnet 5.5 via Claude Code 2.1.304".
- The review focus file is `.github/agent-review.md`; `.github/claude-review.md` is still read
  with a notice.
- The workflow template and `docs/setup-copy.md` use the new names and paths.
- Tests: an end-to-end run of the batch loop against a fake provider, tests for the adapter, the
  settings, the CLI and both markers and mentions; fixtures use neutral names.
- `SECURITY.md`: reports are handled best-effort, with no SLA.

### Reusable workflow

- `.github/workflows/review.yml`: the reusable workflow (`workflow_call`). Two jobs, `review` and
  `on-demand`, that check out the head as data and the engine at the called workflow's commit.
- `templates/agent-review-caller.yml`: the short caller file consumers add.
- `docs/install.md`, `docs/releasing.md`: installation and the tag rules.
- `.github/workflows/ci.yml`: tests and actionlint for this repository.
