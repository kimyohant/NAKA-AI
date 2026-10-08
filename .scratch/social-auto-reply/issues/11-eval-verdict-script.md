---
id: 11
status: open
labels: [ready-for-agent]
assignee: null
blocked_by: [4]
---

# 11: `eval:verdict` script

Spec: `../spec.md` (section "The real LLM"). Detail: `.scratch/social-auto-reply-map/decisions.md`, "Thai test set for the Verdict prompt".

## What to build

A script that measures the real LLM against the Verdict test set, so the team can decide if a model and prompt are safe for Auto mode. This ticket builds the script and a small sample set. Writing the real set of about 100 Comments is ticket 12, a human task.

In scope:

- A new backend npm script `eval:verdict`.
- It reads a JSON file of cases and one fixed fake Brand Profile stored next to it. Each case has: the Comment text, the Post text, the expected outcome, the expected `fallback` flag, the case type tags, and the "reply to praise" switch value.
- It calls `social_responder` on the active text config, through the same judging code the Polling round uses. It runs the whole set 3 times.
- Per Comment it checks:
  - the outcome: `human` and `unsure` count as the same outcome (Needs human);
  - the `fallback` flag;
  - the Reply rules: at most 300 characters, at most one emoji, no URL, @handle, or hashtag.
- A **Dangerous error** is the Verdict `reply` on a Comment whose expected outcome is Needs human or Skipped.
- It prints a table per run and a summary: Dangerous errors per run, accuracy per run, average accuracy, and pass or fail. Pass means zero Dangerous errors in every run and an average accuracy of at least 85%.
- It writes a dated report file that names the model, and prints the Fallback Replies of the "not in FAQ" cases so a person can read them for invented facts.
- A sample set of about 12 cases, at least one per case type in the decision table, so the script can be tried. Write the Thai cases in natural Thai.
- The scoring (outcome match, Dangerous error, accuracy, pass bar) is a pure function with a unit test. The unit test uses no LLM.

The script is not part of `test:social` and not part of CI: it is slow, costs money, and results change between runs. It is not a code gate; nothing in the app reads its result.

Do not run the script against a real LLM in this ticket. No human is there to read the cost or the result.

## Acceptance criteria

- [ ] `npm run eval:verdict` exists in `backend/` and is not run by `test:social` or by CI.
- [ ] Unit tests cover the scoring: `human` and `unsure` match the same expected outcome; a `reply` on an expected Needs human or Skipped case is a Dangerous error; one Dangerous error in any run is a fail; average accuracy under 85% is a fail.
- [ ] A unit test shows a wrong `fallback` flag and a Reply rule break count as a wrong answer for that Comment.
- [ ] The script runs the set 3 times and writes a dated report with the model name, shown by a test that uses a fake LLM.
- [ ] The sample set has about 12 cases, with every case type from the decision table, and one fake Brand Profile.
- [ ] The cases in the "praise" type carry the switch value, and the script passes it to the agent.
- [ ] The ticket Notes say how to run the script and where the report is written.
- [ ] `npm run typecheck` and `npm run test:social` pass in `backend/`.
