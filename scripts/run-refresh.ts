import { setDefaultResultOrder } from 'node:dns';
import { getDb, type AppDb } from '@/db';
import { refreshWeek, todayChina } from '@/lib/reits';
import { checkDatabaseConnection } from '@/lib/database-network';
import { describeCnbDatabaseError } from '@/lib/refresh-error';
import { failQueuedRefreshRun } from '@/lib/refresh-runs';

setDefaultResultOrder('ipv4first');

const trigger = process.argv.includes('--manual') ? 'manual' : 'scheduled';
const runId = trigger === 'manual' ? process.env.REFRESH_RUN_ID : undefined;

if (trigger === 'manual' && !runId) {
  console.error('手动抓取缺少 REFRESH_RUN_ID。');
  process.exitCode = 1;
} else {
  let db: AppDb | undefined;
  try {
    db = getDb();
    await checkDatabaseConnection(db, (message) => console.log(message));
    const result = await refreshWeek(db, todayChina(), {
      generateBriefs: true,
      forceGenerate: trigger === 'manual',
      trigger,
      runId,
    });
    console.log(result.message);
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) {
    const message = `抓取程序异常退出：${describeCnbDatabaseError(error)}`;
    console.error(message);
    if (db && runId) {
      try {
        await failQueuedRefreshRun(db, runId, message);
      } catch {
        console.error('CNB 未能把失败状态写回数据库。网站会在提交十五分钟后将本任务标记为启动确认超时。');
      }
    }
    process.exitCode = 1;
  }
}
