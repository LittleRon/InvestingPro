// Operator settings: about-page QR codes (replaced without a release), notification targets
// (switching a group on records enabled_at so older content is never back-filled) and per-service
// request budgets (the circuit breaker paid calls check before sending).
import type { AdminBudget, AdminNotifyTarget, AdminSettings, BeforeJson } from "@aihot/contracts/admin";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { loadContact, type ContactSettings } from "../site/contact.ts";
import { MODELS } from "../providers/llm.ts";
import { audit } from "../audit.ts";

const MAX_QR_BYTES = 2 * 1024 * 1024;

export async function replaceContactQr(input: { slot: keyof ContactSettings; data: Buffer }, actor: string) {
  if (input.slot !== "wechatQr" && input.slot !== "feishuQr") throw new Error("unknown slot");
  if (input.data.length > MAX_QR_BYTES) throw new Error("二维码图片最大 2MB");
  const meta = await sharp(input.data).metadata().catch(() => null);
  if (!meta || !["png", "jpeg", "webp"].includes(meta.format ?? "")) throw new Error("需要 PNG、JPG 或 WebP 图片");
  if ((meta.width ?? 0) < 120 || (meta.height ?? 0) < 120) throw new Error("图片太小，二维码可能扫不出来");
  const ext = meta.format === "jpeg" ? "jpg" : meta.format!;
  const name = `qr-${input.slot === "wechatQr" ? "wechat" : "feishu"}-${sha256(input.data).slice(0, 8)}.${ext}`;
  const dir = path.join(config.dataDir, "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), input.data);
  const before = await loadContact();
  const next = { ...before, [input.slot]: `/contact/${name}` };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('contact_qr', ${sql.json(next)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.contact_qr", "settings:contact_qr", null, { [input.slot]: before[input.slot] }, { [input.slot]: next[input.slot] });
  return next;
}

/** The settings page: contact QR codes, content push targets and paid-service budgets. */
export async function settingsOverview(): Promise<BeforeJson<AdminSettings>> {
  const [contact, targets, budgets] = await Promise.all([loadContact(), listTargets(), listBudgets()]);
  return { contact, targets, budgets };
}

export async function listTargets(): Promise<BeforeJson<AdminNotifyTarget>[]> {
  return sql<BeforeJson<AdminNotifyTarget>[]>`
    SELECT t.key, t.purpose, t.kind, t.enabled, t.enabled_at, t.config_ref, t.note, t.updated_at,
           (SELECT count(*)::int FROM deliveries d WHERE d.target_key = t.key AND d.created_at > now() - interval '7 days') AS deliveries_7d,
           (SELECT max(d.sent_at) FROM deliveries d WHERE d.target_key = t.key) AS last_sent_at
    FROM notify_targets t ORDER BY t.purpose, t.key`;
}

export async function setTargetEnabled(key: string, enabled: boolean, reason: string, actor: string) {
  if (!reason?.trim()) throw new Error("reason is required");
  const [before] = await sql`SELECT enabled, enabled_at FROM notify_targets WHERE key = ${key}`;
  if (!before) return null;
  const [after] = await sql`
    UPDATE notify_targets SET enabled = ${enabled}, enabled_at = CASE WHEN ${enabled} AND NOT enabled THEN now() ELSE enabled_at END, updated_at = now()
    WHERE key = ${key} RETURNING key, enabled, enabled_at`;
  await audit(actor, enabled ? "notify.enable" : "notify.disable", `notify-target:${key}`, reason, before, after);
  return { ...after, pushEnabledHere: config.feishuContentPushEnabled };
}

/**
 * 会花钱的外部服务。默认模型与站上配的每个具名预设各有自己的 service，
 * 加上读取网页、向量和抓取那几家。没有上限的服务也要列出来，否则页面上根本看不见它。
 */
export function budgetServices(): string[] {
  const names = new Set<string>(Object.values(MODELS).map((m) => m.service));
  for (const s of ["embedding", "jina", "dajiala", "socialdata"]) names.add(s);
  return [...names].sort();
}

async function usageOf(service: string): Promise<{ used_day: number; used_hour: number }> {
  const [row] = await sql<{ used_day: number; used_hour: number }[]>`
    SELECT
      count(*) FILTER (WHERE started_at > now() - interval '1 day')::int AS used_day,
      count(*) FILTER (WHERE started_at > now() - interval '1 hour')::int AS used_hour
    FROM receipt_attempts WHERE service = ${service} AND origin = 'live' AND started_at > now() - interval '1 day'`;
  return { used_day: row?.used_day ?? 0, used_hour: row?.used_hour ?? 0 };
}

export async function listBudgets(): Promise<BeforeJson<AdminBudget>[]> {
  const rows = await sql<BeforeJson<AdminBudget>[]>`
    SELECT b.service, b.per_minute, b.per_hour, b.per_day, b.note, b.updated_at,
           true AS configured,
           (SELECT count(*)::int FROM receipt_attempts a WHERE a.service = b.service AND a.origin = 'live' AND a.started_at > now() - interval '1 day') AS used_day,
           (SELECT count(*)::int FROM receipt_attempts a WHERE a.service = b.service AND a.origin = 'live' AND a.started_at > now() - interval '1 hour') AS used_hour
    FROM budgets b ORDER BY b.service`;
  const seen = new Set(rows.map((r) => r.service));
  // 没设过上限的服务照样列出来：它们在花钱，却在表格里缺一行，最容易漏掉。
  const missing: BeforeJson<AdminBudget>[] = [];
  for (const service of budgetServices()) {
    if (seen.has(service)) continue;
    missing.push({ service, per_minute: null, per_hour: null, per_day: null, note: null, updated_at: null, configured: false, ...(await usageOf(service)) });
  }
  return [...rows.filter((r) => r.configured), ...missing].sort((a, b) => (a.service < b.service ? -1 : 1));
}

/** 撤掉上限，让这个服务重新不受限。改回限额用它旁边的保存按钮。 */
export async function deleteBudget(service: string, reason: string, actor: string) {
  if (!reason?.trim()) throw new Error("reason is required");
  const [before] = await sql<{ per_minute: number; per_hour: number; per_day: number }[]>`
    DELETE FROM budgets WHERE service = ${service} RETURNING per_minute, per_hour, per_day`;
  if (!before) throw new Error("这个服务本来就没有上限");
  await audit(actor, "budget.delete", `budget:${service}`, reason, before, null);
  return { service };
}

export async function updateBudget(service: string, input: { perMinute: number; perHour: number; perDay: number; reason: string }, actor: string) {
  if (!input.reason?.trim()) throw new Error("reason is required");
  for (const v of [input.perMinute, input.perHour, input.perDay]) if (!Number.isInteger(v) || v < 0) throw new Error("budgets are non-negative integers (0 stops the service)");
  const [before] = await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = ${service}`;
  const [after] = await sql`
    INSERT INTO budgets (service, per_minute, per_hour, per_day, note) VALUES (${service}, ${input.perMinute}, ${input.perHour}, ${input.perDay}, ${input.reason})
    ON CONFLICT (service) DO UPDATE SET per_minute = EXCLUDED.per_minute, per_hour = EXCLUDED.per_hour, per_day = EXCLUDED.per_day, note = EXCLUDED.note, updated_at = now()
    RETURNING service, per_minute, per_hour, per_day`;
  await audit(actor, "budget.update", `budget:${service}`, input.reason, before ?? null, after);
  return after;
}
