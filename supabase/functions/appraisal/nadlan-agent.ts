import prompt from './nadlan-agent-prompt.json' with { type: 'json' };
import { callProvider, check, Problem } from './providers.ts';
import { resolveQuery, scoreTransaction, type Transaction, type TransactionResult } from './nearby-transactions.ts';
import { nadlanSourceUrl, parseTransactionImport } from './transaction-import.ts';
import type { CollectionMeta } from './nadlan-browser.ts';

export const AGENT_VERSION = 'nadlan-pilot-0.1';
export const POLICY = { area: 35, rooms: 25, recency: 15, floor: 10, description: 20, batchSize: 40, defaultSelection: 10 };
export type SubjectProperty = { address: string; area: number | null; rooms: number | null; floor: string | null; description: string | null };
export type Assessment = Transaction & { eligible: boolean; valuationEligible: boolean; floorScore: number | null; descriptionScore: number | null };
export type PilotValuation = { status: 'indicative' | 'insufficient_data'; estimate: number | null; low: number | null; high: number | null;
  currency: 'ILS'; transactionIds: string[]; basis: { id: string; pricePerSqm: number }[]; method: string; explanation: string };
export type AgentResult = TransactionResult & { agentVersion: string; subject: SubjectProperty; assessments: Assessment[];
  valuation: PilotValuation; dataset: Record<string, unknown> };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 1000) => typeof v === 'string' && !!v.trim() && v.length <= max;
const score = (v: unknown): v is number | null => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const failed = () => new Problem(502, 'תשובת הסוכן אינה תואמת לנתוני המקור. הנתונים נשמרו ואפשר לנסות שוב.');
const parse = (s: string) => { try { return object(JSON.parse(s.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))); } catch { throw failed(); } };

export function subjectProperty(input: unknown): SubjectProperty {
  const value = object(input);
  check(text(value.address, 500), 'יש להזין כתובת נכס.');
  for (const [name, max] of [['area', 1000000], ['rooms', 100]] as const) {
    check(value[name] == null || value[name] === '' || typeof value[name] === 'number' && Number.isFinite(value[name]) && value[name] > 0 && value[name] <= max, 'שטח או מספר חדרים אינם תקינים.');
  }
  check(value.floor == null || value.floor === '' || typeof value.floor === 'string' && value.floor.length <= 80 || typeof value.floor === 'number' && Number.isFinite(value.floor) && Math.abs(value.floor) <= 200, 'קומה אינה תקינה.');
  check(value.description == null || typeof value.description === 'string' && value.description.length <= 6000, 'תיאור הנכס אינו תקין.');
  return { address: (value.address as string).trim(), area: typeof value.area === 'number' ? value.area : null,
    rooms: typeof value.rooms === 'number' ? value.rooms : null, floor: value.floor == null || value.floor === '' ? null : String(value.floor).trim() || null,
    description: typeof value.description === 'string' ? value.description.trim() || null : null };
}

function assessed(row: Transaction, subject: SubjectProperty, query: TransactionResult['query'], value: Record<string, unknown>): Assessment {
  if (typeof value.eligible !== 'boolean' || typeof value.valuationEligible !== 'boolean' || !text(value.reason) || !score(value.floorScore) || !score(value.descriptionScore) ||
    (!subject.floor || !row.floor || row.floor === 'לא ידוע') && value.floorScore !== null || !subject.description && value.descriptionScore !== null || !value.eligible && value.valuationEligible) throw failed();
  const base = scoreTransaction(row, query, value.descriptionScore as number | null);
  // Keep raw component weights rather than recombining rounded displayed scores.
  const components: [number, number | null][] = [
    ...(subject.area === null ? [] : [[POLICY.area, row.area === null ? null : Math.max(0, 1 - Math.abs(row.area - subject.area) / subject.area)] as [number, number | null]]),
    ...(subject.rooms === null ? [] : [[POLICY.rooms, row.rooms === null ? null : Math.max(0, 1 - Math.abs(row.rooms - subject.rooms) / subject.rooms)] as [number, number | null]]),
    [POLICY.recency, row.date ? Math.max(0, 1 - (Date.parse(query.endDate) - Date.parse(row.date)) / Math.max(86400000, Date.parse(query.endDate) - Date.parse(query.startDate))) : null],
    ...(subject.floor ? [[POLICY.floor, value.floorScore === null ? null : Number(value.floorScore) / 100] as [number, number | null]] : []),
    ...(subject.description ? [[POLICY.description, value.descriptionScore === null ? null : Number(value.descriptionScore) / 100] as [number, number | null]] : []),
  ];
  const requested = components.reduce((n, [w]) => n + w, 0), available = components.reduce((n, [w, s]) => n + (s === null ? 0 : w), 0);
  if (subject.floor) {
    if (value.floorScore === null) base.missing.push('קומה');
    else base.comparison.push(`קומה: ${row.floor} לעומת ${subject.floor}; התאמה לפי AI ${value.floorScore}/100`);
  }
  return { ...base, similarity: available ? Math.round(100 * components.reduce((n, [w, s]) => n + w * (s ?? 0), 0) / available) : null,
    coverage: Math.round(100 * available / requested), aiReason: (value.reason as string).trim(), eligible: value.eligible,
    valuationEligible: value.valuationEligible, floorScore: value.floorScore as number | null, descriptionScore: value.descriptionScore as number | null };
}

