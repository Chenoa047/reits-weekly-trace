export function describeRefreshDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/数据库尚未配置|url.*missing|invalid.*url/i.test(message))
    return '网站数据库未配置或地址格式有误，请检查当前运行环境的数据库配置。';
  if (/no such table|no such column|has no column|SQLITE_SCHEMA/i.test(message))
    return '数据库抓取任务表尚未完成升级，请确认当前网站连接的是已升级的数据库。';
  if (/unauthorized|authentication|HTTP 401|HTTP 403|permission denied/i.test(message))
    return '数据库认证失败，请检查当前运行环境的数据库连接权限。';
  if (/fetch failed|network|timeout|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message))
    return '网站暂时无法连接数据库，请稍后重试。';
  return '数据库无法创建或查询抓取任务，请检查数据库状态。';
}
