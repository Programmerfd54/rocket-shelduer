/**
 * Компиляция пользовательского регулярного выражения с защитой от ReDoS.
 *
 * Отклоняются шаблоны с типичными источниками катастрофического backtracking:
 * квантификатор над группой, внутри которой есть квантификатор или альтернатива
 * ((a+)+, (a|a)*, (\w+\s?)*), обратные ссылки и слишком длинные шаблоны.
 * Это эвристика, а не полный анализатор, поэтому дополнительно ограничивается длина
 * проверяемых строк (см. MAX_SUBJECT_LENGTH).
 */

export const MAX_PATTERN_LENGTH = 200;
export const MAX_SUBJECT_LENGTH = 256;

/** true, если у группы (по позиции закрывающей скобки) сразу после неё стоит квантификатор. */
function quantifiedAfter(pattern: string, closeIdx: number): boolean {
  const next = pattern[closeIdx + 1];
  return next === '*' || next === '+' || next === '{';
}

export function isPotentiallyCatastrophic(pattern: string): boolean {
  if (/\\[1-9]|\\k</.test(pattern)) return true; // обратные ссылки
  const stack: { start: number; hasInnerRepeat: boolean }[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      stack.push({ start: i, hasInnerRepeat: false });
      continue;
    }
    if (ch === ')') {
      const group = stack.pop();
      if (!group) continue;
      if (group.hasInnerRepeat && quantifiedAfter(pattern, i)) return true;
      // вложенная группа с повтором делает «повторяемой» и внешнюю
      if (stack.length && (group.hasInnerRepeat || quantifiedAfter(pattern, i))) {
        stack[stack.length - 1].hasInnerRepeat = true;
      }
      continue;
    }
    if ((ch === '*' || ch === '+' || ch === '{' || ch === '|') && stack.length) {
      stack[stack.length - 1].hasInnerRepeat = true;
    }
  }
  return false;
}

/** Компилирует шаблон или возвращает null, если он некорректен или потенциально опасен. */
export function compileUserRegex(pattern: string): RegExp | null {
  if (typeof pattern !== 'string' || pattern.length > MAX_PATTERN_LENGTH) return null;
  if (isPotentiallyCatastrophic(pattern)) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
