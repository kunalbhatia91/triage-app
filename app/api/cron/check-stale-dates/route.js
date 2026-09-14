import { listIssues, getIssue, addComment } from "../../../../lib/linear";
import { sections, oldestFirst } from "../../../../lib/comments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Zero-LLM by design. This is the actual answer to "how do mechanical
   checks run given every routine is a Claude session" — they don't run as
   a routine at all. This is plain scheduled code in the app itself,
   triggered by Vercel Cron (see vercel.json), doing nothing but date
   comparison. No model call, no token cost, however often it runs.

   It only ever marks a fact stale — it never rewrites CONTEXT, changes
   OPTIONS, or makes any judgment call. That stays 1B's job (the new third
   outcome in Step 2B) and Routine 2's job (checking a draft is still true
   before sending it, which already existed). This endpoint's only opinion
   is "has this specific timestamp passed" — arithmetic, not triage. */

function parseDatedFacts(comments) {
  // Same shape as parseOptions/parseDrafts in the magic route — oldest
  // first, sections() to split multi-marker comments, last write wins so a
  // superseded DATED FACTS block correctly replaces an earlier one rather
  // than accumulating duplicates.
  let facts = [];
  for (const c of oldestFirst(comments)) {
    for (const b of sections(c.body)) {
      if (/^DATED FACTS/i.test(b)) {
        facts = b
          .split("\n")
          .slice(1)
          .map((l) => l.trim())
          .map((l) => l.match(/^([0-9T:\-.Z]+)\s*\|\s*(.+)$/))
          .filter(Boolean)
          .map((m) => ({ at: m[1], label: m[2].trim() }));
      }
    }
  }
  return facts;
}

function alreadyFlaggedStale(comments, fact) {
  // Matching on label text alone was a real bug: if 1B rewrites DATED FACTS
  // with a new date after a reschedule but keeps the same descriptive label
  // ("Maria's proposed time"), an old stale-flag comment from before the
  // reschedule would wrongly count as already covering the new date too.
  // Match the specific timestamp as well, not just the label.
  return comments.some((c) => /^EVIDENCE/i.test(c.body) && c.body.includes(fact.label) && c.body.includes(fact.at) && /no longer/i.test(c.body));
}

export async function GET(req) {
  // Vercel Cron sends this header on real scheduled invocations. Reject
  // anything else so this can't be triggered by a stray request.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const all = await listIssues();
    // Only tickets where a stale date could actually matter for a live
    // decision — the same states Routine 2 already scans, not everything.
    const candidates = all.filter((i) => i.labels.includes("buddy-awaiting") || i.labels.includes("buddy-parked"));

    const now = new Date();
    let checked = 0;
    let flagged = 0;
    const results = [];

    for (const item of candidates) {
      checked++;
      const full = await getIssue(item.id);
      if (!full) continue;
      const facts = parseDatedFacts(full.comments);
      for (const fact of facts) {
        const when = new Date(fact.at);
        if (isNaN(when.getTime())) continue; // malformed timestamp — skip rather than guess
        if (when.getTime() < now.getTime() && !alreadyFlaggedStale(full.comments, fact)) {
          await addComment(
            item.id,
            `EVIDENCE — "${fact.label}" (${fact.at}) has passed and is no longer current. Flagged automatically, not by a routine — 1B or Kunal should confirm what actually happens next.`
          );
          flagged++;
          results.push({ issue: item.key, label: fact.label, at: fact.at });
        }
      }
    }

    return Response.json({ ok: true, checked, flagged, results, ranAt: now.toISOString() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
