// Entrega o PDF do treino só para quem comprou aquele plano
const { PLANOS, lerSessao, planosDoEmail, arquivo, json } = require('./_lib');

module.exports = async (req, res) => {
  const email = lerSessao(req);
  if (!email) return json(res, 401, { erro: 'não logado' });
  const q = req.query || {};
  const plano = String(q.plano || '');
  const nivel = String(q.nivel || '');
  if (!PLANOS[plano] || plano === 'ind' || !['1', '2', '3'].includes(nivel)) return json(res, 400, { erro: 'treino inválido' });
  try {
    const meus = await planosDoEmail(email);
    if (!meus.includes(plano)) return json(res, 403, { erro: 'Você não tem acesso a este treino.' });
    const a = arquivo(plano, nivel);
    if (!a) return json(res, 404, { erro: 'treino não encontrado' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${q.baixar ? 'attachment' : 'inline'}; filename="${a.nome}"`);
    res.setHeader('Content-Length', String(a.buf.length));
    return res.end(a.buf);
  } catch (e) {
    console.error(e);
    return json(res, 500, { erro: 'Não foi possível abrir o treino agora.' });
  }
};
