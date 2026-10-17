// The collection switch: pausing stops the schedules and their alerts; a manual round and one source's
// "立即采集" still fetch. The switch is the operator's (settings, read at run time), so it needs no restart.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { autoCollectEnabled, collectRoundNow, collectionOverview, setAutoCollect, AUTOPILOT_KEY } from "@aihot/backend/sources/autopilot";

const T = tag();
const DUE = `test-autopilot-due-${T}`;
const FUTURE = `test-autopilot-future-${T}`;

after(async () => {
  await stopBoss();
  await closeDb();
});

async function sources() {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES
    (${DUE}, 'Due', 'rss', 'T1', 'editorial', now() - interval '5 minutes'),
    (${FUTURE}, 'Future', 'rss', 'T1', 'editorial', now() + interval '5 minutes')`;
}

test("pausing is recorded, read back as paused, and resumed again", async () => {
  await sources();
  assert.equal(await autoCollectEnabled(), true, "no switch set means collection runs");

  await setAutoCollect(false, "测试：暂停自动采集", "tester");
  assert.equal(await autoCollectEnabled(), false);
  assert.equal((await collectionOverview()).auto, false);
  const [off] = await sql<{ action: string; reason: string; after: { enabled: boolean } }[]>`
    SELECT action, reason, after FROM audit_log WHERE subject = ${`settings:${AUTOPILOT_KEY}`} ORDER BY id DESC`;
  assert.equal(off!.action, "collection.autopilot.off");
  assert.equal(off!.after.enabled, false);
  assert.match(off!.reason, /暂停/);

  await setAutoCollect(true, "测试：恢复", "tester");
  assert.equal(await autoCollectEnabled(), true);
});

test("a manual round fetches the due sources even while paused, and only those", async () => {
  await setAutoCollect(false, "测试：暂停", "tester");
  const before = await collectionOverview();
  assert.equal(before.due, 1, "one of the two sources is due");

  const round = await collectRoundNow("测试：手动跑一轮", "tester");
  assert.equal(round.enqueued, 1, "the due source was queued");

  // Queued sources are pushed ten minutes out, so a second round right away finds nothing to do.
  assert.equal((await collectionOverview()).due, 0);
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'sources.fetch' AND data->>'sourceId' = ${DUE}`;
  assert.equal(row!.n, 1, "one fetch job for the due source");
  const [future] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'sources.fetch' AND data->>'sourceId' = ${FUTURE}`;
  assert.equal(future!.n, 0, "a source that is not due gets no job");

  const [audit] = await sql<{ action: string }[]>`SELECT action FROM audit_log WHERE subject = ${`settings:${AUTOPILOT_KEY}`} AND action = 'collection.round'`;
  assert.equal(audit!.action, "collection.round", "the round is audited like any manual fetch");
});

test("pausing needs a reason", async () => {
  await assert.rejects(() => setAutoCollect(false, "  ", "tester"), /reason is required/);
  await setAutoCollect(true, "测试：收尾", "tester");
});
