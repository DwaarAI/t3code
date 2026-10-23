# Idea ticket template

Use these headings in this order for every Idea in ID or CM. Write "None" rather than dropping
a section. An empty section is a signal the interview isn't finished.

**Summary** (the Jira title): `<Outcome for the user>`, in the user's language. No `[IDEA]` or
`ID-` prefix, because the project key already says that. Keep it to 70 characters or fewer.

- Good: `Customers can acknowledge false-positive findings in a run report`
- Bad: `Acknowledgement engine`, `Add ack table + API`

**Fields:** project `ID` (internal) or `CM` (customer) · issue type `Idea` · priority · area
labels (`portal`, `dforge`, `dfence`, `dflow`, `cli`, `agent-factory`, `infra`, `auth`;
`customer-feedback` for CM items from customers)

---

```markdown
## Problem

<2–4 sentences: who hurts, how, and what happens today without this.>

**Evidence:** <customer request / data / observed incident / internal hunch, and say which.>
**Source:** <Internal (name) | Customer: <org name>, <person/role>, <date>>

> Customer's words (CM only): "<verbatim quote or ticket text>"

## Users and journey

**Primary user:** <persona and role, e.g. "security engineer at a customer org building policies">
**Other affected:** <e.g. Dwaar support, org admins>

1. <step>
2. <step>
3. <step: the moment the problem is solved>

## Scope

### Bare minimum (MVP)

<The smallest shippable slice that is still worth releasing. 1–3 bullets.>

### MUST have

1. <testable requirement>
2. <testable requirement>

### GOOD to have (can follow later)

- <item>

### OUT of scope

- <item, with a reason if it isn't obvious>

## Definition of done

From the user's perspective: the idea is done when:

- [ ] <observable outcome that maps to MUST 1>
- [ ] <observable outcome that maps to MUST 2>
- [ ] Release material below is ready

## Acceptance scenarios

1. **<name>**: Given <state>, when <action>, then <observable result>.
2. **<name>**: Given …, when …, then …
3. **<failure/edge case>**: Given …, when …, then …

## Dependencies and blockers

| Needs                   | Why                      | Status                                       |
| ----------------------- | ------------------------ | -------------------------------------------- |
| <KEY or external thing> | <why it must come first> | <Done / In progress / Not started / Unknown> |

**Touches:** <services or repos: portal(server), dforge, dfence, cli, agent-factory, auth, infra>

## Risks

- **Security and privacy:** <data exposed? tenant isolation? secrets? or "none identified, because …">
- **Other:** <cost, performance, migration, compliance (SOC 2 / ISO)>

## Success measure

<How we'll know it worked after release: metric, customer confirmation, or usage signal.>

## Release material

- <changelog entry / docs page / demo / customer email>

## Open questions

- <unresolved item, with an owner if known>

## Notes for engineering (optional)

<Implementation hints the human gave. These aren't requirements; engineering decides the how.>

---

_Filed with the ideator skill · <date>_
```
