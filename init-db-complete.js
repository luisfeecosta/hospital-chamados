require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false
});

async function initDatabase() {
    try {
        console.log('🔄 Conectando ao banco...');
        
        // Criar tabela de usuários
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                google_id VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) NOT NULL,
                nome VARCHAR(255) NOT NULL,
                foto_url TEXT,
                plano VARCHAR(50) DEFAULT 'gratuito',
                status VARCHAR(50) DEFAULT 'ativo',
                criado_em TIMESTAMP DEFAULT NOW(),
                atualizado_em TIMESTAMP DEFAULT NOW()
            )
        `);
        
        console.log('✅ Tabela "usuarios" criada/verificada com sucesso!');
        
        // Criar tabela de chamadas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chamadas (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id),
                paciente_nome VARCHAR(255) NOT NULL,
                senha VARCHAR(10) NOT NULL,
                prioridade BOOLEAN DEFAULT FALSE,
                status VARCHAR(50) DEFAULT 'aguardando',
                especialidade VARCHAR(100) DEFAULT 'Clínico Geral',
                sala VARCHAR(50),
                criado_em TIMESTAMP DEFAULT NOW(),
                atualizado_em TIMESTAMP DEFAULT NOW()
            )
        `);
        
        console.log('✅ Tabela "chamadas" criada/verificada com sucesso!');
        
        // Criar tabela de pagamentos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pagamentos (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id),
                plano VARCHAR(50) NOT NULL,
                valor DECIMAL(10,2) NOT NULL,
                gateway VARCHAR(50) NOT NULL,
                transacao_id VARCHAR(255) UNIQUE,
                status VARCHAR(50) DEFAULT 'pendente',
                data_pagamento TIMESTAMP,
                criado_em TIMESTAMP DEFAULT NOW()
            )
        `);
        
        console.log('✅ Tabela "pagamentos" criada/verificada com sucesso!');
        
        // Verificar se há dados
        const usuarios = await pool.query('SELECT COUNT(*) FROM usuarios');
        const chamadas = await pool.query('SELECT COUNT(*) FROM chamadas');
        
        console.log(`📈 Usuários: ${usuarios.rows[0].count}`);
        console.log(`📈 Chamadas: ${chamadas.rows[0].count}`);
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Erro ao inicializar banco:', err);
        process.exit(1);
    }
}

initDatabase();