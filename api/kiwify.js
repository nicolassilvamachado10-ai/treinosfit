// Recebe o aviso de compra da Kiwify (webhook) e libera/remove o acesso do aluno
const { normEmail, planoPeloNome, chaveWebhook, redis, json } = require('./_lib');

function pegar(o, ...caminhos) {
  for (const c of caminhos) {
    const v = c.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    if (v != null && v !== '') return v;
  }
  return '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 200, { ok: true, info: 'webhook TreinosFit' });
  if (String((req.query && req.query.key) || '') !== chaveWebhook()) return json(res, 401, { erro: 'chave inválida' });

  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (e) { b = {}; }
  }
  b = b || {};
  const o = b.order && typeof b.order === 'object' ? b.order : b;

  const email = normEmail(pegar(o, 'Customer.email', 'customer.email', 'Customer.Email', 'email'));
  const produto = pegar(o, 'Product.product_name', 'product.product_name', 'product.name', 'Product.name', 'product_name');
  const status = String(pegar(o, 'order_status', 'status')).toLowerCase();
  const evento = String(pegar(o, 'webhook_event_type') || pegar(b, 'webhook_event_type')).toLowerCase();
  const pedido = String(pegar(o, 'order_id', 'order_ref', 'id'));
  const plano = planoPeloNome(produto);

  try {
    await redis(['LPUSH', 'log:kiwify', JSON.stringify({ t: new Date().toISOString(), email, produto, status, evento, pedido, plano })]);
    await redis(['LTRIM', 'log:kiwify', '0', '499']);
  } catch (e) {
    return json(res, 500, { erro: 'banco indisponível' });
  }

  if (!email || !plano) return json(res, 200, { ok: true, ignorado: true });

  const aprovado = ['paid', 'approved', 'complete', 'completed'].includes(status) || evento === 'order_approved';
  const cancelado =
    ['refunded', 'chargedback', 'chargeback', 'canceled', 'cancelled'].includes(status) ||
    ['order_refunded', 'chargeback'].includes(evento);

  if (cancelado) {
    await redis(['SREM', 'aluno:' + email, plano]);
    return json(res, 200, { ok: true, acao: 'acesso removido', email, plano });
  }
  if (aprovado) {
    await redis(['SADD', 'aluno:' + email, plano]);
    if (pedido) await redis(['HSET', 'pedido:' + pedido, 'email', email, 'plano', plano, 'quando', new Date().toISOString()]);
    return json(res, 200, { ok: true, acao: 'acesso liberado', email, plano });
  }
  return json(res, 200, { ok: true, ignorado: true, status, evento });
};
