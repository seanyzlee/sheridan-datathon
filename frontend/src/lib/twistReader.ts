/**
 * Twist card reader (D7). Deterministic rules, no LLM, no network.
 * Every value it sets carries the phrase that produced it, so a misread is visible.
 * Fields the card doesn't mention reset to "no shock": a twist card is a whole scenario.
 */
import { NO_DRAFT, type ShockDraft } from './shock';

export type TwistField = 'income_factor' | 'income_months' | 'bills_pct' | 'spend_delta' | 'one_off' | 'ei_cap_on';

export interface TwistMatch {
  field: TwistField;
  value: string;
  phrase: string;
}

export interface TwistResult {
  draft: ShockDraft;
  matches: TwistMatch[];
  unmatched: string[];
  recognised: boolean;
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, half: 0.5, 'half a': 0.5, 'a full': 1, full: 1, single: 1,
};
const NUM = String.raw`(\d+(?:\.\d+)?|${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})`;
const MONEY = String.raw`\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k)?`;

function num(s: string): number {
  const t = s.trim().toLowerCase();
  if (t in WORDS) return WORDS[t]!;
  return Number(t.replace(/,/g, ''));
}

function money(digits: string, k?: string): number {
  return num(digits) * (k ? 1000 : 1);
}

interface Rule {
  re: RegExp;
  apply: (m: RegExpExecArray, d: ShockDraft) => TwistMatch[];
  /** When true, the match is consumed but sets nothing. */
  skipIf?: (found: TwistMatch[]) => boolean;
}

const pctText = (x: number) => `${Math.round(x * 100)}%`;
const cadText = (x: number) => `$${Math.round(x).toLocaleString('en-CA')}`;

