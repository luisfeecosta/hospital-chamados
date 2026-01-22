require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// --- CONFIGURAÇÃO DO BANCO DE DADOS (CORRIGIDA) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false
});

// Teste de conexão
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao conectar no banco:', err.stack);
    } else {
        console.log('✅ Banco de dados conectado!');
        release();
    }
});

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- ROTAS PARA SERVIR OS HTMLS ---
app.get('/medico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'medico.html')));
app.get('/painel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get('/triagem', (req, res) => res.sendFile(path.join(__dirname, 'public', 'triagem.html')));

// --- API: GERAR NOVA SENHA ---
app.post('/nova-senha', async (req, res) => {
    try {
        const { nome, prioridade, especialidade } = req.body;
        if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

        const num = String(Math.floor(Math.random() * 99)).padStart(2, '0');
        const senha = prioridade ? `P${num}` : `N${num}`;
        const esp = especialidade || 'Clínico Geral';

        const result = await pool.query(
            'INSERT INTO chamadas (paciente_nome, senha, prioridade, status, especialidade, criado_em) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
            [nome.trim(), senha, !!prioridade, 'aguardando', esp]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao criar senha:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// --- API: LISTAR FILA ---
app.get('/pacientes-espera', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM chamadas WHERE status = 'aguardando' ORDER BY prioridade DESC, criado_em ASC"
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar fila:', err);
        res.status(500).json({ error: 'Erro ao buscar fila' });
    }
});

// --- COMUNICAÇÃO EM TEMPO REAL ---
io.on('connection', (socket) => {
    console.log('✅ Novo dispositivo conectado:', socket.id);

    socket.on('chamar_paciente', async (dados) => {
        try {
            const agora = new Date();
            
            // Formata a Data (Ex: 19/12/2025)
            const dataF = agora.toLocaleDateString('pt-BR');
            
            // Formata a Hora (Ex: 09:30)
            const horaF = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            // 1. Atualiza no Banco de Dados
            await pool.query(
                'UPDATE chamadas SET status = $1, sala = $2 WHERE id = $3',
                ['chamado', dados.sala, dados.id]
            );

            // 2. CONFIGURAÇÃO DO ARQUIVO CSV
            const caminhoArquivo = path.join(__dirname, 'relatorio_atendimentos.csv');
            
            // Cria a linha incluindo a DATA como primeira coluna
            const novaLinha = `${dataF};${horaF};${dados.senha};${dados.nome};${dados.especialidade};${dados.sala}\n`;

            // BOM (Byte Order Mark) para o Excel ler UTF-8 corretamente
            if (!fs.existsSync(caminhoArquivo)) {
                const cabecalho = "\ufeffData;Hora;Senha;Nome;Especialidade;Sala\n";
                fs.writeFileSync(caminhoArquivo, cabecalho, 'utf8');
            }

            // Adiciona a nova linha
            fs.appendFileSync(caminhoArquivo, novaLinha, 'utf8');

            // 3. Envia para a TV
            io.emit('exibir_painel', {
                ...dados,
                hora: horaF
            });

            console.log(`📋 Paciente ${dados.nome} chamado para ${dados.sala}`);
        } catch (err) {
            console.error('❌ Erro ao processar chamada:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Dispositivo desconectado:', socket.id);
    });
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏥  SISTEMA DE CHAMADAS HOSPITALARES  ');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📍 Acesse: http://localhost:${PORT}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});