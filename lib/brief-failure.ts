export class BriefQualityError extends Error {
  readonly inputTokens: number;
  readonly outputTokens: number;

  constructor(
    code: string,
    inputTokens: number,
    outputTokens: number,
  ) {
    super(code);
    this.name = 'BriefQualityError';
    this.inputTokens = inputTokens;
    this.outputTokens = outputTokens;
  }
}

export function preserveBriefUsage(
  error: unknown,
  inputTokens: number,
  outputTokens: number,
) {
  if (error instanceof BriefQualityError) return error;
  return new BriefQualityError(
    error instanceof Error ? error.message : 'brief_quality_error',
    inputTokens,
    outputTokens,
  );
}

export function briefFailureUsage(error: unknown) {
  return error instanceof BriefQualityError
    ? { inputTokens: error.inputTokens, outputTokens: error.outputTokens }
    : { inputTokens: 0, outputTokens: 0 };
}

export function describeBriefFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/缺少规定原文件/.test(message)) return '规定原文件缺失';
  if (/原文件下载失败/.test(message))
    return `原文件下载失败${message.includes('连接超时') ? '（连接超时）' : ''}`;
  if (/原文件|PDF/.test(message)) return 'PDF文字读取失败';
  if (/invalid_evidence_format/.test(message)) return '模型返回格式错误';
  if (/invalid_evidence_source|invalid_evidence_claim/.test(message))
    return '引用原文无法匹配';
  if (/missing_evidence|partial_evidence_claim/.test(message))
    return '逐句证据不完整';
  if (/evidence_number_mismatch|unsupported_number/.test(message))
    return '数字与原文不一致';
  if (/no_verified_detail/.test(message)) return '未生成可核验正文';
  if (/missing_reply_other_topics/.test(message)) return '回复简报遗漏其他回复事项';
  if (/invalid_opening|opening_contains_details/.test(message))
    return '首句格式不合格';
  if (/missing_expansion/.test(message)) return '扩募标识缺失';
  if (/invalid_length|invalid_format|invalid_meta_content|incomplete_sentence/.test(message))
    return '正文格式不合格';
  if (/incomplete_max_output_tokens/.test(message)) return '模型输出达到上限';
  if (/incomplete_content_filter/.test(message)) return '模型输出触发内容过滤';
  if (/incomplete_response/.test(message)) return '模型响应不完整';
  if (/timeout|provider_unavailable|rate_limited|request_failed/.test(message))
    return '简报服务暂时不可用';
  if (/not_configured|authentication_failed|insufficient_balance/.test(message))
    return '简报服务配置或余额异常';
  return '简报生成失败';
}
