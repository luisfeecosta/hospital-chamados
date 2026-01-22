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
        
        // Criar tabela se não existir
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chamadas (
                id SERIAL PRIMARY KEY,
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
        
        // Verificar se há dados
        const result = await pool.query('SELECT COUNT(*) FROM chamadas');
        console.log(`📊 Total de registros: ${result.rows[0].count}`);
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Erro ao inicializar banco:', err);
        process.exit(1);
    }
}

initDatabase();