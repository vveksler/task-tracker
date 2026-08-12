export type HistoryTurn = {
  role: string;
  content: string;
};

/** English-only confirm phrases — fallback when intent LLM is unavailable. */
const CONFIRM_RE =
  /^(yes|yep|yeah|ok|okay|sure|go\s*ahead|confirm|please|do\s*it)\.?$/i;

export function normalizeHistory(
  history: HistoryTurn[] | null | undefined,
  maxTurns = 12,
  maxChars = 2000,
): HistoryTurn[] {
  if (!history) return [];
  const cleaned: HistoryTurn[] = [];
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue;
    const role = item.role;
    const content = item.content;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string' || !content.trim()) continue;
    cleaned.push({
      role,
      content: content.trim().slice(0, maxChars),
    });
  }
  return cleaned.slice(-maxTurns);
}

export function formatConversationHistory(history: HistoryTurn[]): string {
  if (history.length === 0) return '';
  const lines = ['<conversation_history>'];
  for (const turn of history) {
    const label = turn.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${label}: ${turn.content}`);
  }
  lines.push('</conversation_history>');
  return lines.join('\n');
}

export function isShortConfirmation(question: string): boolean {
  return CONFIRM_RE.test(question.trim());
}

/**
 * Language-agnostic follow-up heuristic: very short replies are usually
 * confirms ("yes", "давай", "ok") when history exists. EN confirm regex is a
 * bonus, not the only path.
 *
 * Keep this tight — real requests like "assign Vadim to all tasks" must NOT
 * match, or we skip them when folding history.
 */
export function isLikelyFollowUp(question: string): boolean {
  const t = question.trim();
  if (!t) return false;
  if (isShortConfirmation(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  return t.length <= 24 && words.length <= 3;
}

/**
 * Fold prior substantive user ask into the question for scope logic.
 * Prefer intent.isConfirmation; fall back to short-message heuristic.
 */
export function effectiveQuestionForGuards(
  question: string,
  history: HistoryTurn[],
  isConfirmation?: boolean,
): string {
  const shouldFold =
    isConfirmation === true ||
    (isConfirmation !== false && isLikelyFollowUp(question));
  if (!shouldFold || history.length === 0) {
    return question;
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (turn.role !== 'user') continue;
    if (isLikelyFollowUp(turn.content)) continue;
    return `${turn.content}\n${question}`;
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (turn.role === 'assistant') {
      return `${turn.content}\n${question}`;
    }
  }
  return question;
}

/**
 * Always enrich the embedding query with recent user turns so follow-ups
 * ("yes", "давай", "do it") still retrieve the right tasks — no magic words.
 */
export function retrievalQuery(
  question: string,
  history: HistoryTurn[],
): string {
  if (history.length === 0) return question;
  const parts: string[] = [];
  for (const turn of history.slice(-6)) {
    if (turn.role === 'user') {
      parts.push(turn.content);
    }
  }
  parts.push(question);
  // Embed path truncates at 8000; keep retrieval text bounded earlier too.
  return parts.join('\n').slice(0, 8000);
}