export function pilotValuation(subject: SubjectProperty, selected: Assessment[]): PilotValuation {
  const rows = selected.filter(r => r.eligible && r.valuationEligible && r.area && r.amount && r.propertyType && /דיר/.test(r.propertyType));
  const result: PilotValuation = { status: 'insufficient_data', estimate: null, low: null, high: null, currency: 'ILS',
    transactionIds: [], basis: [], method: 'חציון מחיר למ״ר כפול שטח הנכס; טווח רבעון ראשון–שלישי. ללא התאמות זמן או מאפיינים. טווח פיזור, לא רווח סמך.',
    explanation: !subject.area ? 'לא נמסר שטח הנכס; ניתן לנתח השוואות אך לא לחשב אומדן כולל.' : 'נדרשות לפחות שלוש עסקאות נבחרות בדירות מגורים מתאימות, עם שטח ומחיר וללא בעיה מהותית גלויה.' };
  // Description must identify a residential apartment before using this apartment-only baseline.
  if (!subject.area || !subject.description || !/דיר[הת]|apartment|flat/i.test(subject.description) || rows.length < 3) return result;
  const values = rows.map(r => r.amount! / r.area!).sort((a, b) => a - b);
  const quantile = (q: number) => { const i = (values.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return values[lo] + (values[hi] - values[lo]) * (i - lo); };
  return { ...result, status: 'indicative', estimate: Math.round(quantile(.5) * subject.area), low: Math.round(quantile(.25) * subject.area), high: Math.round(quantile(.75) * subject.area),
    transactionIds: rows.map(r => r.id), basis: rows.map(r => ({ id: r.id, pricePerSqm: Math.round(r.amount! / r.area! * 100) / 100 })),
    explanation: 'אינדיקציה גסה לניסוי, בהנחה שהשטחים והזכויות ניתנים להשוואה. ההנחה לא אומתה; אין התאמות לזמן, מצב, קומה או זכויות.' };
}

export async function runNadlanAgent(input: { query: unknown; table: unknown; sourceUrl: unknown }, options: { provider: string; model: string; key: string },
  deps: { provider?: typeof callProvider; now?: Date; collection?: CollectionMeta } = {}): Promise<AgentResult> {
  const now = deps.now ?? new Date(), subject = subjectProperty(input.query), raw = object(input.query);
  check(raw.radiusMeters == null && (!raw.dealType || raw.dealType === 'both'), 'הסוכן משתמש בשיוך השכונה של Nadlan, ללא רדיוס או סינון יד ראשונה/שנייה.');
  let parsed, sourceUrl;
  try { parsed = parseTransactionImport(input.table); sourceUrl = nadlanSourceUrl(input.sourceUrl); } catch (error) { throw new Problem(400, (error as Error).message); }
  const query = { ...resolveQuery({ ...raw, ...subject, description: subject.description ?? '', limit: raw.limit ?? 10, dealType: 'both' }, {}, now), scope: deps.collection ? 'neighborhood' as const : 'imported' as const };
  const candidates: Transaction[] = parsed.rows.filter(r => r.date >= query.startDate && r.date <= query.endDate).map(row => ({ ...row,
    sourceUrl, sourceKind: deps.collection ? 'nadlan_browser' : 'user_import', pricePerSqm: row.area ? Math.round(row.amount / row.area * 100) / 100 : null,
    distanceMeters: null, similarity: null, coverage: 0, comparison: [], missing: [], aiReason: '' }));
  // Five parallel assessment batches fit the bounded 20-page pilot. Larger manual
  // datasets must be narrowed explicitly, never silently truncated.
  check(candidates.length <= 200, 'הסוכן הראשוני מוגבל ל־200 עסקאות בתקופה. צמצמו את התקופה או הטבלה.');
  const provider = deps.provider ?? callProvider;
  const invoke = async (payload: unknown, timeoutMs: number) => parse(await provider({ ...options, prompt: prompt.content, input: JSON.stringify(payload), files: [], search: false, timeoutMs }));
  const batches = Array.from({ length: Math.ceil(candidates.length / POLICY.batchSize) }, (_, i) => candidates.slice(i * POLICY.batchSize, (i + 1) * POLICY.batchSize));
  const outcomes = await Promise.all(batches.map(async batch => {
    const response = await invoke({ stage: 'assess', subject, candidates: batch, provenance: deps.collection ?? { kind: 'user_import', sourceUrl } }, 65_000);
    if (!Array.isArray(response.assessments) || response.assessments.length !== batch.length) throw failed();
    const byId = new Map(batch.map(r => [r.id, r])), seen = new Set<string>();
    return response.assessments.map(value => {
      const a = object(value), row = typeof a.id === 'string' ? byId.get(a.id) : undefined;
      if (!row || seen.has(row.id)) throw failed(); seen.add(row.id);
      return assessed(row, subject, query, a);
    });
  }));
  const assessments = outcomes.flat().sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1) || b.coverage - a.coverage || (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
  const selected = assessments.filter(a => a.eligible).slice(0, query.limit), valuation = pilotValuation(subject, selected);
  let keyPoints: NonNullable<TransactionResult['keyPoints']> = [];
  if (selected.length) {
    const response = await invoke({ stage: 'summarize', subject, selected, valuation, provenance: deps.collection ?? { kind: 'user_import', sourceUrl } }, 45_000);
    if (!Array.isArray(response.keyPoints) || response.keyPoints.length < 1 || response.keyPoints.length > 8 || !text(response.valuationExplanation, 2000)) throw failed();
    const ids = new Set(selected.map(r => r.id));
    keyPoints = response.keyPoints.map(value => {
      const p = object(value);
      if (!text(p.text) || !Array.isArray(p.transactionIds) || !p.transactionIds.length || p.transactionIds.length > selected.length || new Set(p.transactionIds).size !== p.transactionIds.length || p.transactionIds.some(id => typeof id !== 'string' || !ids.has(id))) throw failed();
      return { text: (p.text as string).trim(), transactionIds: p.transactionIds as string[] };
    });
    valuation.explanation += '\n' + (response.valuationExplanation as string).trim();
  }
  const warnings = [...parsed.warnings, ...(deps.collection?.warnings ?? ['נתוני ייבוא משתמש; קישור המקור לא נפתח על ידי הסוכן.']),
    'גרסת ניסוי: דירוג ואינדיקציה גסה לעזרת השמאי, ללא התאמות שווי מכוילות. השיוך לשכונה לפי המקור; מרחקים לא נמדדו.'];
  if (candidates.length !== parsed.rows.length) warnings.push(`${parsed.rows.length - candidates.length} עסקאות מחוץ לתקופה לא נותחו.`);
  if (!subject.area && !subject.rooms && !subject.floor && !subject.description) warnings.push('נמסרה כתובת בלבד; הדירוג מבוסס על מועד העסקה ואינו מעיד על התאמה פיזית.');
  if (!selected.length && candidates.length) warnings.push('כל העסקאות שנבדקו נפסלו. סיבות הפסילה זמינות ברשימת ההערכות וב־JSON.');
  const result = { agentVersion: AGENT_VERSION, subject, query, sourceUrl, source: deps.collection ? 'Nadlan / איסוף בדפדפן' as const : 'ייבוא משתמש / Nadlan' as const,
    collection: deps.collection, retrievedAt: deps.collection?.retrievedAt ?? now.toISOString(), provider: options.provider, model: options.model,
    transactions: selected, assessments, keyPoints, valuation, candidateCount: candidates.length, analyzedCount: assessments.length, warnings };
  return { ...result, dataset: { schemaVersion: 1, runId: crypto.randomUUID(), agentVersion: AGENT_VERSION, createdAt: now.toISOString(),
    subject, policy: POLICY, query, provenance: deps.collection ?? { kind: 'user_import', sourceUrl }, transactions: parsed.rows,
    assessments, selectedIds: selected.map(r => r.id), keyPoints, valuation, warnings, provider: options.provider, model: options.model } };
}
