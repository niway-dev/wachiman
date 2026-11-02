# ADR 0013: Source available under FSL-1.1-ALv2, not AGPL

- **Status:** accepted by the owner on 2026-11-01. Implemented by the pull request that adds this
  record (`LICENSE`, `package.json`, README). Amends decision 8 of
  [ADR 0001](0001-distribution-and-trust.md).
- **Date:** 2026-11-01

## Context

Until this record, the license was the GNU Affero General Public License v3 (ADR 0001, decision 8).
The tool runs in the consumer's own GitHub Actions with the consumer's own key, and the owner wants
companies to use it freely, including inside the company. The AGPL allows that. It also allows a
third party to host a code-review service built from this code, owing only the source of its own
modifications, and some organizations forbid AGPL code outright.

What was true when this was decided:

- One copyright author. The only other commits are two Dependabot bumps of a workflow action.
- The engine has no runtime and no dev dependencies (ADR 0002), so no third-party license limits
  the choice.
- No outside contributions, forks or stars.
- Every release up to v1.3.0 shipped a `LICENSE` that said "version 3 … or any later version",
  while `package.json` said `AGPL-3.0-only`.

## Decision

1. **New versions are licensed under the Functional Source License, Version 1.1, ALv2 Future
   License (`FSL-1.1-ALv2`).** The text is the unmodified official template, with the licensor
   "Niway S.A.C." and the year 2026. `package.json` declares `FSL-1.1-ALv2`.
2. **Versions published before the license change stay under the AGPL.** That covers every release
   up to and including v1.3.0 and every commit before the commit that replaced `LICENSE`. Rights
   already granted cannot be withdrawn, and this record does not try to.
3. **Only a Competing Use needs a commercial license.** The license permits every purpose except
   making the software available to others in a commercial product or service that substitutes for
   it, substitutes for another NIWAY product or service using it that already existed when that
   version was made available, or offers the same or substantially
   similar functionality. Internal use, non-commercial education and research, and professional
   services to a licensee are Permitted Purposes. A commercial license is a separate agreement
   with NIWAY (Niway S.A.C.), requested at contact@niway.com and agreed case by case.
4. **Each version published under FSL-1.1-ALv2 becomes Apache 2.0 two years after it is made
   available.** This is the license's "Grant of Future License", applied per version, not per
   project.
5. **The project is called source available, never open source,** and copy names the license.
6. **Outside contributions require a contributor license agreement** in which the contributor keeps
   copyright and grants NIWAY the right to license the contribution on other terms. A DCO
   sign-off is not enough: it certifies submission under an open source license, which FSL is not,
   and it grants no right to relicense.
7. **`LICENSE` stays verbatim.** The licensing history is in the README, the changelog and this
   record, not in `LICENSE`.

## Alternatives rejected

- **Keep AGPL-3.0 and add a trademark policy.** A trademark protects the name, not the code: a
  competitor can run a hosted AGPL service under another name and owe only the source of its own
  modifications. The AGPL also keeps costing adopters whose policies exclude it.
- **AGPL with a commercial exception (dual license).** The same gap for anyone who complies with
  the AGPL, plus a sales process before there is demand.
- **PolyForm Noncommercial 1.0.0.** It forbids for-profit use, which includes a company running
  the tool in its own CI on its own repositories. That is the main audience, so it defeats the
  aim.
- **Business Source License 1.1.** Closest in intent, but a template: each licensor writes its own
  Additional Use Grant and picks a Change Date (up to four years), so every project reads
  differently. FSL fixes the grant and uses two years.
- **FSL-1.1-MIT.** The same terms with MIT as the future license. Apache-2.0 adds an express
  patent license, which is why `ALv2` was chosen.
- **Elastic License 2.0 or PolyForm Shield.** They restrict competing use but never convert to a
  permissive license, so the code never opens.
- **Closed source.** It gives up the reason the code is public: users hand the tool an API key and
  need to read what runs with it.

## Consequences

- **Not open source.** The Open Source Definition does not allow limits on competing use, so
  organizations that accept only OSI-approved licenses cannot adopt a version until it converts.
  Some developers will decline to contribute or will fork the last AGPL version.
- **Past versions stay forkable.** Anyone may keep using, modifying and forking releases up to
  v1.3.0 and earlier commits under the AGPL, including to run a hosted service if they publish
  their modifications. The change protects new work only.
- **The protection is two years per version.** After that, a competitor may offer that version
  commercially under Apache 2.0.
- **GitHub shows the license as "Other"** and some scanners may report it as unknown or non-OSI.
- **The license grants no trademark rights** beyond naming NIWAY as the origin. The name and mascot
  are not licensed for reuse; what others may do with the name is a separate matter from this
  license.
- **NIWAY must be able to license all the code.** That is why outside contributions need the
  agreement in decision 6.
- A dependency licensed under the AGPL, GPL or SSPL would conflict with this license; check each
  new dependency against it (today there are none).
- The release notes and every public page must say it plainly: "free to use" is always next to the
  competing-use limit, and past versions are named as AGPL.

## Non-goals

- Stopping companies from using it internally, a paid tier, feature gating, license keys, or
  telemetry for enforcement.
- A hosted service run by this project (see ADR 0001).
- Changing the terms of anything already published.
- A trademark policy, a price list or an enforcement program. None is decided here.
- Describing the project as open source.

## Reopen if

- Two organizations or contributors the project wants decline to adopt or contribute because the
  license is not OSI-approved, and say so in writing.
- A competing use appears and the license gives no practical remedy.
- Two years pass with no commercial license requested and no competing product: consider granting
  Apache 2.0 for all versions earlier, which also opens the project to OSI-only adopters.
- A lawyer's review finds the FSL text or the contributor agreement unsuitable for NIWAY's
  jurisdiction.
- The Functional Source License publishes a new version.

## Owner answers (2026-11-01)

The notice in `LICENSE` named "NIWAY" as the licensor, and the legal entity, the governing law of
the contributor agreement and the owner of the trademarks were not yet confirmed. The owner has
since answered:

- **Licensor and copyright holder:** Niway S.A.C., a company incorporated in Peru and based in
  Lima. `LICENSE` now reads "Copyright 2026 Niway S.A.C."; no other word of the license text
  changed. "NIWAY" remains the brand and short name.
- **Contributor agreement:** the party is NIWAY (Niway S.A.C.). It is governed by the laws of Peru,
  with the courts of Lima, Peru, as venue.
- **Trademarks:** owned by Niway S.A.C. and not registered.

These apply from the release after v1.3.0. Releases up to v1.3.0 keep the notice and the AGPL
they were published with. The contributor agreement is still not reviewed by a lawyer.

## References

- [Functional Source License](https://fsl.software/) and its FAQ.
- [SPDX entry FSL-1.1-ALv2](https://spdx.org/licenses/FSL-1.1-ALv2.html).
