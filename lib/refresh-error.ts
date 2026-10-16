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

function databaseErrorKind(error: unknown) {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  let network = false;
  while (pending.length && visited.size < 20) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const value = current as {
      message?: unknown;
      name?: unknown;
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    const message = typeof value.message === 'string' ? value.message : '';
    const code = typeof value.code === 'string' ? value.code : '';
    if (/数据库尚未配置|url.*missing|invalid.*url/i.test(message)) return 'config';
    if (/unauthorized|authentication|HTTP 401|HTTP 403|permission denied/i.test(message)) return 'auth';
    if (/no such table|no such column|has no column|SQLITE_SCHEMA/i.test(message)) return 'schema';
    if (value.code === 'ENOTFOUND' || value.code === 'EAI_AGAIN') return value.code;
    if (
      ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code) ||
      value.name === 'TimeoutError' || /timeout|timed out/i.test(message)
    ) return 'timeout';
    if (
      ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET'].includes(code) ||
      /fetch failed|network|socket|HTTP 50[234]/i.test(message)
    ) network = true;
    if (value.cause) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
  return network ? 'network' : 'unknown';
}

export function isTransientDatabaseError(error: unknown) {
  return ['ENOTFOUND', 'EAI_AGAIN', 'timeout', 'network'].includes(databaseErrorKind(error));
}

export function describeCnbDatabaseError(error: unknown) {
  const kind = databaseErrorKind(error);
  if (kind === 'ENOTFOUND' || kind === 'EAI_AGAIN') return `CNB 无法解析数据库域名（${kind}）。`;
  if (kind === 'timeout') return 'CNB 连接数据库超时。';
  if (kind === 'network') return 'CNB 无法连接数据库（网络连接失败）。';
  if (kind === 'auth') return 'CNB 数据库认证失败，请由管理员检查抓取环境的连接权限。';
  if (kind === 'config') return 'CNB 数据库未配置或地址格式有误。';
  if (kind === 'schema') return 'CNB 所连接的数据库任务表尚未升级。';
  return 'CNB 数据库或任务初始化异常；未输出原始连接信息。';
}
