import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createClient } from '@libsql/client';
import { createDbAdapter } from '../db/index.ts';
import { archiveCurrentWeek, listCurrentWeek, upsertRecord, type ReitsRecord } from '../lib/reits.ts';

const schema = readFileSync(new URL('../db/turso-init.sql', import.meta.url), 'utf8');
const record: ReitsRecord = {
  id: 'current-project', exchange: '上交所', fullName: '测试证券投资基金', shortName: '测试REIT',
  title: '测试REIT申报至上交所', status: '已申报', progressType: '申报', offeringType: '首发',
  updateDate: '2026-10-23', weekStart: '2026-10-19', weekEnd: '2026-10-25',
  brief: '10月23日，上交所网站显示，测试REIT项目状态为“已申报”。', files: [], sourceHtml: '',
};

void test('归档本周后重新抓取的同一记录恢复展示，更新正文且不产生重复记录', async () => {
  const client = createClient({ url: ':memory:' });
  const db = createDbAdapter(client);
  try {
    await client.executeMultiple(schema);
    await upsertRecord(db, record);
    assert.equal((await listCurrentWeek(db, '2026-10-25')).records.length, 1);
    assert.equal((await archiveCurrentWeek(db, '2026-10-25')).count, 1);
    assert.equal((await listCurrentWeek(db, '2026-10-25')).records.length, 0);

    const updated = { ...record, brief: `${record.brief}本次更新后的正文。` };
    await upsertRecord(db, updated);
    const visible = await listCurrentWeek(db, '2026-10-25');
    assert.equal(visible.records.length, 1);
    assert.equal(visible.records[0].id, record.id);
    assert.equal(visible.records[0].brief, updated.brief);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM projects').first())?.count, 1);
    assert.equal((await db.prepare('SELECT is_archived FROM projects WHERE id = ?').bind(record.id).first())?.is_archived, 0);
  } finally { client.close(); }
});

void test('重新抓取仅恢复写入项目，保留原归档快照和未重新写入的历史归档状态', async () => {
  const client = createClient({ url: ':memory:' });
  const db = createDbAdapter(client);
  try {
    await client.executeMultiple(schema);
    await upsertRecord(db, { ...record, id: 'old-project', updateDate: '2026-10-16', weekStart: '2026-10-12', weekEnd: '2026-10-18' });
    await archiveCurrentWeek(db, '2026-10-18');
    await upsertRecord(db, record);
    await upsertRecord(db, { ...record, id: 'not-refreshed' });
    await archiveCurrentWeek(db, '2026-10-25');
    const snapshots = (await db.prepare('SELECT * FROM weekly_archives ORDER BY id').all()).results;

    await upsertRecord(db, record);
    assert.deepEqual((await listCurrentWeek(db, '2026-10-25')).records.map(item => item.id), [record.id]);
    for (const id of ['old-project', 'not-refreshed'])
      assert.equal((await db.prepare('SELECT is_archived FROM projects WHERE id = ?').bind(id).first())?.is_archived, 1);
    assert.deepEqual((await db.prepare('SELECT * FROM weekly_archives ORDER BY id').all()).results, snapshots);
    assert.equal(JSON.parse(String(snapshots[1].snapshot_json)).length, 2);
  } finally { client.close(); }
});
