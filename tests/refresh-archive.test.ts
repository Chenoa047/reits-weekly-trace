import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import test from 'node:test';
import { createClient } from '@libsql/client';
import { createDbAdapter } from '../db/index.ts';
import { archiveCurrentWeek, listCurrentWeek, listWeeklyArchives, readWeeklyArchive, upsertRecord, type ReitsRecord } from '../lib/reits.ts';

const schema = readFileSync(new URL('../db/turso-init.sql', import.meta.url), 'utf8');
const record: ReitsRecord = {
  id: 'current-project', exchange: '上交所', fullName: '测试证券投资基金', shortName: '测试REIT',
  title: '测试REIT申报至上交所', status: '已申报', progressType: '申报', offeringType: '首发',
  updateDate: '2026-10-23', weekStart: '2026-10-19', weekEnd: '2026-10-25',
  brief: '10月23日，上交所网站显示，测试REIT项目状态为“已申报”。', files: [], sourceHtml: '',
};

void test('归档仅保存快照，首页保留简报；后续抓取不改写归档的正文和原文证据', async () => {
  const client = createClient({ url: ':memory:' });
  const db = createDbAdapter(client);
  try {
    await client.executeMultiple(schema);
    await upsertRecord(db, record);
    assert.equal((await listCurrentWeek(db, '2026-10-25')).records.length, 1);
    const saved = await archiveCurrentWeek(db, '2026-10-25');
    assert.equal(saved.count, 1);
    assert.equal((await listCurrentWeek(db, '2026-10-25')).records.length, 1);
    const snapshot = await readWeeklyArchive(db, saved.id);
    assert.equal(snapshot?.records[0].brief, record.brief);
    assert.deepEqual(snapshot?.records[0].files, record.files);

    const updated = { ...record, brief: `${record.brief}本次更新后的正文。` };
    await upsertRecord(db, updated);
    const visible = await listCurrentWeek(db, '2026-10-25');
    assert.equal(visible.records.length, 1);
    assert.equal(visible.records[0].id, record.id);
    assert.equal(visible.records[0].brief, updated.brief);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM projects').first())?.count, 1);
    assert.equal((await db.prepare('SELECT is_archived FROM projects WHERE id = ?').bind(record.id).first())?.is_archived, 0);
    assert.deepEqual(await readWeeklyArchive(db, saved.id), snapshot);
  } finally { client.close(); }
});

void test('历史从2026-10-19固定起算，以前周报不可查，之后跨周累积且首页不受旧标记影响', async () => {
  const client = createClient({ url: ':memory:' });
  const db = createDbAdapter(client);
  try {
    await client.executeMultiple(schema);
    await upsertRecord(db, { ...record, id: 'old-project', updateDate: '2026-10-16', weekStart: '2026-10-12', weekEnd: '2026-10-18' });
    const old = await archiveCurrentWeek(db, '2026-10-18');
    const oldSnapshot = await db.prepare('SELECT snapshot_json FROM weekly_archives WHERE id = ?').bind(old.id).first();
    await upsertRecord(db, record);
    await upsertRecord(db, { ...record, id: 'not-refreshed' });
    const current = await archiveCurrentWeek(db, '2026-10-25');
    await db.prepare('UPDATE projects SET is_archived = 1 WHERE week_start = ?').bind(record.weekStart).run();
    assert.equal((await listCurrentWeek(db, '2026-10-25')).records.length, 2);
    await upsertRecord(db, { ...record, id: 'next-week', updateDate: '2026-10-30', weekStart: '2026-10-26', weekEnd: '2026-11-01' });
    const next = await archiveCurrentWeek(db, '2026-11-01');
    assert.deepEqual(await listWeeklyArchives(db), [
      { ...next, weekStart: '2026-10-26', weekEnd: '2026-11-01', archivedAt: (await readWeeklyArchive(db, next.id))!.archivedAt },
      { ...current, weekStart: '2026-10-19', weekEnd: '2026-10-25', archivedAt: (await readWeeklyArchive(db, current.id))!.archivedAt },
    ]);
    assert.equal(await readWeeklyArchive(db, old.id), null);
    assert.deepEqual(await db.prepare('SELECT snapshot_json FROM weekly_archives WHERE id = ?').bind(old.id).first(), oldSnapshot);
    assert.equal(await readWeeklyArchive(db, '2026-09-07_2026-09-13'), null);
  } finally { client.close(); }
});

