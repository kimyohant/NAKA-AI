# Testing approach

Type: grilling

## Question

How do we test Social Auto Reply (Facebook only) without calling Facebook in every test? Decide:

- The fake `SocialPlatformAdapter`: what it can be told to do (return these Comments, fail with this `SocialPlatformError` kind, be slow), and where it is registered.
- The one end-to-end check: which path it walks (for example: fake Comment in, Polling round, Verdict, Draft, approve, `replied`), and whether the LLM in it is real or faked.
- Which pieces need unit tests by name. The plain rules of the comment filter are already on this list (see [Thai test set for the Verdict prompt](../decisions.md#thai-test-set-for-the-verdict-prompt)); the never-reply-twice guard and the backoff steps are candidates.
- The live-API check left open by [Polling schedule and rate limits](../decisions.md#polling-schedule-and-rate-limits): can Facebook return the newest Comments first? Decide who runs it, when, and against which Page, now that the Meta app exists.
- Where the tests live and how they run, following the existing `backend/tests/*.test.ts` files.
