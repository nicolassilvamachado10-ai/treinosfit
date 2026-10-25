// Funções compartilhadas da área do aluno (não é um endpoint: arquivos com "_" são ignorados pela Vercel)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SECRET = process.env.SITE_SECRET || '';

const NIVEIS = [
  { n: 1, nome: 'Iniciante', meses: 2 },
  { n: 2, nome: 'Intermediário', meses: 4 },
  { n: 3, nome: 'Avançado', meses: 6 },
];

const PLANOS = {
  f3: { nome: 'Treino feminino 3x na semana', genero: 'f', x: '3x' },
  f4: { nome: 'Treino feminino 4x na semana', genero: 'f', x: '4x' },
  f5: { nome: 'Treino feminino 5x na semana', genero: 'f', x: '5x' },
  m3: { nome: 'Treino masculino 3x na semana', genero: 'm', x: '3x' },
  m4: { nome: 'Treino masculino 4x na semana', genero: 'm', x: '4x' },
  m5: { nome: 'Treino masculino 5x na semana', genero: 'm', x: '5x' },
  ind: { nome: 'Treino individual com a especialista', genero: '', x: '' },
};

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function emailValido(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
}

// Descobre o plano pelo nome do produto na Kiwify
function planoPeloNome(nome) {
  const s = String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (s.includes('individual') || s.includes('especialista') || s.includes('personalizado')) return 'ind';
  const g = s.includes('masc') ? 'm' : s.includes('femin') ? 'f' : null;
  const m = s.match(/([345])\s*x/);
  return g && m ? g + m[1] : null;
}

function hmac(txt) {
  return crypto.createHmac('sha256', SECRET).update(txt).digest('hex');
}

// Chave usada na URL do webhook da Kiwify
function chaveWebhook() {
  return hmac('kiwify-webhook').slice(0, 32);
}

// ---------- Banco (Upstash Redis via REST) ----------
async function redis(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) throw new Error('Banco de dados não configurado');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function planosDoEmail(email) {
  const r = await redis(['SMEMBERS', 'aluno:' + email]);
  return (r || []).filter((p) => PLANOS[p]);
}

// ---------- Sessão (cookie assinado, sem banco) ----------
const COOKIE = 'tf_sessao';
const DIAS = 30;

function criarSessao(email) {
  const exp = Date.now() + DIAS * 864e5;
  const payload = Buffer.from(JSON.stringify({ e: email, x: exp })).toString('base64url');
  return payload + '.' + hmac('sessao:' + payload);
}

function lerSessao(req) {
  const raw = String(req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const tok = decodeURIComponent(raw.slice(COOKIE.length + 1));
  const [payload, sig] = tok.split('.');
  if (!payload || !sig) return null;
  const esperado = hmac('sessao:' + payload);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!d.e || d.x < Date.now()) return null;
    return normEmail(d.e);
  } catch (e) {
    return null;
  }
}

function cookieSessao(tok) {
  return `${COOKIE}=${encodeURIComponent(tok)}; Path=/; Max-Age=${DIAS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

function cookieSair() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

// ---------- Conteúdo (PDFs criptografados) ----------
let pacote = null;

function carregarPacote() {
  if (pacote) return pacote;
  const bin = Buffer.from(fs.readFileSync(path.join(process.cwd(), 'conteudo', 'treinos.b64'), 'utf8').replace(/\s+/g, ''), 'base64');
  const key = crypto.createHash('sha256').update(SECRET + ':arquivos').digest();
  const iv = bin.subarray(0, 12);
  const tag = bin.subarray(12, 28);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  const gz = Buffer.concat([dec.update(bin.subarray(28)), dec.final()]);
  const raw = zlib.gunzipSync(gz);
  const tam = raw.readUInt32BE(0);
  const indice = JSON.parse(raw.subarray(4, 4 + tam).toString());
  pacote = { indice, dados: raw.subarray(4 + tam) };
  return pacote;
}

function arquivo(plano, nivel) {
  const p = carregarPacote();
  const it = p.indice[plano + '-' + nivel];
  if (!it) return null;
  return { nome: it.nome, buf: p.dados.subarray(it.ini, it.ini + it.tam) };
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = {
  NIVEIS, PLANOS, normEmail, emailValido, planoPeloNome, hmac, chaveWebhook,
  redis, planosDoEmail, criarSessao, lerSessao, cookieSessao, cookieSair, arquivo, json,
};
