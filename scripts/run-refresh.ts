import { setDefaultResultOrder } from 'node:dns';
import { getDb } from '@/db';
import { refreshWeek, todayChina } from '@/lib/reits';

setDefaultResultOrder('ipv4first');

const trigger = process.argv.includes('--manual') ? 'manual' : 'scheduled';
const runId = trigger === 'manual' ? process.env.REFRESH_RUN_ID : undefined;

if (trigger === 'manual' && !runId) {
  console.error('手动抓取缺少 REFRESH_RUN_ID。');
  process.exitCode = 1;
} else {
  try {
    const result = await refreshWeek(getDb(), todayChina(), {
      generateBriefs: true,
      forceGenerate: trigger === 'manual',
      trigger,
      runId,
    });
    console.log(result.message);
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '抓取任务执行失败。');
    process.exitCode = 1;
  }
}