// Order matters: specific phrases first. Each rule consumes the text it matched.
const RULES: Rule[] = [
  {
    // "EI 55%", "EI at 60%", "55% on EI", "employment insurance (55%)"
    re: new RegExp(String.raw`\b(?:ei|employment insurance)\b\s*(?:at|of|pays|paying|=|:|\()?\s*(\d{1,3}(?:\.\d+)?)\s*%|(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of (?:their |his |her )?(?:income|pay)\s*)?(?:on|from)\s+(?:ei|employment insurance)\b`, 'i'),
    apply: (m, d) => {
      d.income_factor = num(m[1] ?? m[2]!) / 100;
      return [{ field: 'income_factor', value: pctText(d.income_factor), phrase: m[0] }];
    },
  },
  {
    // "income drops to 70%", "income falls to 60 percent"
    re: /\b(?:income|pay|salary|earnings)\s+(?:drops?|falls?|is cut|cut|reduced|goes down|declines?)\s+to\s+(\d{1,3}(?:\.\d+)?)\s*%/i,
    apply: (m, d) => {
      d.income_factor = num(m[1]!) / 100;
      return [{ field: 'income_factor', value: pctText(d.income_factor), phrase: m[0] }];
    },
  },
  {
    // "income drops by 30%", "a 20% pay cut", "income cut 25%"
    re: /\b(?:income|pay|salary|earnings)\s+(?:drops?|falls?|is cut|cut|reduced|goes down|declines?)\s+(?:by\s+)?(\d{1,3}(?:\.\d+)?)\s*%|(\d{1,3}(?:\.\d+)?)\s*%\s+(?:pay|income|salary)\s+cut/i,
    apply: (m, d) => {
      d.income_factor = 1 - num(m[1] ?? m[2]!) / 100;
      return [{ field: 'income_factor', value: pctText(d.income_factor), phrase: m[0] }];
    },
  },
  {
    // Before bare "EI" so "EI cap" isn't read as a second EI mention.
    re: /\b(?:ei cap|capped|weekly max(?:imum)?|max(?:imum)? (?:weekly )?benefit|benefit cap|ei max(?:imum)?)\b/i,
    apply: (m, d) => {
      d.ei_cap_on = true;
      return [{ field: 'ei_cap_on', value: 'On', phrase: m[0] }];
    },
  },
  {
    // bare EI / job loss. Doesn't override an explicit income figure found earlier.
    re: /\b(?:on ei|goes on ei|ei|employment insurance|loses? (?:their |his |her |the )?job|laid off|job loss|unemployed)\b/i,
    skipIf: (found) => found.some((x) => x.field === 'income_factor'),
    apply: (m, d) => {
      d.income_factor = 0.55;
      return [{ field: 'income_factor', value: '55% (EI)', phrase: m[0] }];
    },
  },
  {
    // "for 6 months", "lasting six months", "6 months of EI"
    re: new RegExp(String.raw`\b(?:for|lasting|over)\s+${NUM}\s+months?\b|\b${NUM}\s+months?\s+(?:of|on)\s+(?:ei|employment insurance)\b`, 'i'),
    apply: (m, d) => {
      d.income_months = Math.round(num(m[1] ?? m[2]!));
      return [{ field: 'income_months', value: `${d.income_months} months`, phrase: m[0] }];
    },
  },
  {
    // "bills up 15%", "bills +15%", "bills rise by 15%", "15% rise in bills"
    re: /\b(?:household\s+)?(?:bills|utilities)\s*(?:go up|goes up|are up|rise|rises|jump|jumps|increase|increases|climb|up)?\s*(?:by\s*)?\+?\s*(\d{1,3}(?:\.\d+)?)\s*%|(\d{1,3}(?:\.\d+)?)\s*%\s+(?:rise|increase|jump|hike)\s+in\s+(?:household\s+)?(?:bills|utilities)/i,
    apply: (m, d) => {
      d.bills_pct = num(m[1] ?? m[2]!) / 100;
      return [{ field: 'bills_pct', value: `+${pctText(d.bills_pct)} of bills`, phrase: m[0] }];
    },
  },
  {
    // "rent up $300", "rent rises by $250/month", "$300 more rent"
    re: new RegExp(String.raw`\b(?:rent|spending|costs|expenses)\s*(?:goes up|go up|is up|rises|rise|increases|increase|up|jumps|\+)?\s*(?:by\s*)?\+?\s*${MONEY}(?:\s*(?:\/|a|per)\s*(?:month|mo))?|${MONEY}\s+(?:more|extra)\s+(?:in |on |for )?(?:rent|spending|a month|per month)`, 'i'),
    apply: (m, d) => {
      const v = m[1] ? money(m[1], m[2]) : money(m[3]!, m[4]);
      d.spend_delta += v;
      return [{ field: 'spend_delta', value: `+${cadText(v)}/month`, phrase: m[0] }];
    },
  },
  {
    // "a full month of spending", "two months of spending", "half a month of expenses"
    re: new RegExp(
      String.raw`(?:\b(?:an?\s+)?(?:(?:one[- ]?off|surprise|unexpected|emergency)\s+)?(?:(?:cost|bill|expense|hit|repair)\s+)?(?:of\s+|equal to\s+)?)?` +
        String.raw`(?:${NUM}\s+)?(?:full\s+)?months?(?:'s|’s)?\s+(?:of\s+|worth of\s+)?(?:spending|expenses|outgoings)` +
        String.raw`(?:\s+as\s+an?\s+(?:one[- ]?off|surprise|emergency)(?:\s+(?:cost|bill|expense|emergency|hit))?)?`,
      'i',
    ),
    apply: (m, d) => {
      const x = m[1] ? num(m[1]) : 1;
      d.one_off_mode = 'xs';
      d.one_off_value = x;
      return [{ field: 'one_off', value: `${x} × S (${x === 1 ? 'one month' : `${x} months`} of spending)`, phrase: m[0] }];
    },
  },
  {
    // "one-off $3,000", "repair of $2k", "$4,000 emergency"
    re: new RegExp(
      String.raw`\b(?:one[- ]?off|repair|emergency|unexpected|surprise|car|medical|vet|dental|roof|furnace)\b[^$\d]{0,40}${MONEY}(?:\s+(?:[a-z]+\s+)?(?:bill|repair|cost|expense|emergency))?` +
        String.raw`|${MONEY}\s+(?:[a-z]+\s+)?(?:one[- ]?off|repair|emergency|bill|expense|cost|hit)`,
      'i',
    ),
    apply: (m, d) => {
      const v = m[1] ? money(m[1], m[2]) : money(m[3]!, m[4]);
      d.one_off_mode = 'cad';
      d.one_off_value = v;
      return [{ field: 'one_off', value: cadText(v), phrase: m[0] }];
    },
  },
];

const FILLER = /^(?:\s|the|a|an|at|as|customer|they|their|he|she|his|her|and|with|plus|then|also|of|on|in|to|is|are|gets?|has|have|hits?|twist|card|scenario|what if|if|happens|for|\W)+$/i;

export function readTwist(text: string): TwistResult {
  const draft: ShockDraft = { ...NO_DRAFT };
  const matches: TwistMatch[] = [];
  let rest = ` ${text.replace(/[–—]/g, '-').replace(/\bper ?cent\b/gi, '%').replace(/\s+/g, ' ')} `;

  for (const rule of RULES) {
    // Apply each rule until it stops matching, consuming matched text.
    for (let guard = 0; guard < 5; guard++) {
      const m = rule.re.exec(rest);
      if (!m) break;
      if (rule.skipIf?.(matches)) {
        rest = rest.replace(m[0], ' | ');
        continue;
      }
      matches.push(...rule.apply(m, draft).map((x) => ({ ...x, phrase: x.phrase.trim() })));
      rest = rest.replace(m[0], ' | ');
    }
  }

  const unmatched = rest
    .split(/[|;!?]|[,.](?=\s|$)|\band\b|\bwith\b|\bplus\b|\bthen\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !FILLER.test(s));

  return { draft, matches, unmatched, recognised: matches.length > 0 };
}
