# Question bank

Pick from this list. Ask 2–4 questions per turn and target the weakest part of what you've
heard so far. Rephrase the questions in terms of the actual idea; don't read them out
verbatim.

## Problem and evidence

- Who exactly has this problem? Name a real customer or teammate if you can.
- What do they do today instead? Why isn't that good enough?
- How do we know it's real: did someone ask, did we see it in data, or is it a hunch?
- What happens if we never build this?
- (CM) Which customer, who at the customer, and what did they actually say? Is it blocking a
  deal or a renewal?

## User and journey

- Walk me through it step by step, from where the user starts to the moment it's solved.
- Who else sees or is affected by this: admins, Dwaar support, other tenants?
- Where in the product does the user start: portal, CLI, IDE, gateway?

## Scope

- If we could ship only one thing from this, what would it be? (That's the MVP.)
- For each MUST: if this slipped to the next release, would the idea still be worth shipping?
- What is this idea explicitly **not**? Give me two things someone might assume it includes.
- Is this one idea or two? (Look for "and also" in the answers.)
- Does it need to work for every customer, or only some (a plan tier, region or deployment
  type)?

## Definition of done and acceptance

- How would a tester, without asking you, know it works?
- What's the failure case? What should the user see when it goes wrong?
- Any numbers: latency, limits, how many items, retention period?
- What existing behaviour must **not** change?

## Dependencies and blockers

- What has to be true or built before this can start?
- Does it depend on another idea or a DEV ticket in flight? (Check: <keys found in Step 1>)
- Does it need anything outside our code: a vendor API, customer data, infra, legal or
  compliance sign-off?
- Which services or repos change: portal/server, dforge, dfence, cli, agent-factory, auth,
  infra?
- Does anything else in the backlog depend on this one?

## Risks (always ask about security)

- What data does this read, store or show? Could one tenant ever see another tenant's data?
- Does it handle secrets, credentials or customer prompts? Where do they go?
- Does it change what gets logged or audited?
- Cost: does it add LLM calls, storage or compute per request?
- Does it affect our SOC 2 / ISO posture?

## Success and release

- Thirty days after release, how will we know it worked?
- What do we need ready before we call it Released: changelog, docs, demo, customer email?
- Who needs to be told when it ships?

## Pushing back on vague answers

- "When you say <fast/easy/secure/simple>, what would a tester measure?"
- "Give me one concrete example."
- "Earlier you said <A>; this sounds like <B>. Which one wins?"
- "That's how to build it. What does the user need, so engineering can pick the how?"
