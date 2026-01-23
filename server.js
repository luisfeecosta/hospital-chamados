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

// --- CONFIGURAÇÃO DO BANCO DE DADOS ---
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
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/selecao', (req, res) => res.sendFile(path.join(__dirname, 'public', 'selecao.html')));
app.get('/medico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'medico.html')));
app.get('/painel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get('/triagem', (req, res) => res.sendFile(path.join(__dirname, 'public', 'triagem.html')));

// --- API: GERAR NOVA SENHA ---
app.post('/nova-senha', async (req, res) => {
    try {
        const { nome, prioridade, especialidade } = req.body;
        
        // Validações
        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }
        
        if (!especialidade) {
            return res.status(400).json({ error: 'Especialidade é obrigatória' });
        }

        const num = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
        const senha = prioridade ? `P${num}` : `N${num}`;

        const result = await pool.query(
            'INSERT INTO chamadas (paciente_nome, senha, prioridade, status, especialidade, criado_em) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
            [nome.trim(), senha, !!prioridade, 'aguardando', especialidade]
        );
        
        console.log(`📋 Nova senha gerada: ${senha} - ${nome} (${especialidade})`);
        res.json(result.rows[0]);
        
    } catch (err) {
        console.error('❌ Erro ao criar senha:', err);
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
        console.error('❌ Erro ao buscar fila:', err);
        res.status(500).json({ error: 'Erro ao buscar fila' });
    }
});

// --- API: DOWNLOAD DO RELATÓRIO EXCEL/CSV ---
app.get('/relatorio/download', async (req, res) => {
    try {
        const caminhoArquivo = path.join(__dirname, 'relatorio_atendimentos.csv');
        
        // Verifica se arquivo existe
        if (!fs.existsSync(caminhoArquivo)) {
            return res.status(404).json({ error: 'Nenhum relatório disponível ainda' });
        }
        
        // Envia o arquivo para download
        res.download(caminhoArquivo, `relatorio_medicall_${new Date().toISOString().split('T')[0]}.csv`, (err) => {
            if (err) {
                console.error('❌ Erro ao enviar arquivo:', err);
                res.status(500).json({ error: 'Erro ao baixar relatório' });
            } else {
                console.log('📥 Relatório baixado com sucesso');
            }
        });
        
    } catch (err) {
        console.error('❌ Erro no download:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// --- API: ESTATÍSTICAS (OPCIONAL) ---
app.get('/api/estatisticas', async (req, res) => {
    try {
        const aguardando = await pool.query("SELECT COUNT(*) FROM chamadas WHERE status = 'aguardando'");
        const chamados = await pool.query("SELECT COUNT(*) FROM chamadas WHERE status = 'chamado'");
        const hoje = await pool.query("SELECT COUNT(*) FROM chamadas WHERE DATE(criado_em) = CURRENT_DATE");
        
        res.json({
            aguardando: parseInt(aguardando.rows[0].count),
            chamados: parseInt(chamados.rows[0].count),
            hoje: parseInt(hoje.rows[0].count)
        });
    } catch (err) {
        console.error('❌ Erro nas estatísticas:', err);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// --- COMUNICAÇÃO EM TEMPO REAL (SOCKET.IO) ---
io.on('connection', (socket) => {
    console.log('✅ Novo dispositivo conectado:', socket.id);

    socket.on('chamar_paciente', async (dados) => {
        try {
            const agora = new Date();
            
            // Formata Data e Hora
            const dataF = agora.toLocaleDateString('pt-BR');
            const horaF = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            // 1. Atualiza status no banco
            await pool.query(
                'UPDATE chamadas SET status = $1, sala = $2 WHERE id = $3',
                ['chamado', dados.sala, dados.id]
            );

            // 2. Salva no CSV
            const caminhoArquivo = path.join(__dirname, 'relatorio_atendimentos.csv');
            const novaLinha = `${dataF};${horaF};${dados.senha};${dados.nome};${dados.especialidade || 'N/A'};${dados.sala}\n`;

            // Cria arquivo com cabeçalho se não existir
            if (!fs.existsSync(caminhoArquivo)) {
                const cabecalho = "\ufeffData;Hora;Senha;Nome;Especialidade;Sala\n";
                fs.writeFileSync(caminhoArquivo, cabecalho, 'utf8');
            }

            fs.appendFileSync(caminhoArquivo, novaLinha, 'utf8');

            // 3. Envia para todos os painéis (TVs)
            io.emit('exibir_painel', {
                ...dados,
                hora: horaF
            });

            console.log(`📢 Chamado: ${dados.senha} - ${dados.nome} → ${dados.sala}`);
            
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
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏥  SISTEMA DE CHAMADAS HOSPITALARES   ');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📍 Acesse: http://localhost:${PORT}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});