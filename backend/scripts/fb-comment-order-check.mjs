// Read-only live check for ticket 01: can Graph API return newest Comments first?
// Usage: FB_PAGE_TOKEN=... node scripts/fb-comment-order-check.mjs <postId> [pageId]
// Only sends GET requests. No Reply, no DB. The token is never printed.
const token = process.env.FB_PAGE_TOKEN;
const [rawPostId, pageId] = process.argv.slice(2)
const postId = rawPostId && pageId && !rawPostId.includes('_') ? `${pageId}_${rawPostId}` : rawPostId;
const ver = process.env.FB_GRAPH_VERSION || "v26.0";
if (!token || !postId) {
  console.error(
    "Usage: FB_PAGE_TOKEN=... node scripts/fb-comment-order-check.mjs <postId> [pageId]",
  );
  process.exit(1);
}

const fields = "id,created_time,message,from{id,name},parent{id}";

async function get(label, params) {
  const qs = new URLSearchParams({
    fields,
    limit: "5",
    access_token: token,
    ...params,
  });
  const res = await fetch(
    `https://graph.facebook.com/${ver}/${postId}/comments?${qs}`,
  );
  const body = await res.json();
  console.log(
    `\n=== ${label} (HTTP ${res.status}) params=${JSON.stringify(params)}`,
  );
  if (body.error) {
    console.log("ERROR", JSON.stringify(body.error));
    return;
  }
  for (const c of body.data) {
    const own = pageId && c.from?.id === pageId ? " [OWN]" : "";
    console.log(
      c.created_time,
      c.id,
      "from=" + (c.from?.id ?? "none"),
      "parent=" + (c.parent?.id ?? "-") + own,
    );
  }
  const times = body.data.map((c) => Date.parse(c.created_time));
  const dir = times.every((t, i) => !i || t <= times[i - 1])
    ? "NEWEST-FIRST"
    : times.every((t, i) => !i || t >= times[i - 1])
      ? "OLDEST-FIRST"
      : "MIXED";
  console.log(
    "order on this page:",
    dir,
    "| next cursor:",
    body.paging?.cursors?.after ?? "none",
  );
}

const dbg = await (
  await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`)
).json();
console.log("token type:", dbg.data?.type, "| valid:", dbg.data?.is_valid, "| scopes:", dbg.data?.scopes, "| err:", dbg.error?.message);

await get("default", {});
await get("reverse_chronological", { order: "reverse_chronological" });
await get("chronological", { order: "chronological" });
await get("filter=toplevel + reverse", {
  filter: "toplevel",
  order: "reverse_chronological",
});
await get("filter=stream + reverse (includes nested)", {
  filter: "stream",
  order: "reverse_chronological",
});
// since = 1 hour ago; adjust by editing if all comments are older
await get("since=-1h", { since: String(Math.floor(Date.now() / 1000) - 3600) });
