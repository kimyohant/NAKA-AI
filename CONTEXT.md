# NAKA Drama Studio

An all-in-one production tool for AI short dramas, with seller tools around it. This glossary fixes the words we use so code, tickets, and conversation mean the same thing.

## Language

### Social Auto Reply

**Platform**:
A social network whose comments we read and reply to: Facebook or TikTok.
_Avoid_: Channel, provider, network

**Social Account**:
One connected Facebook Page or one connected TikTok account. It is the identity that owns the Posts and writes the Replies, not the person who logged in to connect it.
_Avoid_: User, page, profile, channel

**Connect**:
To log in to a Platform and give us permission to act as a Social Account. One login can connect several Social Accounts (one per Facebook Page).
_Avoid_: Link, authorize, add account

**Reconnect needed**:
The state of a Social Account whose permission expired or was taken away. We stop reading its Comments and sending its Replies until someone Connects it again.
_Avoid_: Expired, broken, invalid

**Disconnected**:
The state of a Social Account the user removed. Its permission is gone, but its Comments and Replies stay as history.
_Avoid_: Deleted, removed

**Post**:
A Facebook post or a TikTok video published by a Social Account. One word for both.
_Avoid_: Video, content, feed item

**Comment**:
A message a viewer left on a Post. Live-stream comments are not Comments in this sense.
_Avoid_: Message, mention

**Reply**:
Our answer to a Comment, published as the Social Account.
_Avoid_: Response, answer

**Draft**:
A Reply we wrote but did not publish yet. It waits for a person to approve it.
_Avoid_: Suggestion, pending reply

**Reply Mode**:
How a Social Account publishes its Replies. In **Draft mode** a person approves every Reply. In **Auto mode** we publish by ourselves when the Verdict is `reply`.
_Avoid_: Autopilot, manual mode, approval setting

**Watching**:
A Social Account whose switch is on: we read its Comments, judge them, and publish in Auto mode. When it is off, only actions a person takes still work.
_Avoid_: Active, enabled, monitoring

**Polling round**:
One pass over every Watching Social Account: we read new Comments, judge them, and publish Queued Replies. Rounds repeat on a fixed interval.
_Avoid_: Sync, cron job, tick, refresh

**Paused**:
A Social Account the Platform told us to slow down on. Polling rounds skip it until a set time, then it continues by itself. It is not Reconnect needed: nobody has to do anything.
_Avoid_: Throttled, blocked, rate limited

**Queued**:
The state of a Comment that has a Reply we will publish by ourselves. It never waits for a person.
_Avoid_: Pending, scheduled, retrying

**Replied**:
The state of a Comment whose Reply we published on the Platform. A Comment answered outside our app is Skipped, not Replied.
_Avoid_: Sent, done, answered

**Verdict**:
What we decide to do with one Comment: `reply`, `skip`, `human`, or `unsure`. Every Comment gets exactly one Verdict before anything is published.
_Avoid_: Classification, category, decision

**Skipped**:
The state of a Comment we decided not to answer. A person can still see it and bring it back.
_Avoid_: Ignored, filtered, hidden

**Needs human**:
The state of a Comment a person must answer themselves: a complaint or sensitive topic, a Comment we are unsure about, or one we could not judge at all. We never publish a Reply to it automatically.
_Avoid_: Escalated, flagged, manual

**Brand Profile**:
What a Social Account tells us about itself so we can write its Replies: who it is, how it talks, the facts it may state, and the topics it never talks about. One per Social Account.
_Avoid_: Persona, shop settings, prompt

**Fallback Reply**:
A Reply to a question whose answer is not in the Brand Profile. It states no facts and invites the viewer to message the Social Account.
_Avoid_: Default reply, canned reply, handoff

**Verdict test set**:
The fixed list of Comments, each with the Verdict we expect, that an LLM must pass before we turn on Auto mode.
_Avoid_: Eval, benchmark, golden set

**Dangerous error**:
The LLM gives the Verdict `reply` to a Comment that should go to a person or be Skipped. It is the one mistake Auto mode would publish.
_Avoid_: False positive, miss