void test('同周跨日归档更新同一份快照，兼容旧归档编号，不重复且保留文件及引用', async () => {
  const client = createClient({ url: ':memory:' });
  const db = createDbAdapter(client);
  try {
    await client.executeMultiple(schema);
    const legacyId = '2026-10-19_2026-10-23';
    await db.prepare('INSERT INTO weekly_archives (id, week_start, week_end, archived_at, snapshot_json) VALUES (?, ?, ?, ?, ?)')
      .bind(legacyId, '2026-10-19', '2026-10-23', '2026-10-23T01:00:00Z', JSON.stringify([record])).run();
    const updated = { ...record, brief: `${record.brief}已更新。`, files: [{ label: '原文件', kind: '招募说明书' as const, originalTitle: '说明书.pdf', url: 'https://example.com/source.pdf' }], evidence: [{ fileUrl: 'https://example.com/source.pdf', page: 10, quote: '原文数据', claim: '已更新' }] };
    await upsertRecord(db, updated);
    assert.equal((await archiveCurrentWeek(db, '2026-10-25')).id, legacyId);
    const archive = await readWeeklyArchive(db, legacyId);
    assert.equal(archive?.weekEnd, '2026-10-25');
    assert.equal(archive?.records[0].brief, updated.brief);
    assert.deepEqual(archive?.records[0].files, updated.files);
    assert.deepEqual(archive?.records[0].evidence, updated.evidence);
    assert.equal((await listWeeklyArchives(db)).length, 1);
  } finally { client.close(); }
});

void test('新归档同周多次保存沿用编号，空周拒绝归档且不清空历史', async () => {
  const client = createClient({ url: ':memory:' });
  const db = createDbAdapter(client);
  try {
    await client.executeMultiple(schema);
    assert.deepEqual(await listWeeklyArchives(db), []);
    await assert.rejects(archiveCurrentWeek(db, '2026-10-25'), /empty_archive/);
    await upsertRecord(db, record);
    const first = await archiveCurrentWeek(db, '2026-10-23');
    const last = await archiveCurrentWeek(db, '2026-10-25');
    assert.equal(first.id, last.id);
    assert.equal((await listWeeklyArchives(db)).length, 1);
    const snapshot = await readWeeklyArchive(db, last.id);
    await db.prepare('UPDATE projects SET update_date = ? WHERE id = ?').bind('2026-10-16', record.id).run();
    await assert.rejects(archiveCurrentWeek(db, '2026-10-25'), /empty_archive/);
    assert.deepEqual(await readWeeklyArchive(db, last.id), snapshot);
  } finally { client.close(); }
});

void test('历史接口无需登录可读，保存仍须管理员；无效编号和缺失归档返回明确错误', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { getDb } from ${JSON.stringify(new URL('../db/index.ts', import.meta.url).href)};
    import { todayChina, weekRangeFor, upsertRecord, listCurrentWeek } from ${JSON.stringify(new URL('../lib/reits.ts', import.meta.url).href)};
    import { GET } from ${JSON.stringify(new URL('../app/api/archives/route.ts', import.meta.url).href)};
    import { POST } from ${JSON.stringify(new URL('../app/api/admin/archive/route.ts', import.meta.url).href)};
    const db = getDb();
    for (const statement of ${JSON.stringify(schema)}.split(';').filter(text => text.trim())) await db.prepare(statement).run();
    const request = (id = '') => new Request('https://example.com/api/archives' + id);
    assert.equal((await GET(request('?id=invalid'))).status, 400);
    assert.equal((await GET(request('?id=2000-01-03_2000-01-09'))).status, 404);
    assert.deepEqual(await (await GET(request())).json(), { archives: [] });
    await db.prepare('INSERT INTO weekly_archives (id, week_start, week_end, archived_at, snapshot_json) VALUES (?, ?, ?, ?, ?)')
      .bind('2026-10-12_2026-10-18', '2026-10-12', '2026-10-18', '2026-10-25T01:00:00Z', JSON.stringify([${JSON.stringify(record)}])).run();
    assert.deepEqual(await (await GET(request())).json(), { archives: [] });
    assert.equal((await GET(request('?id=2026-10-12_2026-10-18'))).status, 404);
    assert.equal((await POST(new Request('https://example.com/api/admin/archive', { method: 'POST' }))).status, 401);
    const date = todayChina(), range = weekRangeFor(date);
    await upsertRecord(db, { ...${JSON.stringify(record)}, updateDate: date, weekStart: range.start, weekEnd: range.end });
    const response = await POST(new Request('https://example.com/api/admin/archive', { method: 'POST', headers: { 'x-admin-password': 'test-placeholder' } }));
    assert.equal(response.status, 200);
    const saved = await response.json();
    const catalog = await (await GET(request())).json();
    assert.equal(catalog.archives.length, 1);
    assert.equal(catalog.archives[0].id, saved.id);
    assert.equal(catalog.archives[0].records, undefined);
    const detail = await (await GET(request('?id=' + saved.id))).json();
    assert.equal(detail.archive.records[0].brief, ${JSON.stringify(record.brief)});
    assert.equal((await listCurrentWeek(db, date)).records.length, 1);
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', TURSO_DATABASE_URL: ':memory:', ADMIN_PASSWORD: 'test-placeholder' }, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
});
