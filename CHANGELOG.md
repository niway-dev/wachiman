# Changelog

> **Licensing.** Releases up to and including v1.3.0 were published under the GNU Affero General
> Public License version 3 or any later version. Later releases are published under the Functional Source License 1.1
> (`FSL-1.1-ALv2`). The `LICENSE` file in each release tag says which applies. See the README and
> [ADR 0013](docs/adr/0013-license-fsl-1-1-alv2.md).

## [1.15.0](https://github.com/niway-dev/wachiman/compare/v1.14.0...v1.15.0) (2026-11-13)


### Features

* **cli:** address local review of the help pages ([7fe57fb](https://github.com/niway-dev/wachiman/commit/7fe57fb1536bf773426995edc8036bf1cb6b9ce3))
* **cli:** interactive CLI on Clack and chalk, with Wachi the guard ([#224](https://github.com/niway-dev/wachiman/issues/224)) ([a656aad](https://github.com/niway-dev/wachiman/commit/a656aad9597e87d1e9d64c4718f2671bbf0a30cc))
* **cli:** keep -h and --help as text or values from being read as help ([6ce5262](https://github.com/niway-dev/wachiman/commit/6ce526274b17bb04d4cc2d102d1ba0b204525a9c))
* **cli:** point the ledger help tests at the new help pages ([647b0a4](https://github.com/niway-dev/wachiman/commit/647b0a4bbd9be0da0f516d52b2cdfdc0593b15a6))
* **cli:** short root help and a help page for every command ([377206f](https://github.com/niway-dev/wachiman/commit/377206f8bcb91c017fe1acf1838455670a436d0b))
* **cli:** short root help and a help page for every command ([9b451f7](https://github.com/niway-dev/wachiman/commit/9b451f7ad57ac653034331ad6293e9d914a20629))
* **ledger:** the laptop reads the ledger; one report covers laptop and Actions runs ([25756f3](https://github.com/niway-dev/wachiman/commit/25756f36d5a1f83917568893c3af5affddf0ab1d))


### Bug Fixes

* **ledger:** keep tokens and payloads out of curl's argument list ([1f8ec59](https://github.com/niway-dev/wachiman/commit/1f8ec5971a6e160f2252321ec3cde0f2eca785c5))

## [1.14.0](https://github.com/niway-dev/wachiman/compare/v1.13.0...v1.14.0) (2026-11-13)


### Features

* **engine:** reserve before the first model call, settle after the last ([895804a](https://github.com/niway-dev/wachiman/commit/895804a8267d0a9c146a8b1d4de127de1775d432))
* **engine:** reserve before the first model call, settle after the last ([b877afb](https://github.com/niway-dev/wachiman/commit/b877afb4aa186b8ba799690d4e19cd0070725ca4))


### Bug Fixes

* **engine:** settle every reservation, stop on a wrong ledger url, https only ([077399c](https://github.com/niway-dev/wachiman/commit/077399cc29195ed7e4c494cdef9e32bab8f04797))
* **ledger:** pasteable enrollment hint, honest docs and tests for the settle paths ([9c135e5](https://github.com/niway-dev/wachiman/commit/9c135e5bef1c23c3b280056d6df394bebe34cf61))
* **local:** raise the default --max-depth from 50 to 250 ([662c805](https://github.com/niway-dev/wachiman/commit/662c805f265d8b09c8d881a548f36e236449d0bd))
* **local:** raise the default --max-depth to 250 ([57502b7](https://github.com/niway-dev/wachiman/commit/57502b72fabe059d3a70abbc1b898dee360531f8))
* remove the agent-review name everywhere ([ef441fb](https://github.com/niway-dev/wachiman/commit/ef441fb0aea9a47bd9eaa5b715cba3515be8c989))
* remove the agent-review name everywhere ([e1f2a92](https://github.com/niway-dev/wachiman/commit/e1f2a9240d3ab3f734be6e173caa4c74b665da0b))
* remove the agent-review name everywhere ([d18356b](https://github.com/niway-dev/wachiman/commit/d18356b91c0a70e16711216b43789a1df40ca88f))

## [1.13.0](https://github.com/niway-dev/wachiman/compare/v1.12.0...v1.13.0) (2026-11-12)


### Features

* **cli:** add reset-confidence, a step with no model call ([58da188](https://github.com/niway-dev/wachiman/commit/58da1883df89b50f5afc6a401c651fdaa17aae31))
* **config:** add the AGENT_REVIEW_CONFIDENCE flag for PR Confidence ([c053d9d](https://github.com/niway-dev/wachiman/commit/c053d9d0d312bf9f8131c2dfff8e75695abee915))
* **dashboard:** add wachiman dashboard with JSON and a static HTML page ([eaa0b60](https://github.com/niway-dev/wachiman/commit/eaa0b600aa0be9605fdcb4967a8aec4953dda22c))
* **dashboard:** see spend, findings and loop rounds locally with wachiman dashboard ([7b47765](https://github.com/niway-dev/wachiman/commit/7b47765e596eddd1481e6b14354bf453766b862f))
* **engine:** write PR Confidence into the description after a full review ([a5cebfd](https://github.com/niway-dev/wachiman/commit/a5cebfdbf6113dcce6d24f0f9e2d87e59bf9ad74))
* **fidelity:** add the fixed rules that explain a file without a claim ([4eeb143](https://github.com/niway-dev/wachiman/commit/4eeb143a89d0d163fd4028ce97af3fcb9e8afe51))
* **fidelity:** add the PR Confidence types ([f450ce0](https://github.com/niway-dev/wachiman/commit/f450ce0be77f56a8d9782b5abcf43c8a9b25aa21))
* **fidelity:** check claims and list the files nothing explains ([d7e1833](https://github.com/niway-dev/wachiman/commit/d7e183361476c71c9fd9fc29b673ddbb0de9fec8))
* **fidelity:** claims call prompt, schema and assembly of the batches' claim assignments ([cbe4623](https://github.com/niway-dev/wachiman/commit/cbe462362502753f10ca79497d22dd9cc50a4325))
* **fidelity:** claims call, batch claim assignments and the grade in the review core ([aa918af](https://github.com/niway-dev/wachiman/commit/aa918afe59bd9527242775e0780b7ad2defdebb4))
* **fidelity:** compute the PR Confidence grade from checked facts ([698929d](https://github.com/niway-dev/wachiman/commit/698929d9914128a10ecb1fd48c0b845546e6436e))
* **fidelity:** render and upsert the description block and the cannot say reset ([1440ffc](https://github.com/niway-dev/wachiman/commit/1440ffc0b1e16b72444b3249fc6eecd5a81cc3ff))
* **fidelity:** strip Wachiman's block and digest the author's text ([6489ff2](https://github.com/niway-dev/wachiman/commit/6489ff2779968dccf221da2d0cab98d81ff57436))
* **fidelity:** write the description block best-effort and reset it with no model call ([3819808](https://github.com/niway-dev/wachiman/commit/3819808c24f46d8ba94bfd666f27f44907c3a658))
* **formats:** add fidelity to result /2 and drop it in the /1 downgrade ([0baa2ce](https://github.com/niway-dev/wachiman/commit/0baa2ced92a3b7b0694daab1f983ee04ccea20b2))
* **local:** result /2 carries each finding's history id when history is on ([c06ab74](https://github.com/niway-dev/wachiman/commit/c06ab740f4314216fcde56b67ba5827a2b3ffc18))
* **loop:** the stop rule as a pure function ([760dca4](https://github.com/niway-dev/wachiman/commit/760dca4396d1849a0ea631e5c0ef8c4c7bcd42d6))
* **loop:** the wachiman loop subcommand, one review round per call ([5e9b07a](https://github.com/niway-dev/wachiman/commit/5e9b07af936c5afaa9d65cba37826e1b41f8f451))
* **skills:** a wachiman-loop skill beside wachiman-review ([cb31b02](https://github.com/niway-dev/wachiman/commit/cb31b02127a56d40cb8848a563217caaf83fb102))
* skip a review whose estimated cost is above a size gate ([c028361](https://github.com/niway-dev/wachiman/commit/c028361023d31fb9e76b2966728350caed6ec23a))
* skip a review whose estimated cost is above a size gate ([c1c3d64](https://github.com/niway-dev/wachiman/commit/c1c3d64441d9d089cd2ef2975b6e6b50ee1830eb))
* Sonnet 5.5 at effort high is the default reviewer ([c3e46d5](https://github.com/niway-dev/wachiman/commit/c3e46d598ca5842b0a6abb7230dd2188f6eee87d))
* Sonnet 5.5 at effort high is the default reviewer ([54019c3](https://github.com/niway-dev/wachiman/commit/54019c3fccff024c55c54935c4c13cfb33ca675a))
* **store:** add a rebuildable SQLite index replayed from the history files ([541d1a0](https://github.com/niway-dev/wachiman/commit/541d1a08427aca437f6648e32fc4f656320cc6a2))
* the Actions review can run on a Claude Code subscription token ([d4474f3](https://github.com/niway-dev/wachiman/commit/d4474f39985c5020a9156ff9175c17721664703e))
* the Actions review can run on a Claude Code subscription token ([a1ba00e](https://github.com/niway-dev/wachiman/commit/a1ba00eed3ea4957caf9d20f244a56f3a2dbd4a3))


### Bug Fixes

* a push after a partial review resumes with the files it did not reach ([7ad4c6a](https://github.com/niway-dev/wachiman/commit/7ad4c6a8302c0247911a1ad3f211feb828527638))
* a push after a partial review resumes with the files it did not reach ([7e01775](https://github.com/niway-dev/wachiman/commit/7e01775c406f6a99d1a9a76822533f99af6183c5))
* **ci:** reset gate, reset-confidence docs, and the incremental-review limitation ([7f1f503](https://github.com/niway-dev/wachiman/commit/7f1f503762da3f08fd54342c49a107ee43660cb4))
* **dashboard:** remove the temporary page file on every write failure ([ac89258](https://github.com/niway-dev/wachiman/commit/ac892582c81837a924c914aefe97832ab524313f))
* **engine:** grade every file, and fail closed on limits and a cut claims text ([8c6a1db](https://github.com/niway-dev/wachiman/commit/8c6a1db067fd0dcc2944b634c4cfa3d7e472c80f))
* **fidelity:** a hunk with a backtick is never formatting-only ([ac1aefa](https://github.com/niway-dev/wachiman/commit/ac1aefa73884a2da1ca017fd0838f2d95f9297e6))
* **fidelity:** an opener on a context line still makes a re-indented string body a change ([9cd32a8](https://github.com/niway-dev/wachiman/commit/9cd32a85eec18bcf62219a2f0883088352596249))
* **fidelity:** break autolinks, escape brackets, return the bare block for an empty body ([bb5f0a6](https://github.com/niway-dev/wachiman/commit/bb5f0a67cb26cf8395a925833eb5d68694dd6094))
* **fidelity:** break issue and pull request references in author and model text ([74d2aa2](https://github.com/niway-dev/wachiman/commit/74d2aa2f040606dd6428b9b3521de2a65e4171af))
* **fidelity:** escape the ampersand so an entity cannot spell a reference ([f2931b1](https://github.com/niway-dev/wachiman/commit/f2931b1be086ccc8c746ba5fe150b9c61346c74b))
* **fidelity:** escape the backslash first in author and model text ([925b7a3](https://github.com/niway-dev/wachiman/commit/925b7a304a7b8e2a3c6af3f82df51979005298c1))
* **fidelity:** explain default-excluded build output and snapshots by rule ([ccfc6b8](https://github.com/niway-dev/wachiman/commit/ccfc6b81848ed696936568636cd7e1f33da20694))
* **fidelity:** leave the block alone when the head has moved on ([aa2dec3](https://github.com/niway-dev/wachiman/commit/aa2dec3752038162f917534daaaed0c34398b58f))
* **fidelity:** markup and multiline strings are never formatting-only ([02d7607](https://github.com/niway-dev/wachiman/commit/02d760781e2a9f5a6eaa7a3735b524082e5307ac))
* **fidelity:** say that generated paths are trusted by name, even when reviewed ([062ba33](https://github.com/niway-dev/wachiman/commit/062ba3387ee32862b00dbb1db8d71a9239f51f2f))
* **fidelity:** treat formatting-only changes conservatively ([c17e14c](https://github.com/niway-dev/wachiman/commit/c17e14c24793f9a5de3aed67614ff884895978c2))
* **fidelity:** trim only the edges of a line when judging formatting ([75e1b8e](https://github.com/niway-dev/wachiman/commit/75e1b8e94ed28135cc283f207d6ead4add0b89b7))
* **local-git:** build the snapshot index with read-tree, not git add ([7b1b6c9](https://github.com/niway-dev/wachiman/commit/7b1b6c9e5007496b263823b163e48be32553c34d))
* **local-git:** build the snapshot index with read-tree, not git add ([484ba10](https://github.com/niway-dev/wachiman/commit/484ba1089d8da118c673273696b09ecdfce3e60a)), closes [#193](https://github.com/niway-dev/wachiman/issues/193)
* **loop:** a refuted candidate closes a finding only within the same topic ([79fdcf0](https://github.com/niway-dev/wachiman/commit/79fdcf09374ddaafa4fd77fe6904c5d5a5216877))
* **loop:** a refuted candidate matches only by path, topic and title ([2f42cf1](https://github.com/niway-dev/wachiman/commit/2f42cf13dad87785c11ae72ecad369856c9608c6))
* **loop:** a release because the lines changed stays in later rounds ([9e0f005](https://github.com/niway-dev/wachiman/commit/9e0f0057e6cc789e478d2fbbbeb3135f62444e13))
* **loop:** decide release from the round's own result and the code ([37316c4](https://github.com/niway-dev/wachiman/commit/37316c4577ab8b155dd049ee155053637ccbbed7))
* **loop:** match a refuted candidate the way the history matches a title ([00e8c57](https://github.com/niway-dev/wachiman/commit/00e8c575bf2f8a29ffe773588bc294a88fc689ef))
* **loop:** own-run status, revert-safe releases and --base over an unreadable state ([f658b1a](https://github.com/niway-dev/wachiman/commit/f658b1af28f11a1588d03a833d20e1cc7ed971d7))
* **loop:** recompute the lines-changed release in rounds that read the file ([fb58929](https://github.com/niway-dev/wachiman/commit/fb58929fdb19e0a0aadda3a930f0b571b3546709))
* **store:** do not force a rebuild per call for run files that are kept on purpose ([4e2bedc](https://github.com/niway-dev/wachiman/commit/4e2bedcec2fed3a5177bea9101e2ec7ad5339572))
* **store:** rebuild until a skipped run file is fixed too, and word the dashboard docs exactly ([9e78af9](https://github.com/niway-dev/wachiman/commit/9e78af9fa63ddecafaba539ae207ae92c71afbc5))
* **store:** report a loop file that cannot be read and rebuild until a skipped one is fixed ([19a63da](https://github.com/niway-dev/wachiman/commit/19a63dad73dd59358fcaa68227be4e81c883e2bf))
* **store:** survive vanishing files, incomplete verdicts and a damaged index that looks current ([f5a3b95](https://github.com/niway-dev/wachiman/commit/f5a3b95bcba0f6a05952e6f4080725153e976a02))
* **store:** take the source signature before the replay and keep the old index until the rename ([feeffb7](https://github.com/niway-dev/wachiman/commit/feeffb78ddc0f745da1bfe7b22fadf8e7eb8efb9))

## [1.12.0](https://github.com/niway-dev/wachiman/compare/v1.11.0...v1.12.0) (2026-11-11)


### Features

* **ask:** answer line comments in their thread and let write collaborators ask, under a per-PR ceiling ([70e8d26](https://github.com/niway-dev/wachiman/commit/70e8d2686819fd83e3ebd97b3e440b080bf12eaa))
* **ask:** answer line comments in their thread and let write collaborators ask, under a per-PR ceiling ([8dfa09a](https://github.com/niway-dev/wachiman/commit/8dfa09ac5b4e74a4c475a4dfb2c967f291666eea)), closes [#170](https://github.com/niway-dev/wachiman/issues/170)
* **ask:** answer questions from the review that already ran, with checked references ([1e34ddb](https://github.com/niway-dev/wachiman/commit/1e34ddb3e979d4347d5d1dc2a9858cf5ac8cc677)), closes [#170](https://github.com/niway-dev/wachiman/issues/170)
* **cli:** wachiman ask answers questions about the local change ([2bf9332](https://github.com/niway-dev/wachiman/commit/2bf93327b93de7cabc53d2678641eaa0392ed871))
* **cli:** wachiman ask answers questions about the local change ([43f8fbd](https://github.com/niway-dev/wachiman/commit/43f8fbd3f7eefc55fdf802a0c19f7018146e2639)), closes [#170](https://github.com/niway-dev/wachiman/issues/170)
* **review:** carry a risk map in every review ([6d800ee](https://github.com/niway-dev/wachiman/commit/6d800ee044105cc0ded73c29527e4e58d62f36ca)), closes [#170](https://github.com/niway-dev/wachiman/issues/170)
* **risk:** compute a risk map from checked facts and path rules ([0e46d9b](https://github.com/niway-dev/wachiman/commit/0e46d9b60cc9e29a9e679a06ad9ed3d5248c8f87)), closes [#170](https://github.com/niway-dev/wachiman/issues/170)


### Bug Fixes

* **ask:** route new line comments, expose askers as workflow inputs, keep operator runs uncancelled ([63726e4](https://github.com/niway-dev/wachiman/commit/63726e4a6af6d282db58a2b1ddf422b50507d580)), closes [#170](https://github.com/niway-dev/wachiman/issues/170)
* **release:** pass the tarball to npm publish as a path ([622c502](https://github.com/niway-dev/wachiman/commit/622c50246aee8b15a6c1c16e0519c9cd835a357a))
* **release:** pass the tarball to npm publish as a path ([34bfaeb](https://github.com/niway-dev/wachiman/commit/34bfaeb14045378195f6d614f8eba0cfa7465bd5))

## [1.11.0](https://github.com/niway-dev/wachiman/compare/v1.10.1...v1.11.0) (2026-11-11)


### Features

* add wizard stages and restrained terminal styles ([3e828eb](https://github.com/niway-dev/wachiman/commit/3e828ebed1a1232c349501df05ebb8f8b5559476))
* **cli:** review staged and unstaged tracked changes ([0d14d73](https://github.com/niway-dev/wachiman/commit/0d14d7348d1f6c3b3072a9a2182a70cd8f06b702))
* **cli:** review tracked working-tree changes in isolated snapshots ([63caad4](https://github.com/niway-dev/wachiman/commit/63caad4ec05b80dce7054cc6a711024ffdc3bef6))
* continue init directly into account setup ([344d8da](https://github.com/niway-dev/wachiman/commit/344d8da338344bff6ca042a6ba3bc7d474b8d8b2))
* offer the current Claude session during setup ([60a4ed5](https://github.com/niway-dev/wachiman/commit/60a4ed5b48bffa4ec3633c1c5489726ce3f0cec5))
* wachiman status shows what local runs kept and cost, and the README presents the ways to run it ([ebcb9cf](https://github.com/niway-dev/wachiman/commit/ebcb9cf0868525f02fd6f9fe5b534f667c1e2b69))
* wachiman status shows what local runs kept and cost; README presents the ways to run it ([38c393f](https://github.com/niway-dev/wachiman/commit/38c393f12aa91a079c8e854bb07bf862099f2536))


### Bug Fixes

* **cli:** retain the existing input-selector diagnostic ([443a7ad](https://github.com/niway-dev/wachiman/commit/443a7ad55e6f0af7501d42bb2b7855baf6f545c7))
* escape PowerShell smart quotes in suggested commands ([f3e12eb](https://github.com/niway-dev/wachiman/commit/f3e12eb379fdb8968a1bdb57df9e90bb105e67f5))
* honor source Git mode settings in working-tree capture ([05b6148](https://github.com/niway-dev/wachiman/commit/05b61480550ce7590db7ba1da30627d062c9e0d6))
* ignore an empty NO_COLOR value ([ac87c2f](https://github.com/niway-dev/wachiman/commit/ac87c2f3a97eb6326e4982e33e5ab118be44e757))
* keep account context under its wizard stage ([848adba](https://github.com/niway-dev/wachiman/commit/848adba8a192d3766e6a4b4865ee9c0fe11c3fe2))
* keep redirected wizard prompts free of cursor escapes ([32030ee](https://github.com/niway-dev/wachiman/commit/32030ee89099b44c2cc4c15336c26948df4850dd))
* **local:** capture tracked leaf directories as deletions ([b1bef0c](https://github.com/niway-dev/wachiman/commit/b1bef0cee2ed959d96360c7e1449222296498528))
* **local:** index snapshot evidence without attribute conversions ([105e862](https://github.com/niway-dev/wachiman/commit/105e86202889f5de7e43a5b075521e7c4708b92b))
* **local:** preserve both patches for file type changes ([4a81e17](https://github.com/niway-dev/wachiman/commit/4a81e17ba6de9320499f9d9ed0220180b4828119))
* report account profiles, configured retention and distinct repositories in status ([87a5e67](https://github.com/niway-dev/wachiman/commit/87a5e676362dd31fb1f4faf580a7cde666e6a665))
* report setup readiness and quote suggested project commands ([6df12d4](https://github.com/niway-dev/wachiman/commit/6df12d4ed0611903e1e3c3a0511b51d1204c9396))
* seed temporary index from captured bytes ([47b0d91](https://github.com/niway-dev/wachiman/commit/47b0d911b8e89fbd56633a99c181e657a4be4d87))
* **setup:** show how to bind later when setup started from init ends unbound ([5a8a573](https://github.com/niway-dev/wachiman/commit/5a8a5737cb6302cbaa99a5207e23d5d9d3276c80))

## [1.10.1](https://github.com/niway-dev/wachiman/compare/v1.10.0...v1.10.1) (2026-11-10)


### Bug Fixes

* **review:** use Opus by default and make verification opt-in ([bc967db](https://github.com/niway-dev/wachiman/commit/bc967db0eac919b69d86475630189884dded5cf3))
* **review:** use Opus by default and make verification opt-in ([cef3442](https://github.com/niway-dev/wachiman/commit/cef34426db96db3ee0b91d7f9c2eb0ac9ad33e73))

## [1.10.0](https://github.com/niway-dev/wachiman/compare/v1.9.0...v1.10.0) (2026-11-09)


### ⚠ BREAKING CHANGES

* **review:** Haiku 5.5 high is the default reviewer and the verifier is on by default

### Features

* **accounts:** confirm a profile before the first model call ([c5466dc](https://github.com/niway-dev/wachiman/commit/c5466dc6639b2a6b64c05eec612e1ac12ed140b4))
* **accounts:** profile list, create, add, login, remove and default ([22ef9a6](https://github.com/niway-dev/wachiman/commit/22ef9a66a436a6a952ccc6d5b7dee1a51f660664))
* **accounts:** project show and unbind, and setup --profile ([d427a22](https://github.com/niway-dev/wachiman/commit/d427a2296c7838bfad9fa5816687795c7d8b36e2))
* **accounts:** resolve the account by flag, binding, environment and default ([5c3fec9](https://github.com/niway-dev/wachiman/commit/5c3fec99784eae527a613a216c60da389c5794b5))
* **accounts:** strict account config store with a locked atomic writer ([c064f83](https://github.com/niway-dev/wachiman/commit/c064f8360830c90f117fa42a8f40bfff7c0a518c))
* **cli:** a shared flag parser for the account and doctor commands ([1716292](https://github.com/niway-dev/wachiman/commit/17162927fafca3ebb76f66ace0b35667e2403d37))
* **cli:** dispatch init and the interactive setup, and exit 130 on cancellation ([b98dfa8](https://github.com/niway-dev/wachiman/commit/b98dfa8f3f8737c9f1a46b2577acdd8ba77b0537))
* **cli:** dispatch setup, doctor, profile and project ([7659a8e](https://github.com/niway-dev/wachiman/commit/7659a8e3b341562c85abba5ef4e673fa9f91eba3))
* **cli:** set up a repository in two guided commands, init for the workflow and a setup wizard ([9071f75](https://github.com/niway-dev/wachiman/commit/9071f758154ee232f4486aa1a9ab532dadd9d107))
* **doctor:** declared checks, text and JSON reports and path redaction ([fb6b22b](https://github.com/niway-dev/wachiman/commit/fb6b22b009abd084fb63dd2e3e44228d1e3f9a96))
* **formats:** result /2 types and schema, a pure downgrade to /1 and a reader for both ([b2033d5](https://github.com/niway-dev/wachiman/commit/b2033d55817a3333787be97a464aad24ad489d23))
* **init:** parse and resolve the init flags ([971bf90](https://github.com/niway-dev/wachiman/commit/971bf9098a1194fd334e8598634608c05bbe2b16))
* **init:** render the caller workflow from the template anchors ([4234ab1](https://github.com/niway-dev/wachiman/commit/4234ab13144e34fb9921917f8b5cd6325baf1500))
* **init:** write the caller workflow under confirm, with backups and link refusal ([ba05ea7](https://github.com/niway-dev/wachiman/commit/ba05ea7df4495fd1924c92ce64b1ccee9cc228d7))
* **launcher:** run the Bun that npm installs with the package, fall back to a validated Bun on PATH ([c283a3e](https://github.com/niway-dev/wachiman/commit/c283a3e336fc646e3e95bd6854a7d2888f6253c3))
* **local:** --no-verify, --result-version, the verify stderr line and a base snapshot for the verifier ([9e12a03](https://github.com/niway-dev/wachiman/commit/9e12a03a004efe68a5d142b7e8f18f467100180a))
* **local:** resolve and confirm the account before any model call ([e38abfc](https://github.com/niway-dev/wachiman/commit/e38abfc23e93836080bdd6620fe929981b74f62a))
* **package:** add the dependency-free Node launcher and its argv builder ([1148847](https://github.com/niway-dev/wachiman/commit/11488479220aabfd583bc6749db8ea89589f2996))
* **package:** detect the install layout and read assets from source or npm ([0dd49bf](https://github.com/niway-dev/wachiman/commit/0dd49bf87f9bf3b33135ec9a07aa81b47fd54511))
* **package:** install Wachiman with npm i -g wachiman, proven on the exact tarball users get ([d96a10d](https://github.com/niway-dev/wachiman/commit/d96a10d5271d290ede25b9baf4f62f7f7a132444))
* **package:** npm installs Bun with wachiman; drop the Windows executable ([cb38225](https://github.com/niway-dev/wachiman/commit/cb382254038af8609e7de1e75f1bd1a18a856870))
* **package:** publish as wachiman with the launcher as bin and test files left out ([0852087](https://github.com/niway-dev/wachiman/commit/0852087b26e22d8045f48d671ceb42d567bdb99a))
* **providers:** run an external profile's stored binary in the local mode ([6674454](https://github.com/niway-dev/wachiman/commit/6674454d85094b2132ff3176e9bcf73c4d7cace7))
* **review:** an opt-in verifier call that refutes findings before they are posted ([386e790](https://github.com/niway-dev/wachiman/commit/386e790cb4b315a288f1b0339132a441b85c9113)), closes [#137](https://github.com/niway-dev/wachiman/issues/137)
* **review:** Haiku 5.5 high is the default reviewer and the verifier is on by default ([42e3e3f](https://github.com/niway-dev/wachiman/commit/42e3e3f1ca18482b2f24d96368128433ff3d4fad))
* **review:** show whether each finding was verified and whether the PR introduced it ([4700db7](https://github.com/niway-dev/wachiman/commit/4700db7f69b6d6f517b4110cfa3b4259ca92a9ca))
* **setup:** the interactive wizard registers and binds in one confirmed save ([6dcdfe7](https://github.com/niway-dev/wachiman/commit/6dcdfe7b4f5cf44b9c87ff307f3e55e564b3d8ef))
* **sinks:** tier words, verification lines and Pre-existing and Inconclusive sections ([f008217](https://github.com/niway-dev/wachiman/commit/f008217ad689f5154da6068e4c8da22a5038e032))
* **skills:** choose the profile from project show and profile list ([e07acb3](https://github.com/niway-dev/wachiman/commit/e07acb3bfcc1d08060e7cb3a563cc24d25be269c))
* **skills:** command-line parser and runner for skills install|uninstall ([bbdc0b8](https://github.com/niway-dev/wachiman/commit/bbdc0b88c37a7d9bd6af18b8b5e78bf385f11279))
* **skills:** copy both skills into every skills directory with an ownership marker ([7f434bc](https://github.com/niway-dev/wachiman/commit/7f434bcf9c7a54f89ff4dbac38791e9cb1e8adf2))
* **skills:** install the agent skills from the package without touching a user's own copies ([807d368](https://github.com/niway-dev/wachiman/commit/807d368531163e9fce94d8b254bc98e12892ca10))
* **skills:** leave and warn about copies without a marker, replace only unmodified marked copies ([4efbffc](https://github.com/niway-dev/wachiman/commit/4efbffcbc298681bc4a7963ba6a6a49b78369de2))
* **skills:** refuse any target under the Wachiman home before writing anything ([16a4253](https://github.com/niway-dev/wachiman/commit/16a4253176e18369c44c616ca9390d30b92925f4))
* **skills:** wire skills install|uninstall into the CLI ([5bb6ee5](https://github.com/niway-dev/wachiman/commit/5bb6ee55fde14faa16b26a2db2670620a34a137e))
* **verify:** verdicts supported/refuted/inconclusive with origin, snapshot evidence and partial/failed status ([702e05d](https://github.com/niway-dev/wachiman/commit/702e05d5a8b4875b8f9330c47601f8fc582915ff))
* **wizard:** a prompt session can give the terminal to a child and take it back ([de40880](https://github.com/niway-dev/wachiman/commit/de4088015c41c1b1b9548797fddfc56a96b333bf))
* **wizard:** plain readline prompts with cancellation and the interactive check ([bb0c1a7](https://github.com/niway-dev/wachiman/commit/bb0c1a7632e1161c0d2e98433543665cbc7ecf7c))


### Bug Fixes

* **accounts:** a Wachiman home that is a dangling symlink is corrupt, not absent ([69d6629](https://github.com/niway-dev/wachiman/commit/69d66294b4381aa26b738f5dd2f8879c0c44762c))
* **accounts:** refuse only the dangling references a mutation introduces ([e86b07d](https://github.com/niway-dev/wachiman/commit/e86b07d5646aa6a81dea1721756aae6714a802df))
* **accounts:** refuse profile login when there is no terminal ([e801f44](https://github.com/niway-dev/wachiman/commit/e801f444e05672cecc9bd07c58c995728b25514b))
* **accounts:** treat a file in place of the home directory as an absent config ([3676ee6](https://github.com/niway-dev/wachiman/commit/3676ee65db5f8808dec064d879b8f93e3a2e797a))
* **accounts:** treat only a missing config.json as absent, not a broken link or unreadable file ([468f71c](https://github.com/niway-dev/wachiman/commit/468f71c371e816c3868d04fd32d3f68fa10ad9ff))
* **doctor:** redact known roots as literal prefixes so a space in the home does not leak ([8b05bc4](https://github.com/niway-dev/wachiman/commit/8b05bc47fb63d7e98af4334953257f20d7060a4b))
* **doctor:** skip the isolation row when the managed profile directory is missing ([d22c76c](https://github.com/niway-dev/wachiman/commit/d22c76c2d1566c7ad132fc10235a12ed4ad33f6c))
* **doctor:** state the isolation remediation once ([6485562](https://github.com/niway-dev/wachiman/commit/6485562333a8a94d2aff215f6f922edf773061b7))
* **engine:** a refused account still ends as a failed verification, and a test covers the default ([99d91e6](https://github.com/niway-dev/wachiman/commit/99d91e6b7d62edc2b967036528141b9919350680))
* **engine:** cut the unreviewed-files list before pre-existing findings that fit ([c34b22f](https://github.com/niway-dev/wachiman/commit/c34b22f7bc4c21182b8d26fae2501b2265f75699))
* **engine:** dedupeFindings keeps the type of the findings it is given ([c4453d5](https://github.com/niway-dev/wachiman/commit/c4453d5a16da0c07eb671ba80bc02f41dc2fb577))
* **engine:** keep the Pre-existing and Inconclusive lists within the review body limit ([c56e044](https://github.com/niway-dev/wachiman/commit/c56e044d5577d63b2f3062812fa76c00e04771b5))
* **engine:** release the base snapshot when the prompt or run directory fails ([27b9481](https://github.com/niway-dev/wachiman/commit/27b9481780c6837444820643e61ff5d110041014))
* **init:** bundle the published workflow ref so init works without --version ([d04acd2](https://github.com/niway-dev/wachiman/commit/d04acd2f1c475c4c4fa17ef39bf03741a8fbcaeb))
* **init:** refuse a --repo-dir with no work tree instead of writing inside .git ([4025f67](https://github.com/niway-dev/wachiman/commit/4025f67daab10441b90c11a8a60e496f726278ce))
* **init:** write the operator as a quoted YAML string ([cda7322](https://github.com/niway-dev/wachiman/commit/cda7322bacefd26ef810c9a768e49352d7ab0a45))
* **init:** write the workflow under the repository top level when run from a subdirectory ([742d71f](https://github.com/niway-dev/wachiman/commit/742d71ff8375ecfaf4dad36411f6241851db961e))
* **launcher:** a slow or failed Bun probe no longer reads as 'no Bun on PATH' ([959f797](https://github.com/niway-dev/wachiman/commit/959f79739e601261c9a4a7113cff6a0e55e8d776))
* **launcher:** never run a bun.exe from the reviewed repository, and keep LF in the snapshot ([189b330](https://github.com/niway-dev/wachiman/commit/189b330a7901a90d9b49b1a6572c53629f80dfff))
* **launcher:** resolve bun.exe from absolute PATH entries on Windows ([6e457c5](https://github.com/niway-dev/wachiman/commit/6e457c56ad0d5f35480fbbdb47a00dbce861d04b))
* **launcher:** say plainly when the bun package is missing, and do not call Windows supported before CI says so ([c8e212d](https://github.com/niway-dev/wachiman/commit/c8e212d810a202fad5d65d10c84be10b753789cb))
* **local:** the snapshot also keeps LF when text=auto meets core.eol=crlf ([62cf9fc](https://github.com/niway-dev/wachiman/commit/62cf9fceced08e6c065e208ba19905c4bccffdeb))
* **local:** the verifier uses the injected provider factory and the profile's binary ([69452e7](https://github.com/niway-dev/wachiman/commit/69452e78dc16c0627a1c4a128e7eded3755c3271))
* **package:** accept a relative --tarball in verify-package.sh, as the release workflow passes it ([8581dae](https://github.com/niway-dev/wachiman/commit/8581dae1969df0f599a54b4faae3571709d660f3))
* **package:** wait for the Bun child on Ctrl-C and forward SIGTERM and SIGHUP ([e79fc20](https://github.com/niway-dev/wachiman/commit/e79fc20e605c178c7b4be81b7a95d4275d2cc95b))
* **profiles:** leave the mode of an existing Wachiman home alone ([d78ab54](https://github.com/niway-dev/wachiman/commit/d78ab5420bdfc48e53a7d0230ba1cb705d255dfd))
* **profiles:** put each doc comment on its own function ([31b4821](https://github.com/niway-dev/wachiman/commit/31b4821aef1353f9993345108dad3b58e5ec48fc))
* **profiles:** re-check the name collision inside the config lock ([3b77a97](https://github.com/niway-dev/wachiman/commit/3b77a972e53751bf89ea165da376e333f0830fd3))
* **provider:** drop the no-op USER removal and correct its comment ([9d00e44](https://github.com/niway-dev/wachiman/commit/9d00e44318de8e1e0cb064cfd79e83e9a7e7f8fc))
* **setup:** hand the terminal back before the account probe so typed-ahead Enter is not read live ([bc00fee](https://github.com/niway-dev/wachiman/commit/bc00fee83573bde10ce9875e210f3234cb0451a7))
* **setup:** refuse the reserved name default before creating a managed profile ([45d06ec](https://github.com/niway-dev/wachiman/commit/45d06ec69bb8d179d117cede0b09b5aaa2703fb2))
* **setup:** report the created managed directory when the sign-in step throws ([4127484](https://github.com/niway-dev/wachiman/commit/412748433f9cabc9e49493609559aa28429c2a7f))
* **setup:** warn when the sign-in did not take after Sign in now ([c4dedcc](https://github.com/niway-dev/wachiman/commit/c4dedccad141e60eecd7a47294c67eaf2af987a8))
* **skill:** do not assume a lone registered profile is used by local ([0568eb0](https://github.com/niway-dev/wachiman/commit/0568eb051dddfaa5998a6c56fb05faa511fdf594))
* **skills:** an install that fails midway no longer leaves the copy unrecoverable ([e52f762](https://github.com/niway-dev/wachiman/commit/e52f76249558c6590079c63e1723cbe19d8f4ec2))
* **skills:** keep a replace install from overwriting a user file the old marker does not list ([36b256f](https://github.com/niway-dev/wachiman/commit/36b256fe975dc6090e807bd5cca1b79a64e4259a))
* **skills:** never write through a leftover symlink at the temporary file's name ([e675a7a](https://github.com/niway-dev/wachiman/commit/e675a7a9991d2f782ac62f08519a24bac8c391c3))
* **skills:** protect the default ~/.wachiman too, and ignore a malformed WACHIMAN_HOME ([507258b](https://github.com/niway-dev/wachiman/commit/507258b1572b3824d8cf1090a069bcc02f6a275c))
* **skills:** run every collision check for a copy before its first write ([4ac9bfa](https://github.com/niway-dev/wachiman/commit/4ac9bfab3c5c4fed947d2a619d87a6860c74932a))
* **verify:** a refutation's disproof must be a head line ([600a748](https://github.com/niway-dev/wachiman/commit/600a7480c322392bd594e393c56b3910b63b73f7))
* **verify:** escape model-written text in the verifier prompt ([35cc42e](https://github.com/niway-dev/wachiman/commit/35cc42e68547c5095178f0ed0e05258a5872e3e4))
* **verify:** escape the head snippet and attribute quotes in the verifier prompt ([31083bb](https://github.com/niway-dev/wachiman/commit/31083bbf178337b7ca6a45710e6013602e99f162))
* **verify:** findings the verifier turned into questions are deduplicated again ([821d6a9](https://github.com/niway-dev/wachiman/commit/821d6a91a427afe744acb8ac6cc5ddec07e3d185))
* **verify:** mark an unreached candidate with a boolean, not a reason prefix ([023e688](https://github.com/niway-dev/wachiman/commit/023e688f22c976d301c7c4a8df3073570517aca2))
* **verify:** the snippet reads only files inside the head and shows no line past the end of the file ([5d0925d](https://github.com/niway-dev/wachiman/commit/5d0925d047974e8fdeb096a79a00c488c0add1a6))
* **verify:** the verifier is not called after the provider refused a batch ([0f64120](https://github.com/niway-dev/wachiman/commit/0f6412016a00ef718f357656b24ac15bce792d7d))
* **verify:** use a verifier answer only when the whole envelope matches the schema ([9cf221d](https://github.com/niway-dev/wachiman/commit/9cf221d51f82617c506064f0a4158a9cabcdc0f4))
* **verify:** without its own adapter the record names the model and effort that ran ([1668ab4](https://github.com/niway-dev/wachiman/commit/1668ab4e294c13ea6d5cf09c6743d5c7dd0997b3))
* **windows:** drop case variants of CLAUDE_CONFIG_DIR and USER before setting them ([3c58872](https://github.com/niway-dev/wachiman/commit/3c58872a27d9204728da851b9414fdf57824fd06))
* **windows:** keep LF in the snapshot and in the shipped bin scripts ([b733a2b](https://github.com/niway-dev/wachiman/commit/b733a2b232c43b06bc7b004eb4a45b46715b70ec))
* **windows:** keep Path and the user-profile variables in the child environment, extract with the system tar ([a64217f](https://github.com/niway-dev/wachiman/commit/a64217f253c5d50a58c78881e7840bb68aabf035))
* **wizard:** let readline own the prompt on a terminal so Backspace keeps the question ([886262a](https://github.com/niway-dev/wachiman/commit/886262a25ed9ef95dac54a85ca7f84f5da0f8471))


### Code Refactoring

* **accounts:** share the profile name and directory checks and the setup summary with the wizard ([a9bddcb](https://github.com/niway-dev/wachiman/commit/a9bddcbcf5e29fe02634e0f066c203461be49c00))


### Miscellaneous Chores

* release as 1.10.0 ([901e182](https://github.com/niway-dev/wachiman/commit/901e1821c8c35f0bf1bbeb1a5fb9b47e715d414d))

## [1.9.0](https://github.com/niway-dev/wachiman/compare/v1.8.0...v1.9.0) (2026-11-07)


### Features

* **local:** a global wachiman command and a one-script install for the CLI and skill ([7ebf35f](https://github.com/niway-dev/wachiman/commit/7ebf35fdaf534bcbd331f6452a3ad3cbc33aad09))
* **local:** a global wachiman command and a one-script install for the CLI and skill ([95322fd](https://github.com/niway-dev/wachiman/commit/95322fdbbc72c910b4df2910526fefae91e6973a))
* **local:** review one commit, or from a commit forward ([d56996b](https://github.com/niway-dev/wachiman/commit/d56996ba38e8d360583643171fe9b65221292165))
* **local:** review one commit, or from a commit forward ([4fd06a5](https://github.com/niway-dev/wachiman/commit/4fd06a54ece4ebbaa673699c2bf4d4864f4ba805))
* one name, Wachiman, for the command, the CLI, the caller file and the focus file ([ecaa49c](https://github.com/niway-dev/wachiman/commit/ecaa49cf030c96cbec4163ea85e88f3ec7f0a382))
* one name, Wachiman, for the command, the CLI, the caller file and the focus file ([56a1090](https://github.com/niway-dev/wachiman/commit/56a10902dd865c82e5032987dc60865b71f2795d))
* **skills:** an agent skill that runs the local review ([e06f4ce](https://github.com/niway-dev/wachiman/commit/e06f4ceee673e6a4ed3e11dfaa1ae574675cdcec))
* **skills:** an agent skill that runs the local review for the developer ([8723405](https://github.com/niway-dev/wachiman/commit/87234053d56c9f4bb781c6f4374c5f3ec45e4920))
* **skills:** wachiman-audit, compare Wachiman with another reviewer on the same commits ([1ee3188](https://github.com/niway-dev/wachiman/commit/1ee31885ac926c388a6a8f8276b93f40ba0da44e))
* **skills:** wachiman-audit, the procedure to compare Wachiman with another reviewer ([6afbb28](https://github.com/niway-dev/wachiman/commit/6afbb28f3a4b5e4c46d0ff276460d1197ad1f0e2))


### Bug Fixes

* **formats:** the review-input Thread schema allows the optional wachi_replies the engine now sends ([89d6e97](https://github.com/niway-dev/wachiman/commit/89d6e97d6023e7578f0973700f412f26c10d7546))
* **history:** match a finding by its cited line across topic changes, and print this run's ids in JSON mode ([4c20ed4](https://github.com/niway-dev/wachiman/commit/4c20ed4092892f1e78710560b82294e92c2951c9))
* **history:** match a finding by its cited line across topic changes, and print this run's ids in JSON mode ([71aa7d3](https://github.com/niway-dev/wachiman/commit/71aa7d3fb78cdf0ab0aeb785aea3ad1a2b3a4523))
* **review:** a missing file is binary only when GitHub counted no lines, and a binary-only push skips the ceiling ([79eb122](https://github.com/niway-dev/wachiman/commit/79eb12278718cb016d78be57e4623018694cd383))
* **review:** binaries never block the incremental marker, answered threads are not re-answered, and every run shows its cost ([dc55910](https://github.com/niway-dev/wachiman/commit/dc55910689a6c8c26f14927bd13e231202774195))
* **review:** binaries never block the marker, answered threads stay quiet, every run shows its cost ([0f56b8d](https://github.com/niway-dev/wachiman/commit/0f56b8d401d4ac56aef406388f1c293b4589d879))

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
