type CnbTriggerResponse = {
  sn?: string;
  success?: boolean;
};

export async function triggerCnbManualRefresh(runId: string) {
  const token = process.env.CNB_API_TOKEN;
  const slug = process.env.CNB_REPO_SLUG;
  if (!token || !slug) throw new Error('CNB 手动触发尚未配置。');

  const repoPath = slug
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  if (!repoPath) throw new Error('CNB 仓库标识无效。');

  const response = await fetch(`https://api.cnb.cool/${repoPath}/-/build/start`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.cnb.api+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      event: 'api_trigger_manual_refresh',
      branch: 'main',
      sync: 'false',
      env: { REFRESH_RUN_ID: runId },
    }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`CNB 任务触发失败（HTTP ${response.status}）。`);

  const payload = (await response.json().catch(() => ({}))) as CnbTriggerResponse;
  if (payload.success === false || !payload.sn) throw new Error('CNB 已响应，但任务未成功进入队列。');
  return { buildId: payload.sn };
}
