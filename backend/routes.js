// routes.js - Todas as rotas da API
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { v4: uuid } = require('uuid');
const { pool } = require('./db');
const { auth, adminOnly, uploadEvento, uploadConvite, uploadPDFAdmin, cloudinary, deletarArquivoCloudinary } = require('./middleware');

// ─── UTILIDADES ─────────────────────────────────────────────────────────────

const gerarCodigoRef = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const enviarWhatsApp = async (telefone, mensagem) => {
  if (!process.env.WHATSAPP_API_TOKEN) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: telefone, type: 'text', text: { body: mensagem } }),
    });
    return res.ok;
  } catch { return false; }
};

// ─── AUTH ────────────────────────────────────────────────────────────────────

// POST /api/auth/registro
router.post('/auth/registro', async (req, res) => {
  const { nome, login, senha, telefone } = req.body;
  if (!nome || !login || !senha) return res.status(400).json({ erro: 'Campos obrigatórios: nome, login, senha' });
  try {
    const existe = await pool.query('SELECT id FROM usuarios WHERE login = $1', [login]);
    if (existe.rows.length) return res.status(409).json({ erro: 'Login já em uso' });
    const senha_hash = await bcrypt.hash(senha, 12);
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nome, login, senha_hash, telefone) VALUES ($1,$2,$3,$4) RETURNING id, nome, login, tipo_plano, is_admin',
      [nome, login, senha_hash, telefone]
    );
    const token = jwt.sign(rows[0], process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, usuario: rows[0] });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  const { login, senha } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE login = $1', [login]);
    if (!rows.length || !await bcrypt.compare(senha, rows[0].senha_hash))
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    const { senha_hash, ...user } = rows[0];
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, usuario: user });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/auth/perfil
router.get('/auth/perfil', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id,nome,login,telefone,tipo_plano,is_admin,criado_em FROM usuarios WHERE id=$1', [req.user.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/auth/perfil
router.put('/auth/perfil', auth, async (req, res) => {
  const { nome, telefone, senha } = req.body;
  try {
    let senha_hash;
    if (senha) senha_hash = await bcrypt.hash(senha, 12);
    await pool.query(
      `UPDATE usuarios SET nome=COALESCE($1,nome), telefone=COALESCE($2,telefone), 
       senha_hash=COALESCE($3,senha_hash), atualizado_em=NOW() WHERE id=$4`,
      [nome, telefone, senha_hash, req.user.id]
    );
    res.json({ mensagem: 'Perfil atualizado com sucesso' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ─── EVENTOS ─────────────────────────────────────────────────────────────────

// GET /api/eventos
router.get('/eventos', auth, async (req, res) => {
  try {
    const isAdmin = req.user.is_admin;
    const query = isAdmin
      ? 'SELECT e.*, u.nome as organizador FROM eventos e JOIN usuarios u ON e.usuario_id=u.id ORDER BY e.data_evento DESC'
      : 'SELECT e.*, u.nome as organizador FROM eventos e JOIN usuarios u ON e.usuario_id=u.id WHERE e.usuario_id=$1 ORDER BY e.data_evento DESC';
    const { rows } = await pool.query(query, isAdmin ? [] : [req.user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/eventos/publicos (sem auth para listagem pública)
router.get('/eventos/publicos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,nome,tema,descricao,data_evento,local,imagem_url,limite_bilhetes_gratis FROM eventos WHERE ativo=TRUE AND data_evento > NOW() ORDER BY data_evento ASC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/eventos/:id
router.get('/eventos/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.nome as organizador,
        (SELECT COUNT(*) FROM bilhetes WHERE evento_id=e.id) as total_bilhetes,
        (SELECT COUNT(*) FROM bilhetes WHERE evento_id=e.id AND status='dentro') as dentro_agora
       FROM eventos e JOIN usuarios u ON e.usuario_id=u.id WHERE e.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!req.user.is_admin && rows[0].usuario_id !== req.user.id) {
      const { pdf_completo_url, ...pub } = rows[0];
      return res.json(pub);
    }
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/eventos
router.post('/eventos', auth, uploadEvento.single('imagem'), async (req, res) => {
  const { nome, tema, descricao, data_evento, local, limite_bilhetes_gratis } = req.body;
  if (!nome || !data_evento) return res.status(400).json({ erro: 'Nome e data são obrigatórios' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO eventos (usuario_id,nome,tema,descricao,data_evento,local,limite_bilhetes_gratis,imagem_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, nome, tema, descricao, data_evento, local, parseInt(limite_bilhetes_gratis) || 50, req.file?.path]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/eventos/:id
router.put('/eventos/:id', auth, uploadEvento.single('imagem'), async (req, res) => {
  const { nome, tema, descricao, data_evento, local, limite_bilhetes_gratis, ativo } = req.body;
  try {
    const { rows: ev } = await pool.query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!ev.length) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!req.user.is_admin && ev[0].usuario_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });
    if (req.file && ev[0].imagem_url) await deletarArquivoCloudinary(ev[0].imagem_url);
    await pool.query(
      `UPDATE eventos SET nome=COALESCE($1,nome), tema=COALESCE($2,tema), descricao=COALESCE($3,descricao),
       data_evento=COALESCE($4,data_evento), local=COALESCE($5,local),
       limite_bilhetes_gratis=COALESCE($6,limite_bilhetes_gratis),
       imagem_url=COALESCE($7,imagem_url), ativo=COALESCE($8,ativo), atualizado_em=NOW() WHERE id=$9`,
      [nome, tema, descricao, data_evento, local, limite_bilhetes_gratis, req.file?.path, ativo, req.params.id]
    );
    res.json({ mensagem: 'Evento atualizado' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/eventos/:id
router.delete('/eventos/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!req.user.is_admin && rows[0].usuario_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });
    if (rows[0].imagem_url) await deletarArquivoCloudinary(rows[0].imagem_url);
    if (rows[0].pdf_completo_url) await deletarArquivoCloudinary(rows[0].pdf_completo_url, 'raw');
    await pool.query('DELETE FROM eventos WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Evento excluído' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/eventos/:id/pdf-completo (ADM)
router.post('/eventos/:id/pdf-completo', auth, adminOnly, uploadPDFAdmin.single('pdf'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT pdf_completo_url FROM eventos WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (rows[0].pdf_completo_url) await deletarArquivoCloudinary(rows[0].pdf_completo_url, 'raw');
    await pool.query('UPDATE eventos SET pdf_completo_url=$1 WHERE id=$2', [req.file.path, req.params.id]);
    res.json({ url: req.file.path });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/eventos/:id/pdf-completo (ADM)
router.delete('/eventos/:id/pdf-completo', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT pdf_completo_url FROM eventos WHERE id=$1', [req.params.id]);
    if (rows[0]?.pdf_completo_url) await deletarArquivoCloudinary(rows[0].pdf_completo_url, 'raw');
    await pool.query('UPDATE eventos SET pdf_completo_url=NULL WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'PDF removido' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ─── BILHETES ────────────────────────────────────────────────────────────────

// GET /api/bilhetes (meus bilhetes)
router.get('/bilhetes', auth, async (req, res) => {
  try {
    const query = req.user.is_admin
      ? `SELECT b.*, e.nome as evento_nome, e.data_evento FROM bilhetes b JOIN eventos e ON b.evento_id=e.id ORDER BY b.criado_em DESC`
      : `SELECT b.*, e.nome as evento_nome, e.data_evento FROM bilhetes b JOIN eventos e ON b.evento_id=e.id WHERE b.usuario_id=$1 ORDER BY b.criado_em DESC`;
    const { rows } = await pool.query(query, req.user.is_admin ? [] : [req.user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/bilhetes/evento/:eventoId
router.get('/bilhetes/evento/:eventoId', auth, async (req, res) => {
  try {
    const { rows: ev } = await pool.query('SELECT usuario_id FROM eventos WHERE id=$1', [req.params.eventoId]);
    if (!ev.length) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!req.user.is_admin && ev[0].usuario_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });
    const { rows } = await pool.query('SELECT * FROM bilhetes WHERE evento_id=$1 ORDER BY criado_em DESC', [req.params.eventoId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/bilhetes - criar bilhete
router.post('/bilhetes', auth, async (req, res) => {
  const { evento_id, nome_convidado, telefone, plano } = req.body;
  if (!evento_id || !nome_convidado) return res.status(400).json({ erro: 'evento_id e nome_convidado são obrigatórios' });
  if (plano === 'pro' && !telefone) return res.status(400).json({ erro: 'Telefone obrigatório no plano Pro' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar evento e limites
    const { rows: ev } = await client.query('SELECT * FROM eventos WHERE id=$1 AND ativo=TRUE', [evento_id]);
    if (!ev.length) return res.status(404).json({ erro: 'Evento não encontrado ou inativo' });

    if (plano !== 'pro') {
      const { rows: contagem } = await client.query(
        "SELECT COUNT(*) FROM bilhetes WHERE evento_id=$1 AND plano='gratis'", [evento_id]
      );
      if (parseInt(contagem[0].count) >= ev[0].limite_bilhetes_gratis)
        return res.status(400).json({ erro: 'Limite de bilhetes gratuitos atingido. Faça upgrade para Pro.' });
    }

    // Gerar QR code único
    const qrData = `EVENTPASS-${uuid()}`;
    const qrBuffer = await QRCode.toBuffer(qrData, { width: 300, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } });

    // Upload QR para Cloudinary
    const qrUpload = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'eventpass/qrcodes', public_id: qrData, format: 'png' },
        (err, result) => err ? reject(err) : resolve(result)
      ).end(qrBuffer);
    });

    const { rows } = await client.query(
      `INSERT INTO bilhetes (evento_id,usuario_id,nome_convidado,telefone,qr_code_data,qr_code_url,plano)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [evento_id, req.user.id, nome_convidado, telefone, qrData, qrUpload.secure_url, plano || 'gratis']
    );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: err.message });
  } finally { client.release(); }
});

// POST /api/bilhetes/:id/upload-convite
router.post('/bilhetes/:id/upload-convite', auth, uploadConvite.single('arquivo'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bilhetes WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Bilhete não encontrado' });
    if (!req.user.is_admin && rows[0].usuario_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });

    const campo = req.file.mimetype === 'application/pdf' ? 'pdf_url' : 'imagem_url';
    if (rows[0][campo]) await deletarArquivoCloudinary(rows[0][campo], req.file.mimetype === 'application/pdf' ? 'raw' : 'image');

    await pool.query(`UPDATE bilhetes SET ${campo}=$1 WHERE id=$2`, [req.file.path, req.params.id]);

    // Registrar envio
    await pool.query(
      'INSERT INTO envios_convites (bilhete_id,metodo,status_entrega) VALUES ($1,$2,$3)',
      [req.params.id, 'manual', 'disponivel']
    );

    res.json({ url: req.file.path, tipo: campo });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/bilhetes/:id/enviar-convite (Pro - WhatsApp)
router.post('/bilhetes/:id/enviar-convite', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT b.*, e.nome as evento_nome FROM bilhetes b JOIN eventos e ON b.evento_id=e.id WHERE b.id=$1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Bilhete não encontrado' });
    const b = rows[0];
    if (b.plano !== 'pro') return res.status(403).json({ erro: 'Envio automático disponível apenas no plano Pro' });
    if (!b.telefone) return res.status(400).json({ erro: 'Bilhete sem telefone vinculado' });

    const mensagem = `🎟️ Seu bilhete para *${b.evento_nome}*!\n\nConvidado: ${b.nome_convidado}\nCódigo QR: ${b.qr_code_data}\n\nApresente este código na entrada. Boa festa! 🎉`;
    const enviado = await enviarWhatsApp(b.telefone, mensagem);

    await pool.query(
      'INSERT INTO envios_convites (bilhete_id,metodo,destino,status_entrega) VALUES ($1,$2,$3,$4)',
      [b.id, 'api', b.telefone, enviado ? 'enviado' : 'erro']
    );

    res.json({ enviado, mensagem: enviado ? 'Convite enviado via WhatsApp' : 'Erro no envio, verifique configurações' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/bilhetes/:id/bloquear (ADM)
router.put('/bilhetes/:id/bloquear', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('UPDATE bilhetes SET bloqueado=$1 WHERE id=$2', [req.body.bloqueado, req.params.id]);
    res.json({ mensagem: req.body.bloqueado ? 'Bilhete bloqueado' : 'Bilhete liberado' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/bilhetes/:id
router.delete('/bilhetes/:id', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bilhetes WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Bilhete não encontrado' });
    if (rows[0].qr_code_url) await deletarArquivoCloudinary(rows[0].qr_code_url);
    if (rows[0].pdf_url) await deletarArquivoCloudinary(rows[0].pdf_url, 'raw');
    if (rows[0].imagem_url) await deletarArquivoCloudinary(rows[0].imagem_url);
    await pool.query('DELETE FROM bilhetes WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Bilhete excluído' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ─── CHECK-IN / QR CODE ──────────────────────────────────────────────────────

// POST /api/checkin - validar QR e registrar entrada/saída
router.post('/checkin', auth, async (req, res) => {
  const { qr_code_data } = req.body;
  if (!qr_code_data) return res.status(400).json({ erro: 'QR code necessário' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT b.*, e.nome as evento_nome FROM bilhetes b JOIN eventos e ON b.evento_id=e.id WHERE b.qr_code_data=$1 FOR UPDATE',
      [qr_code_data]
    );

    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Bilhete não encontrado', valido: false }); }
    const b = rows[0];

    if (b.bloqueado) { await client.query('ROLLBACK'); return res.status(403).json({ erro: 'Bilhete bloqueado', valido: false }); }

    // Verificar fraude no plano Pro (telefone vinculado)
    if (b.plano === 'pro' && req.body.telefone && b.telefone !== req.body.telefone) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'Telefone não confere com o titular do bilhete', valido: false, fraude: true });
    }

    const novoStatus = b.status === 'fora' ? 'dentro' : 'fora';
    const acao = b.status === 'fora' ? (b.historico.length === 0 ? 'entrada' : 'reentrada') : 'saida';

    const novoHistorico = [...b.historico, { acao, timestamp: new Date().toISOString(), operador: req.user.id }];

    await client.query(
      'UPDATE bilhetes SET status=$1, historico=$2 WHERE id=$3',
      [novoStatus, JSON.stringify(novoHistorico), b.id]
    );

    await client.query('COMMIT');
    res.json({
      valido: true,
      acao,
      status: novoStatus,
      bilhete: { id: b.id, nome_convidado: b.nome_convidado, evento_nome: b.evento_nome, plano: b.plano },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: err.message });
  } finally { client.release(); }
});

// ─── PAGAMENTOS ──────────────────────────────────────────────────────────────

// POST /api/pagamentos - solicitar pagamento Pro
router.post('/pagamentos', auth, async (req, res) => {
  const { bilhete_id, valor } = req.body;
  if (!bilhete_id || !valor) return res.status(400).json({ erro: 'bilhete_id e valor são obrigatórios' });
  try {
    const { rows: b } = await pool.query('SELECT * FROM bilhetes WHERE id=$1 AND usuario_id=$2', [bilhete_id, req.user.id]);
    if (!b.length) return res.status(404).json({ erro: 'Bilhete não encontrado' });

    let codigoRef;
    let tentativas = 0;
    do {
      codigoRef = gerarCodigoRef();
      const { rows } = await pool.query('SELECT id FROM pagamentos WHERE codigo_referencia=$1', [codigoRef]);
      if (!rows.length) break;
      tentativas++;
    } while (tentativas < 10);

    const { rows } = await pool.query(
      'INSERT INTO pagamentos (usuario_id,bilhete_id,codigo_referencia,valor) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, bilhete_id, codigoRef, valor]
    );

    res.status(201).json({
      ...rows[0],
      instrucoes: `Envie ${valor} AOA via Express para o número ${process.env.ADMIN_WHATSAPP}. Na mensagem inclua: LOGIN: ${req.user.login} | REF: ${codigoRef}`,
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/pagamentos
router.get('/pagamentos', auth, async (req, res) => {
  try {
    const query = req.user.is_admin
      ? `SELECT p.*, u.nome as usuario_nome, u.login, b.nome_convidado, e.nome as evento_nome
         FROM pagamentos p JOIN usuarios u ON p.usuario_id=u.id JOIN bilhetes b ON p.bilhete_id=b.id
         JOIN eventos e ON b.evento_id=e.id ORDER BY p.data_envio DESC`
      : `SELECT p.*, b.nome_convidado, e.nome as evento_nome
         FROM pagamentos p JOIN bilhetes b ON p.bilhete_id=b.id JOIN eventos e ON b.evento_id=e.id
         WHERE p.usuario_id=$1 ORDER BY p.data_envio DESC`;
    const { rows } = await pool.query(query, req.user.is_admin ? [] : [req.user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/pagamentos/:id/confirmar (ADM)
router.put('/pagamentos/:id/confirmar', auth, adminOnly, async (req, res) => {
  const { acao, notas } = req.body; // acao: 'confirmar' | 'rejeitar'
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM pagamentos WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Pagamento não encontrado' });

    const status = acao === 'confirmar' ? 'confirmado' : 'rejeitado';
    await client.query(
      'UPDATE pagamentos SET status=$1, data_confirmacao=NOW(), notas=$2 WHERE id=$3',
      [status, notas, req.params.id]
    );

    // Se confirmado, fazer upgrade do bilhete para Pro
    if (status === 'confirmado') {
      await client.query('UPDATE bilhetes SET plano=$1, bloqueado=FALSE WHERE id=$2', ['pro', rows[0].bilhete_id]);
    }

    await client.query('COMMIT');
    res.json({ mensagem: `Pagamento ${status}` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: err.message });
  } finally { client.release(); }
});

// ─── DASHBOARD ADM ───────────────────────────────────────────────────────────

// GET /api/admin/dashboard
router.get('/admin/dashboard', auth, adminOnly, async (req, res) => {
  try {
    const [eventos, bilhetes, usuarios, pagamentos] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE ativo) as ativos FROM eventos'),
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE plano='pro') as pro,
                  COUNT(*) FILTER (WHERE status='dentro') as dentro,
                  COUNT(*) FILTER (WHERE bloqueado) as bloqueados FROM bilhetes`),
      pool.query('SELECT COUNT(*) as total FROM usuarios WHERE is_admin=FALSE'),
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='pendente') as pendentes,
                  COUNT(*) FILTER (WHERE status='confirmado') as confirmados,
                  SUM(valor) FILTER (WHERE status='confirmado') as receita FROM pagamentos`),
    ]);

    const { rows: entradas } = await pool.query(`
      SELECT e.nome as evento, COUNT(b.id) as total_bilhetes,
        COUNT(b.id) FILTER (WHERE b.status='dentro') as dentro
      FROM eventos e LEFT JOIN bilhetes b ON e.id=b.evento_id
      WHERE e.ativo=TRUE GROUP BY e.id, e.nome ORDER BY total_bilhetes DESC LIMIT 5
    `);

    res.json({
      eventos: eventos.rows[0],
      bilhetes: bilhetes.rows[0],
      usuarios: usuarios.rows[0],
      pagamentos: pagamentos.rows[0],
      top_eventos: entradas,
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/admin/usuarios
router.get('/admin/usuarios', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,nome,login,telefone,tipo_plano,is_admin,criado_em FROM usuarios ORDER BY criado_em DESC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/admin/usuarios/:id/plano
router.put('/admin/usuarios/:id/plano', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('UPDATE usuarios SET tipo_plano=$1 WHERE id=$2', [req.body.tipo_plano, req.params.id]);
    res.json({ mensagem: 'Plano atualizado' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/admin/relatorio/:eventoId
router.get('/admin/relatorio/:eventoId', auth, adminOnly, async (req, res) => {
  try {
    const { rows: ev } = await pool.query('SELECT * FROM eventos WHERE id=$1', [req.params.eventoId]);
    if (!ev.length) return res.status(404).json({ erro: 'Evento não encontrado' });

    const [bilhetes, pagamentos, envios] = await Promise.all([
      pool.query('SELECT * FROM bilhetes WHERE evento_id=$1 ORDER BY criado_em', [req.params.eventoId]),
      pool.query(`SELECT p.*, u.login FROM pagamentos p JOIN usuarios u ON p.usuario_id=u.id
                  JOIN bilhetes b ON p.bilhete_id=b.id WHERE b.evento_id=$1`, [req.params.eventoId]),
      pool.query(`SELECT ec.*, b.nome_convidado FROM envios_convites ec JOIN bilhetes b ON ec.bilhete_id=b.id
                  WHERE b.evento_id=$1`, [req.params.eventoId]),
    ]);

    res.json({
      evento: ev[0],
      bilhetes: bilhetes.rows,
      pagamentos: pagamentos.rows,
      envios: envios.rows,
      resumo: {
        total_bilhetes: bilhetes.rowCount,
        pro: bilhetes.rows.filter(b => b.plano === 'pro').length,
        gratis: bilhetes.rows.filter(b => b.plano === 'gratis').length,
        dentro: bilhetes.rows.filter(b => b.status === 'dentro').length,
        bloqueados: bilhetes.rows.filter(b => b.bloqueado).length,
      },
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
