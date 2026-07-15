export function getAccountD1Status({
  queuedWrites = 0,
  pendingWrites = 0,
  failedWrites = 0,
  lastPersistAt = '',
  lastError = ''
} = {}) {
  const queueCount = Number(queuedWrites || 0);
  const pendingCount = Number(pendingWrites || 0);
  const failedCount = Number(failedWrites || 0);

  if (failedCount) {
    return {
      label: `${failedCount} failed`,
      tone: 'attention',
      attentionCount: failedCount,
      detail: String(lastError || 'D1 write needs attention.')
    };
  }
  if (queueCount) {
    return {
      label: `${queueCount} queued`,
      tone: 'attention',
      attentionCount: queueCount,
      detail: String(lastError || 'D1 writes are queued for retry.')
    };
  }
  if (pendingCount) {
    return {
      label: `${pendingCount} saving`,
      tone: 'saving',
      attentionCount: 0,
      detail: 'Saving business data to D1.'
    };
  }
  return {
    label: lastPersistAt ? 'Saved to D1' : 'D1 ready',
    tone: 'saved',
    attentionCount: 0,
    detail: lastPersistAt ? `Last update: ${lastPersistAt}` : 'D1 business storage is ready.'
  };
}
