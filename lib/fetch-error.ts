export function describeFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const status = message.match(/(?:返回|HTTP)\s*(\d{3})/)?.[1];
  if (status) return `HTTP ${status}`;
  const networkCode = findNetworkErrorCode(error);
  if (
    networkCode === 'ETIMEDOUT' ||
    networkCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    /timeout|timed out|aborted/i.test(message)
  ) {
    return networkCode ? `连接超时（${networkCode}）` : '连接超时';
  }
  if (/json|unexpected token|返回格式/i.test(message)) return '返回格式异常';
  if (/fetch failed|network|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message))
    return networkCode ? `网络连接失败（${networkCode}）` : '网络连接失败';
  return message.slice(0, 80) || '未知网络错误';
}

function findNetworkErrorCode(error: unknown): string | undefined {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  while (pending.length) {
    const current = pending.shift();
    if (!current || (typeof current !== 'object' && typeof current !== 'function'))
      continue;
    if (visited.has(current)) continue;
    visited.add(current);
    const value = current as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (
      typeof value.code === 'string' &&
      /^(?:E[A-Z0-9_]+|UND_ERR_[A-Z0-9_]+)$/.test(value.code)
    ) {
      return value.code;
    }
    if (value.cause) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
  return undefined;
}
