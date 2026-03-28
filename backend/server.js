// server.js - Servidor principal Eventpass
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const { initDB, pool } = require('./db');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARES ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// ─── ROTAS API ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── CRON JOBS ───────────────────────────────────────────────────────────────

// Limpar histórico de bilhetes expirados (todo dia à meia-noite)
cron.schedule('0 0 * * *', async () => {
  try {
    const { rowCount } = await pool.query(
      "UPDATE bilhetes SET historico='[]'::jsonb WHERE expira_historico_em < NOW()"
    );
    console.log(`🧹 Histórico limpo: ${rowCount} bilhetes`);
  } catch (err) {
    console.error('Erro no cron de limpeza de histórico:', err.message);
  }
});

// Expirar pagamentos pendentes após 2 dias (a cada hora)
cron.schedule('0 * * * *', async () => {
  try {
    const { rowCount } = await pool.query(
      "UPDATE pagamentos SET status='expirado' WHERE status='pendente' AND data_expiracao < NOW()"
    );
    if (rowCount > 0) console.log(`⏰ ${rowCount} pagamentos expirados`);
  } catch (err) {
    console.error('Erro no cron de expiração de pagamentos:', err.message);
  }
});

// ─── INICIAR SERVIDOR ────────────────────────────────────────────────────────
const start = async () => {
  try {
    const requiredEnv = ['DATABASE_URL', 'JWT_SECRET', 'CLOUDINARY_CLOUD_NAME'];
    const missing = requiredEnv.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.error('###########################################################');
      console.error('❌ ERRO DE CONFIGURAÇÃO DETECTADO');
      console.error(`⚠️  Variáveis faltando no Railway: ${missing.join(', ')}`);
      console.error('💡 Adicione estas variáveis na aba "Variables" do serviço.');
      console.error('###########################################################');
      process.exit(1);
    }

    console.log('⏳ Conectando ao banco de dados PostgreSQL...');
    await initDB();

    app.listen(PORT, () => {
      console.log(`\n🎟️  EVENTPASS ONLINE - Porta: ${PORT}`);
      console.log(`📡  Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar servidor:', err.message);
    process.exit(1);
  }
};

start().catch(err => {
  console.error('Erro ao iniciar servidor:', err);
  process.exit(1);
});
