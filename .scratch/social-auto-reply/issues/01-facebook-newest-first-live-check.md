---
id: 1
status: closed
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

## Notes

### 2026-10-08

- Facebook test page is `Naka AI` (https://www.facebook.com/profile.php?id=61595342064516)
- Run with `backend/scripts/fb-comment-order-check.mjs`, Graph API `v26.0`, a Page token (`debug_token` type `PAGE`). The token has `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`; none missing.
- **Newest first: yes.** `GET /{pageId}_{postId}/comments?order=reverse_chronological` returned strictly newest first. Without `order` the order is MIXED (not by time), so the adapter must always send `order`. `order=chronological` gives oldest first.
- **Nested replies**: add `filter=stream`. It returns top-level Comments and nested replies in one newest-first list. `filter=toplevel` returns top-level only.
- **Author id**: every Comment carries `from.id`. A Comment written as the Page has `from.id` equal to the `GET /me` id (`1445499388647091`), NOT the id in the Page URL (`61595342064516`). `isOwn` must compare with the `/me` id, so the adapter stores that id at connect time.
- **Parent id**: `parent{id}` appears only with `filter=stream`; top-level Comments have none. It is the direct parent, so a reply to a reply points at the earlier reply.
- **Other**: the post id must be `{pageId}_{postId}` (a bare post id fails with `#12`); a User token fails with `#200 Missing Permissions`, a Page token is required.
- **Not tested**: `since` (all Comments were inside the window, so no proof either way), and whether the page-2 cursor stays consistent while new Comments arrive.
- **Decision: the Facebook adapter takes the "newest first" path**, with `order=reverse_chronological&filter=stream`. The Polling round can stop paging at the first stored Comment.

## Acceptance criteria

- [x] A company test Facebook Page exists and its name is written in the Notes.
- [x] The three read permissions are confirmed on the Meta app, or the Notes say which one is missing.
- [x] The script only reads. It sends no Reply and writes nothing to the database.
- [x] The Notes answer: can Facebook return the newest Comments first? With which request parameters?
- [x] The Notes answer: does a Comment carry its author id (to compare with the Page id) and its parent id?
- [x] The Notes say which path the Facebook adapter takes: "newest first" or "keep the cursor of the last page it read".
- [x] No token is committed.
