# Engineering principles

Wachiman aims to help people integrate code with more confidence. Reviews are one contribution
to that goal, alongside the project's tests, human decisions and release practices. A clean
review is not proof that a change is safe.

These pages explain the reasoning consumers can use to assess the reviewer. They are not a
roadmap, a new configuration schema, or a claim that Wachiman implements every practice cited.

## Read in order

- [Principles](principles.md): what should guide the engine and how to challenge it.
- [Sources](sources.md): external ideas, our interpretation and their limits.
- [Evidence and testing](evidence-and-testing.md): artifacts that make a claim checkable.
- [Repository review memory](repository-review-memory.md): the intended separation of review
  knowledge from general agent instructions, and its current implementation boundary.
- [Command identity](command-identity.md): the agreed brand and a proposed compatible CLI shortcut.

## How an outside idea becomes a Wachiman change

1. Record the original source, date checked, relevant section and the problem it addresses.
2. Describe the proposed application and why its context resembles ours. Separate the author's
   results from our hypothesis; their success is not our benchmark.
3. Identify a failure case and a way to measure both benefit and harm.
4. Test the smallest useful version against a baseline. Preserve the input version and outputs.
5. Adopt, revise or reject it through the normal design and review process. Link the resulting
   decision and implementation rather than silently turning this page into a specification.

For a public repository example, retain a commit permalink and the relevant test or workflow,
not just a star count or a link to its moving default branch. Public availability does not remove
license obligations. Do not copy private findings or credentials into public evidence.

## Status and maintenance

The baseline checked for this collection was `bda91758e11b2a2d3602442c9e3b2d5c5bb7e58d`
(2026-11-17). Implementation links describe that baseline; check the current code before making
a capability claim. Mark proposals explicitly. Revisit a principle when an evaluation or incident
contradicts its expected benefit, and preserve the reason for changing it.

Existing [architecture decisions](../architecture.md), [review policy](../review-policy.md) and
[security limits](../../SECURITY.md) remain the references for actual behavior and trust.
