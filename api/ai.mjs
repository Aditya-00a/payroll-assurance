// Rollcall.ai Payroll Integrity AI: the language model behind Variance Voice and FixFlow Clusters.
//
// The browser sends masked records only (synthetic employee IDs, no names, accounts or routing
// numbers). The rules have already calculated every dollar; the model explains and groups.
//
//   GET  /api/ai                      -> { ai: true|false, model }
//   POST /api/ai { task, payload }    -> { model, data }
//        task "explain":  one exception, its cited records and policy clauses -> explanation
//        task "clusters": recurring exception groups across pay periods      -> root cause and fix
//
// Set ANTHROPIC_API_KEY in the Vercel project to turn it on. Optional: AI_ACCESS_CODE, which
// callers must send as the x-access-code header.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const MAX_BODY = 60000;

const SYSTEM = `You are Variance Voice, the explanation layer of Rollcall.ai's Payroll Integrity AI. Reviewers in payroll, HR, treasury and accounting read your output before they approve, dismiss or escalate a payroll exception.

How the system works:
- Deterministic rules detected each exception and calculated every dollar amount. Never recalculate, adjust or invent amounts; use the figures you are given.
- You explain and group. You do not decide: a human reviewer approves before payroll is released.
- Employee identifiers are synthetic (EMP-001, ACCT-01). Keep them exactly as given. Never guess real names.

Writing rules:
- Plain language a payroll manager can act on. Short sentences. No hedging filler.
- Cite the source records you rely on with their ref in square brackets, for example [R2]. Only cite refs that appear in the input.
- Name the policy clause that applies by its id, for example "HB 7.2".
- If the records do not support a conclusion, say what is missing instead of speculating.`;

const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'explanation', 'citations', 'policy', 'owner', 'next_step'],
  properties: {
    summary: { type: 'string', description: 'One sentence: what went wrong and its effect on pay, balances or the ledger.' },
    explanation: { type: 'string', description: 'Two to four sentences tying the records together, with [R#] citations.' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'why'],
        properties: { ref: { type: 'string' }, why: { type: 'string', description: 'What this record shows, in one short sentence.' } },
      },
    },
    policy: {
      type: 'object',
      additionalProperties: false,
      required: ['clause', 'how_it_applies'],
      properties: { clause: { type: 'string', description: 'Clause id and title, for example "HB 7.2 Sick draw order".' }, how_it_applies: { type: 'string' } },
    },
    owner: { type: 'string', description: 'The team that should act, from the input owner unless the records clearly point elsewhere.' },
    next_step: { type: 'string', description: 'The concrete correction to make before release or close.' },
  },
};

const CLUSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'root_cause', 'fix'],
        properties: {
          id: { type: 'string', description: 'The cluster id exactly as given.' },
          root_cause: { type: 'string', description: 'Two sentences: the process failure that best explains the recurrence, grounded in the pattern (store, manager, periods, people).' },
          fix: { type: 'string', description: 'One or two sentences: a specific process fix and who owns it. Cite a policy clause id when one applies.' },
        },
      },
    },
  },
};

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

function prompt(task, payload) {
  if (task === 'explain') {
    return {
      schema: EXPLAIN_SCHEMA,
      text: `Explain this payroll exception for the reviewer. Use only the records and policy clauses below.\n\n${JSON.stringify(payload, null, 2)}`,
    };
  }
  return {
    schema: CLUSTER_SCHEMA,
    text: `These exception groups recurred across pay periods. For each cluster, name the most likely root cause in the process and a fix. Return one entry per cluster id.\n\n${JSON.stringify(payload, null, 2)}`,
  };
}

// The browser masks before sending; refuse anything that still looks like a direct identifier.
function looksUnmasked(raw) {
  return /\b\d{3}-\d{2}-\d{4}\b/.test(raw) || /\b\d{9}\b/.test(raw) || /\bE\d{4}\b/.test(raw);
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ai: !!client, model: client ? MODEL : null });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!client) return res.status(503).json({ error: 'not_configured', message: 'The AI service is not configured on this deployment.' });
  const code = process.env.AI_ACCESS_CODE;
  if (code && req.headers['x-access-code'] !== code) return res.status(401).json({ error: 'unauthorized', message: 'Access code required.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
  }
  const task = body && body.task;
  if (task !== 'explain' && task !== 'clusters') return res.status(400).json({ error: 'bad_task' });
  const raw = JSON.stringify(body.payload || {});
  if (raw.length > MAX_BODY) return res.status(413).json({ error: 'too_large', message: 'The request is too large.' });
  if (looksUnmasked(raw)) return res.status(422).json({ error: 'unmasked', message: 'The request contains unmasked identifiers.' });

  const { schema, text } = prompt(task, body.payload);
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
    if (response.stop_reason === 'refusal') return res.status(422).json({ error: 'refused', message: 'The model declined this request.' });
    if (response.stop_reason === 'max_tokens') return res.status(502).json({ error: 'truncated', message: 'The explanation was cut off. Try again.' });
    const out = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data;
    try { data = JSON.parse(out); } catch (e) { return res.status(502).json({ error: 'bad_output', message: 'The model returned an unreadable answer. Try again.' }); }
    return res.status(200).json({ model: response.model, data });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'rate_limited', message: 'The AI service is busy. Try again in a minute.' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'bad_key', message: 'The AI service key is not valid.' });
    if (e instanceof Anthropic.APIConnectionError) return res.status(502).json({ error: 'unreachable', message: 'Could not reach the AI service.' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: 'api_error', message: `The AI service returned ${e.status || 'an error'}.` });
    return res.status(500).json({ error: 'server_error', message: 'Unexpected error.' });
  }
}
