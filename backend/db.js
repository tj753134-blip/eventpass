// db.js - Conexão e schema do banco de dados
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway e a maioria dos serviços de nuvem exigem SSL com rejectUnauthorized: false
  // para conexões com PostgreSQL gerenciado.
  ssl: process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('rlwy.net')) ? { rejectUnauthorized: false } : false,
});

const initDB = async () => {
  const client = await pool.connect();
  try {
    // 1. Criar tipos ENUM com segurança (fora da transação principal)
    // Postgres não suporta 'IF NOT EXISTS' em CREATE TYPE.
    const tipos = [
      { nome: 'status_bilhete', def: "AS ENUM ('fora', 'dentro')" },
      { nome: 'plano_bilhete', def: "AS ENUM ('gratis', 'pro')" },
      { nome: 'status_pagamento', def: "AS ENUM ('pendente', 'confirmado', 'rejeitado', 'expirado')" },
      { nome: 'metodo_envio', def: "AS ENUM ('manual', 'api')" },
      { nome: 'tipo_plano', def: "AS ENUM ('gratis', 'pro')" }
    ];

    for (const tipo of tipos) {
      const { rowCount } = await client.query("SELECT 1 FROM pg_type WHERE typname = $1", [tipo.nome]);
      if (rowCount === 0) {
        await client.query(`CREATE TYPE ${tipo.nome} ${tipo.def}`);
      }
    }

    // 2. Iniciar transação para criação de tabelas e índices
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(150) NOT NULL,
        login VARCHAR(100) UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        telefone VARCHAR(30),
        tipo_plano tipo_plano DEFAULT 'gratis',
        is_admin BOOLEAN DEFAULT FALSE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS eventos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        nome VARCHAR(200) NOT NULL,
        tema VARCHAR(200),
        descricao TEXT,
        data_evento TIMESTAMPTZ NOT NULL,
        local VARCHAR(300),
        limite_bilhetes_gratis INTEGER DEFAULT 50,
        total_bilhetes INTEGER DEFAULT 0,
        imagem_url TEXT,
        pdf_completo_url TEXT,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bilhetes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        evento_id UUID REFERENCES eventos(id) ON DELETE CASCADE,
        usuario_id UUID REFERENCES usuarios(id),
        nome_convidado VARCHAR(150) NOT NULL,
        telefone VARCHAR(30),
        qr_code_url TEXT,
        qr_code_data TEXT UNIQUE NOT NULL,
        status status_bilhete DEFAULT 'fora',
        plano plano_bilhete DEFAULT 'gratis',
        bloqueado BOOLEAN DEFAULT FALSE,
        historico JSONB DEFAULT '[]'::jsonb,
        pdf_url TEXT,
        imagem_url TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        expira_historico_em TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
      );

      CREATE TABLE IF NOT EXISTS pagamentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID REFERENCES usuarios(id),
        bilhete_id UUID REFERENCES bilhetes(id),
        codigo_referencia VARCHAR(20) UNIQUE NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        status status_pagamento DEFAULT 'pendente',
        data_envio TIMESTAMPTZ DEFAULT NOW(),
        data_confirmacao TIMESTAMPTZ,
        data_expiracao TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 days'),
        notas TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS envios_convites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bilhete_id UUID REFERENCES bilhetes(id) ON DELETE CASCADE,
        metodo metodo_envio DEFAULT 'manual',
        destino VARCHAR(200),
        data_envio TIMESTAMPTZ DEFAULT NOW(),
        status_entrega VARCHAR(50) DEFAULT 'pendente',
        resposta_api JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_bilhetes_evento ON bilhetes(evento_id);
      CREATE INDEX IF NOT EXISTS idx_bilhetes_qr ON bilhetes(qr_code_data);
      CREATE INDEX IF NOT EXISTS idx_pagamentos_ref ON pagamentos(codigo_referencia);
      CREATE INDEX IF NOT EXISTS idx_pagamentos_status ON pagamentos(status);
    `);

    await client.query('COMMIT');
    console.log('✅ Banco de dados inicializado com sucesso');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao inicializar banco:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };
