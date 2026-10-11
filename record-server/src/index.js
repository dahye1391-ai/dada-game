const API_PATH = '/api/othello/scores';
const MAX_BODY_BYTES = 2048;
const fields = ['id', 'name', 'difficulty', 'result', 'durationSeconds', 'blackScore', 'whiteScore'];
const initialized = new WeakMap();
const schema = `CREATE TABLE IF NOT EXISTS othello_scores (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, difficulty TEXT NOT NULL,
 result TEXT NOT NULL, duration_seconds INTEGER NOT NULL,
 black_score INTEGER NOT NULL, white_score INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`;

function initialize(db) {
 if (!initialized.has(db)) {
  const ready = db.prepare(schema).run().catch(error => { initialized.delete(db); throw error; });
  initialized.set(db, ready);
 }
 return initialized.get(db);
}
function reply(data, status, cors) {
 return new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', ...cors
 }});
}
function validate(data) {
 if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
 const {id, difficulty, result, durationSeconds, blackScore, whiteScore} = data;
 if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
 if (typeof data.name !== 'string') return null;
 const name = data.name.trim();
 if (!name || [...name].length > 16 || /[\u0000-\u001f\u007f]/.test(name)) return null;
 if (!['easy','normal','hard'].includes(difficulty) || !['win','loss','draw'].includes(result)) return null;
 if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 86400) return null;
 if (![blackScore, whiteScore].every(s => Number.isInteger(s) && s >= 0 && s <= 64)) return null;
 if (blackScore + whiteScore < 4 || blackScore + whiteScore > 64) return null;
 const actualResult = blackScore === whiteScore ? 'draw' : blackScore > whiteScore ? 'win' : 'loss';
 if (result !== actualResult) return null;
 return {id: id.toLowerCase(), name, difficulty, result, durationSeconds, blackScore, whiteScore};
}
async function readBody(request) {
 const declaredSize = request.headers.get('content-length');
 if (declaredSize && Number(declaredSize) > MAX_BODY_BYTES) throw new Error('too-large');
 if (!request.body) throw new Error('invalid-json');
 const reader = request.body.getReader();
 let length = 0; const chunks = [];
 while (true) {
  const {done, value} = await reader.read(); if (done) break;
  length += value.byteLength;
  if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('too-large'); }
  chunks.push(value);
 }
 const bytes = new Uint8Array(length); let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
 return JSON.parse(new TextDecoder().decode(bytes));
}
const select = `SELECT id, name, difficulty, result, duration_seconds AS durationSeconds,
 black_score AS blackScore, white_score AS whiteScore, created_at AS createdAt FROM othello_scores`;

export default {
 async fetch(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || 'https://dahye1391-ai.github.io').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) return reply({error: 'Origin not allowed'}, 403, {});
  const cors = origin ? {'Access-Control-Allow-Origin': origin} : {};
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
   return reply({ok: true, service: 'dada-othello-records'}, 200, cors);
  }
  if (url.pathname !== API_PATH) return reply({error: 'Not found'}, 404, cors);
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {
   ...cors, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
   'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'
  }});
  if (!['GET','POST'].includes(request.method)) {
   const response = reply({error: 'Method not allowed'}, 405, cors);
   response.headers.set('Allow', 'GET, POST, OPTIONS'); return response;
  }
  let record;
  if (request.method === 'POST') {
   if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply({error: 'JSON required'}, 415, cors);
   }
   let data;
   try { data = await readBody(request); } catch (error) {
    return reply({error: error.message === 'too-large' ? 'Record too large' : 'Invalid JSON'}, error.message === 'too-large' ? 413 : 400, cors);
   }
   record = validate(data);
   if (!record) return reply({error: 'Invalid match record'}, 400, cors);
  }
  if (!env.DB) return reply({error: 'Database unavailable'}, 503, cors);
  try {
   await initialize(env.DB);
   if (request.method === 'GET') {
    const {results} = await env.DB.prepare(select + ' ORDER BY rowid DESC LIMIT 100').all();
    return reply({scores: results}, 200, cors);
   }
   const inserted = await env.DB.prepare(`INSERT INTO othello_scores
    (id, name, difficulty, result, duration_seconds, black_score, white_score)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(...fields.map(field => record[field])).run();
   const saved = await env.DB.prepare(select + ' WHERE id = ?').bind(record.id).first();
   if (!saved || fields.some(field => saved[field] !== record[field])) return reply({error: 'Record id already used'}, 409, cors);
   return reply({score: saved}, inserted.meta.changes ? 201 : 200, cors);
  } catch {
   return reply({error: 'Record service temporarily unavailable'}, 503, cors);
  }
 }
};
