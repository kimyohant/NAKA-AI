# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

Tracking moved here from GitHub Issues on 2026-10-08 (GitHub API rate limits). Issues created before that date stay on `kimyohant/naka-drama-studio` as history; do not create new ones there.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Implementation issues start with YAML frontmatter, which is what the delegators (`/opencode-delegation:delegate` and the like) read: `id` (the file number), `status` (`open` / `closed`), `labels` (one triage label, see `triage-labels.md`), `assignee` (`null` until an agent takes it), `blocked_by` (a list of ids in the same feature)
- The spec and wayfinder files have no frontmatter; they record triage state as a `Status:` line near the top
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
