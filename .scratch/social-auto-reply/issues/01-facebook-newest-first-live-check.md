---
id: 1
status: open
labels: [ready-for-human]
assignee: null
blocked_by: []
---

# 01: Facebook newest-first live check

Spec: `../spec.md` (sections "Facebook adapter" and "Live-API check").

## What to build

We do not know if the Facebook Graph API can return the newest Comments of a Post first. The Polling round stops paging at the first Comment it already stored, so it needs newest first. This ticket finds the answer on the real API, before the Facebook adapter is written.

A human does this ticket: it needs a real Facebook Page and a real Page token.

Steps:

1. Create a company test Facebook Page. The same Page is used later to try real Replies.
2. Check that `pages_show_list`, `pages_read_engagement`, and `pages_read_user_content` are added to the "Manage Pages" use case of the Meta app (only `pages_manage_engagement` was seen as "ready for testing").
3. Publish one Post on the test Page and add more Comments than fit in one page of results, including one nested reply and one Comment written as the Page.
4. Write a small read-only backend script that takes a Page token from an env var and lists the Comments of that Post. Try the comment stream with and without an order parameter, and with a `since` parameter.
5. Run it by hand, once. Write the result in this ticket under `## Notes`.

## Acceptance criteria

- [ ] A company test Facebook Page exists and its name is written in the Notes.
- [ ] The three read permissions are confirmed on the Meta app, or the Notes say which one is missing.
- [ ] The script only reads. It sends no Reply and writes nothing to the database.
- [ ] The Notes answer: can Facebook return the newest Comments first? With which request parameters?
- [ ] The Notes answer: does a Comment carry its author id (to compare with the Page id) and its parent id?
- [ ] The Notes say which path the Facebook adapter takes: "newest first" or "keep the cursor of the last page it read".
- [ ] No token is committed.
