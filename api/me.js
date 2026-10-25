// Retorna os treinos que o aluno logado comprou
const { NIVEIS, PLANOS, lerSessao, planosDoEmail, json } = require('./_lib');

module.exports = async (req, res) => {
  const email = lerSessao(req);
  if (!email) return json(res, 401, { erro: 'não logado' });
  try {
    const ids = await planosDoEmail(email);
    const ordem = ['f3', 'f4', 'f5', 'm3', 'm4', 'm5', 'ind'];
    const planos = ordem
      .filter((id) => ids.includes(id))
      .map((id) => ({ id, ...PLANOS[id], niveis: id === 'ind' ? [] : NIVEIS }));
    return json(res, 200, { email, planos, whatsapp: process.env.WHATSAPP_ESPECIALISTA || '' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { erro: 'Não foi possível carregar seus treinos agora.' });
  }
};
