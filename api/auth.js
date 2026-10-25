// Login da área do aluno: envia código por e-mail, confere o código e cria a sessão
const crypto = require('crypto');
const {
  normEmail, emailValido, hmac, redis, planosDoEmail, criarSessao, cookieSessao, cookieSair, json,
} = require('./_lib');

async function enviarCodigo(email, codigo) {
  const nodemailer = require('nodemailer');
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('E-mail de envio não configurado');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass: pass.replace(/\s+/g, '') } });
  const html = `<!doctype html><html><body style="margin:0;background:#0B0C0E;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0B0C0E;padding:32px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#1A1D22;border-radius:16px;padding:32px;color:#F4F5F7">
<tr><td style="font-size:22px;font-weight:bold;letter-spacing:1px">TREINOS<span style="color:#C8F250">FIT</span></td></tr>
<tr><td style="padding-top:20px;font-size:16px;color:#A9AFB8">Seu código para entrar na Área do aluno:</td></tr>
<tr><td style="padding:18px 0;font-size:40px;font-weight:bold;letter-spacing:10px;color:#C8F250">${codigo}</td></tr>
<tr><td style="font-size:14px;color:#A9AFB8">O código vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.</td></tr>
</table></td></tr></table></body></html>`;
  await t.sendMail({
    from: `"TreinosFit" <${user}>`,
    to: email,
    subject: `${codigo} é o seu código de acesso TreinosFit`,
    text: `Seu código para entrar na Área do aluno TreinosFit: ${codigo}\nO código vale por 10 minutos.`,
    html,
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { erro: 'método não permitido' });
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (e) { b = {}; }
  }
  b = b || {};
  const acao = String(b.acao || '');

  if (acao === 'sair') {
    res.setHeader('Set-Cookie', cookieSair());
    return json(res, 200, { ok: true });
  }

  const email = normEmail(b.email);
  if (!emailValido(email)) return json(res, 400, { erro: 'Digite um e-mail válido.' });

  try {
    if (acao === 'enviar') {
      const planos = await planosDoEmail(email);
      if (!planos.length) {
        return json(res, 404, {
          erro: 'Não encontramos nenhuma compra com esse e-mail. Use o mesmo e-mail que você usou na compra.',
        });
      }
      const n = await redis(['INCR', 'limite:' + email]);
      if (n === 1) await redis(['EXPIRE', 'limite:' + email, '900']);
      if (n > 5) return json(res, 429, { erro: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
      const codigo = String(crypto.randomInt(100000, 1000000));
      await redis(['SET', 'codigo:' + email, hmac('codigo:' + email + ':' + codigo), 'EX', '600']);
      await redis(['DEL', 'tentativas:' + email]);
      await enviarCodigo(email, codigo);
      return json(res, 200, { ok: true });
    }

    if (acao === 'entrar') {
      const codigo = String(b.codigo || '').replace(/\D/g, '');
      const t = await redis(['INCR', 'tentativas:' + email]);
      if (t === 1) await redis(['EXPIRE', 'tentativas:' + email, '600']);
      if (t > 6) return json(res, 429, { erro: 'Muitas tentativas. Peça um novo código.' });
      const salvo = await redis(['GET', 'codigo:' + email]);
      if (!salvo || codigo.length !== 6 || salvo !== hmac('codigo:' + email + ':' + codigo)) {
        return json(res, 401, { erro: 'Código incorreto ou vencido.' });
      }
      await redis(['DEL', 'codigo:' + email, 'tentativas:' + email]);
      res.setHeader('Set-Cookie', cookieSessao(criarSessao(email)));
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { erro: 'ação inválida' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { erro: 'Não foi possível concluir agora. Tente de novo em instantes.' });
  }
};
