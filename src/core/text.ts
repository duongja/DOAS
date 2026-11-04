import type { BehaviorPattern, MatchedPattern } from './types';

/**
 * Deterministic text matching for alignment detection.
 *
 * Matching is intentionally conservative and explainable: we match whole
 * words/phrases, not fuzzy substrings. A user can add variants ("emails",
 * "emailing") to a behavior's `matchTerms` when needed. We do apply light
 * English inflection handling (plural, -ed, -ing) so "draft" matches "drafted".
 */

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'did',
  'do',
  'does',
  'done',
  'for',
  'from',
  'get',
  'got',
  'had',
  'has',
  'have',
  'he',
  'her',
  'him',
  'his',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'out',
  'she',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'up',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'which',
  'who',
  'will',
  'with',
  'work',
  'worked',
  'working',
  'would',
  'you',
  'your',
  'today',
  'daily',
  'goal',
  'goals',
  'task',
  'tasks',
  'target',
  'metric',
  'progress',
  'session',
]);

/** Lowercase, strip punctuation/diacritics, and collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

function canonical(token: string): string {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (/(ch|sh|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Two normalized tokens are equivalent when they differ only by a common
 * inflection. This keeps matching readable without pulling in a stemmer.
 */
function tokensEquivalent(left: string, right: string): boolean {
  const a = canonical(left);
  const b = canonical(right);
  if (a === b) return true;

  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length < 3 || !long.startsWith(short)) return false;

  const suffix = long.slice(short.length);
  if (/^(s|es|ed|ing|ings|ly|ment)$/.test(suffix)) return true;

  // e-drop: write -> writing, make -> making
  if (short.endsWith('e')) {
    const stem = short.slice(0, -1);
    if (long.startsWith(stem) && /^(ing|ed|es)$/.test(long.slice(stem.length))) return true;
  }

  // doubled consonant: run -> running, stop -> stopped
  const last = short.at(-1);
  if (last !== undefined && long === `${short}${last}ing`) return true;
  if (last !== undefined && long === `${short}${last}ed`) return true;

  return false;
}

/** True when `phrase` occurs as a contiguous word sequence in `haystack`. */
export function phraseMatches(haystack: readonly string[], phrase: string): boolean {
  const needle = tokenize(phrase);
  if (needle.length === 0 || needle.length > haystack.length) return false;

  const limit = haystack.length - needle.length;
  for (let start = 0; start <= limit; start += 1) {
    let allMatch = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      const haystackToken = haystack[start + offset];
      const needleToken = needle[offset];
      if (haystackToken === undefined || needleToken === undefined) {
        allMatch = false;
        break;
      }
      if (!tokensEquivalent(haystackToken, needleToken)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}

/** Build the full term list for a behavior, always including its label. */
export function patternTerms(pattern: BehaviorPattern): string[] {
  const terms = [pattern.label, ...pattern.matchTerms]
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

  return [...new Set(terms)];
}

/** Return every pattern with at least one matching term. */
export function matchPatterns(
  haystack: readonly string[],
  patterns: readonly BehaviorPattern[],
): MatchedPattern[] {
  const matches: MatchedPattern[] = [];

  for (const pattern of patterns) {
    const terms = patternTerms(pattern).filter((term) => phraseMatches(haystack, term));
    if (terms.length > 0) {
      matches.push({ pattern, terms });
    }
  }

  return matches;
}

/** Return the matched raw terms from a plain term list. */
export function matchTermList(
  haystack: readonly string[],
  terms: readonly string[],
): string[] {
  return terms
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => phraseMatches(haystack, term));
}

/**
 * Extract meaningful tokens from a metric name. Used as a secondary
 * "movable object" signal when no explicit high-leverage action matched.
 */
export function significantTokens(text: string): string[] {
  return tokenize(text).filter(
    (token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token),
  );
}

export function uniqueTokens(tokens: readonly string[]): string[] {
  return [...new Set(tokens.map((token) => canonical(token)))];
}
