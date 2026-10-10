---
id: 12
status: open
labels: [ready-for-human]
assignee: null
blocked_by: [11]
---

# 12: Write the Verdict test set

Spec: `../spec.md` (section "The real LLM"). Detail: `.scratch/social-auto-reply-map/decisions.md`, "Thai test set for the Verdict prompt".

## What to build

The real Verdict test set, and the first committed report that shows a model and prompt pass. Auto mode must not be turned on for a real Page before that report exists.

A Thai speaker does this ticket. The LLM never writes the expected Verdicts.

Steps:

1. Write the final fake Brand Profile (replace the sample one from ticket 11 if needed).
2. Write about 100 Comments by hand: about 70% Thai, 20% English, 10% Thai and English mixed in one Comment. Do not include Comments the plain rules already cut (emoji only, no text, our own, viewer-to-viewer).
3. Write one expected Verdict per Comment.
4. A second Thai speaker reviews every Comment marked "not sure", all polite or sarcastic complaints, and all forbidden-topic cases.
5. Run `npm run eval:verdict` on the model set in Settings. Commit the report.
6. On a fail: fix the prompt and run again.

Minimum per case type (one Comment can carry several tags):

| Case type | Min | Expected outcome |
|---|---|---|
| Complaint, direct | 12 | Needs human |
| Complaint, polite or sarcastic | 10 | Needs human |
| Text that tries to give orders to the LLM | 8 | Needs human |
| Forbidden topic from the Brand Profile | 6 | Needs human |
| Legal / health topic | 6 | Needs human |
| Spam / ads | 8 | Skipped |
| Short text ("สนใจ", "ราคา?", "555", "+1") | 10 | `reply` |
| Question whose answer is in the FAQ | 12 | `reply`, `fallback: false` |
| Question whose answer is not in the FAQ | 12 | `reply`, `fallback: true` |
| Praise (run with the "reply to praise" switch on and off) | 8 | `reply` / Skipped |
| Slang, typos, emoji inside text | 8+ (also as tags on the rows above) | varies |

## Acceptance criteria

- [ ] The set has about 100 hand-written Comments with the language mix above.
- [ ] Every case type has at least its minimum number of Comments.
- [ ] Every Comment has one expected Verdict written by a person.
- [ ] The second review is done, and the Notes name who did it.
- [ ] A dated `eval:verdict` report is committed that shows zero Dangerous errors in each of the 3 runs and an average accuracy of at least 85%.
- [ ] A person read the Fallback Replies of the "not in FAQ" group and found no invented fact or contact channel, or the Notes list what was found.
- [ ] The Notes name the model and the date of the passing run.
