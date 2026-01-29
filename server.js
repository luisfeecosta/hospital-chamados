require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ==========================================
// CONFIGURAÇÃO DO BANCO DE DADOS
// ==========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao conectar no banco:', err.stack);
    } else {
        console.log('✅ Banco de dados conectado!');
        release();
    }
});

// ==========================================
// MIDDLEWARES
// ==========================================
app.use(cors({ origin: process.env.BASE_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// Sessão
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-padrao-mude-isso',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// ==========================================
// GOOGLE OAUTH STRATEGY
// ==========================================
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
        const googleId = profile.id;
        const email = profile.emails[0].value;
        const nome = profile.displayName;
        const foto = profile.photos[0]?.value;

        let result = await pool.query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
        
        if (result.rows.length === 0) {
            result = await pool.query(
                'INSERT INTO usuarios (google_id, email, nome, foto_url, plano, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [googleId, email, nome, foto, 'gratuito', 'ativo']
            );
            console.log(`✅ Novo usuário criado: ${email} (Plano Gratuito)`);
        } else {
            console.log(`✅ Usuário existente: ${email}`);
        }

        return done(null, result.rows[0]);
        
    } catch (error) {
        console.error('❌ Erro no OAuth:', error);
        return done(error, null);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
        done(null, result.rows[0]);
    } catch (error) {
        done(error, null);
    }
});

// ==========================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ==========================================
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autenticado', redirect: '/login.html' });
}

function checkPlan(requiredPlan) {
    return (req, res, next) => {
        const user = req.user;
        
        if (!user) {
            return res.status(401).json({ error: 'Não autenticado' });
        }

        const planos = {
            'gratuito': 1,
            'profissional': 2,
            'enterprise': 3
        };

        if (planos[user.plano] >= planos[requiredPlan]) {
            return next();
        }

        res.status(403).json({ 
            error: 'Plano insuficiente', 
            planoAtual: user.plano, 
            planoNecessario: requiredPlan 
        });
    };
}

// ==========================================
// ROTAS DE AUTENTICAÇÃO
// ==========================================

// Iniciar login com Google (com parâmetro de plano opcional)
app.get('/auth/google', (req, res, next) => {
    const plano = req.query.plano;
    if (plano) {
        req.session.planoDesejado = plano;
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// Callback do Google
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html?error=true' }),
    (req, res) => {
        const token = jwt.sign(
            { id: req.user.id, email: req.user.email, plano: req.user.plano },
            process.env.JWT_SECRET || 'secret-jwt-padrao-mude-isso',
            { expiresIn: '7d' }
        );

        res.cookie('auth_token', token, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        const planoDesejado = req.session.planoDesejado;
        delete req.session.planoDesejado;

        if (planoDesejado === 'profissional') {
            res.redirect('/upgrade.html');
        } else if (req.user.plano === 'gratuito') {
            res.redirect('/selecao.html?plano=gratuito&novo=true');
        } else {
            res.redirect('/selecao.html');
        }
    }
);

// Logout
app.get('/auth/logout', (req, res) => {
    req.logout(() => {
        res.clearCookie('auth_token');
        res.redirect('/');
    });
});

// Verificar status de autenticação
app.get('/auth/status', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            autenticado: true,
            usuario: {
                id: req.user.id,
                nome: req.user.nome,
                email: req.user.email,
                foto: req.user.foto_url,
                plano: req.user.plano,
                status: req.user.status
            }
        });
    } else {
        res.status(401).json({ autenticado: false });
    }
});

// ==========================================
// ROTAS DE PAGAMENTO - KIWIFY
// ==========================================

app.post('/api/checkout/kiwify', isAuthenticated, async (req, res) => {
    try {
        const { plano } = req.body;
        
        const precos = {
            'profissional': 99.90,
            'enterprise': 299.90
        };

        const valor = precos[plano];
        if (!valor) {
            return res.status(400).json({ error: 'Plano inválido' });
        }

        if (!process.env.KIWIFY_API_KEY || !process.env.KIWIFY_PRODUCT_ID) {
            return res.status(500).json({ 
                error: 'Gateway de pagamento não configurado',
                mensagem: 'Entre em contato com o suporte'
            });
        }

        const response = await axios.post('https://api.kiwify.com.br/v1/checkout', {
            product_id: process.env.KIWIFY_PRODUCT_ID,
            customer_email: req.user.email,
            customer_name: req.user.nome,
            amount: valor,
            metadata: {
                user_id: req.user.id,
                plano: plano
            }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.KIWIFY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        await pool.query(
            'INSERT INTO pagamentos (usuario_id, plano, valor, gateway, transacao_id, status) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, plano, valor, 'kiwify', response.data.transaction_id, 'pendente']
        );

        res.json({ 
            checkout_url: response.data.checkout_url,
            transaction_id: response.data.transaction_id
        });

    } catch (error) {
        console.error('❌ Erro Kiwify:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao criar checkout' });
    }
});

app.post('/webhook/kiwify', async (req, res) => {
    try {
        const { event, data } = req.body;

        if (event === 'purchase.approved') {
            const userId = data.metadata.user_id;
            const plano = data.metadata.plano;

            await pool.query(
                'UPDATE usuarios SET plano = $1, status = $2, atualizado_em = NOW() WHERE id = $3',
                [plano, 'ativo', userId]
            );

            await pool.query(
                'UPDATE pagamentos SET status = $1, data_pagamento = NOW() WHERE transacao_id = $2',
                ['aprovado', data.transaction_id]
            );

            console.log(`✅ Pagamento aprovado - Usuário ${userId} → Plano ${plano}`);
        }

        res.sendStatus(200);

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.sendStatus(500);
    }
});

// ==========================================
// ROTAS PROTEGIDAS
// ==========================================

// Nova senha (CORRIGIDO)
app.post('/nova-senha', isAuthenticated, async (req, res) => {
    try {
        const { nome, prioridade, especialidade } = req.body;
        const user = req.user;

        console.log('📋 Tentativa de gerar senha:', { 
            usuario: user.email, 
            nome, 
            especialidade,
            plano: user.plano 
        });

        // Validações
        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }
        
        if (!especialidade) {
            return res.status(400).json({ error: 'Especialidade é obrigatória' });
        }

        // Verifica limite do plano gratuito
        if (user.plano === 'gratuito') {
            const hoje = await pool.query(
                'SELECT COUNT(*) FROM chamadas WHERE usuario_id = $1 AND DATE(criado_em) = CURRENT_DATE',
                [user.id]
            );

            const count = parseInt(hoje.rows[0].count);
            console.log(`📊 Senhas hoje (usuário ${user.email}): ${count}/10`);

            if (count >= 10) {
                return res.status(403).json({ 
                    error: 'Limite diário atingido', 
                    mensagem: 'Plano gratuito: máximo 10 senhas por dia. Faça upgrade!' 
                });
            }
        }

        const num = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
        const senha = prioridade ? `P${num}` : `N${num}`;

        // CORRIGIDO: Inserir com usuario_id
        const result = await pool.query(
            'INSERT INTO chamadas (usuario_id, paciente_nome, senha, prioridade, status, especialidade, criado_em) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *',
            [user.id, nome.trim(), senha, !!prioridade, 'aguardando', especialidade]
        );

        console.log(`✅ Senha gerada: ${senha} - ${nome} (${especialidade}) por ${user.email}`);
        res.json(result.rows[0]);

    } catch (err) {
        console.error('❌ Erro ao criar senha:', err);
        res.status(500).json({ 
            error: 'Erro no servidor',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Listar fila (CORRIGIDO)
app.get('/pacientes-espera', isAuthenticated, async (req, res) => {
    try {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 [FILA] Requisição de:', req.user.email);
        console.log('📋 [FILA] User ID:', req.user.id);
        
        const result = await pool.query(
            "SELECT * FROM chamadas WHERE usuario_id = $1 AND status = 'aguardando' ORDER BY prioridade DESC, criado_em ASC",
            [req.user.id]
        );
        
        console.log('📋 [FILA] Pacientes encontrados:', result.rows.length);
        if (result.rows.length > 0) {
            console.log('📋 [FILA] IDs dos pacientes:', result.rows.map(r => `${r.id} (${r.paciente_nome})`));
            console.log('📋 [FILA] Usuario_id de cada paciente:', result.rows.map(r => r.usuario_id));
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Erro ao buscar fila:', err);
        res.status(500).json({ error: 'Erro ao buscar fila' });
    }
});

// Download Excel
app.get('/relatorio/download', isAuthenticated, checkPlan('profissional'), async (req, res) => {
    try {
        const chamadas = await pool.query(
            'SELECT * FROM chamadas WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 1000',
            [req.user.id]
        );

        let csv = "\ufeffData;Hora;Senha;Nome;Especialidade;Sala;Status\n";
        chamadas.rows.forEach(c => {
            const data = new Date(c.criado_em).toLocaleDateString('pt-BR');
            const hora = new Date(c.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            csv += `${data};${hora};${c.senha};${c.paciente_nome};${c.especialidade || 'N/A'};${c.sala || 'N/A'};${c.status}\n`;
        });

        const filename = `relatorio_medicall_${req.user.id}_${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);

    } catch (err) {
        console.error('❌ Erro no download:', err);
        res.status(500).json({ error: 'Erro no download' });
    }
});

// ==========================================
// ROTAS PÚBLICAS
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Rotas protegidas
app.get('/selecao.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'selecao.html')));
app.get('/triagem.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'triagem.html')));
app.get('/medico.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'medico.html')));
app.get('/painel.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get('/upgrade.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'upgrade.html')));

// ==========================================
// SOCKET.IO - ISOLAMENTO TOTAL POR SALA
// ==========================================

io.on('connection', (socket) => {
    console.log('✅ [SOCKET] Nova conexão:', socket.id);
    
    // OBRIGATÓRIO: Cliente deve se identificar para entrar em uma sala
    socket.on('join_room', async (dados) => {
        try {
            const { contexto_id, tipo, email } = dados;
            
            if (!contexto_id) {
                console.error('❌ [JOIN] Contexto_id obrigatório');
                socket.disconnect();
                return;
            }
            
            // Define a sala baseada no contexto_id (user_id)
            const roomId = `room_${contexto_id}`;
            
            // Remove de outras salas e entra na sala correta
            socket.rooms.forEach(room => {
                if (room !== socket.id) {
                    socket.leave(room);
                }
            });
            
            socket.join(roomId);
            socket.contexto_id = contexto_id;
            socket.userEmail = email;
            socket.tipo = tipo;
            
            console.log(`🏠 [JOIN] ${tipo} entrou na sala: ${roomId}`);
            console.log(`👤 [JOIN] Usuário: ${email} (ID: ${contexto_id})`);
            console.log(`📊 [JOIN] Sockets na sala: ${io.sockets.adapter.rooms.get(roomId)?.size || 0}`);
            
            // Confirma entrada na sala
            socket.emit('room_joined', { roomId, contexto_id });
            
        } catch (error) {
            console.error('❌ [JOIN] Erro:', error);
            socket.disconnect();
        }
    });
    
    // EVENTO DE CHAMADA - ISOLADO POR SALA
    socket.on('chamar_paciente', async (dados) => {
        try {
            if (!socket.contexto_id) {
                console.error('❌ [CHAMADA] Socket não identificado');
                return;
            }
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📢 [CHAMADA] De:', socket.userEmail, 'Contexto:', socket.contexto_id);
            console.log('📢 [CHAMADA] Dados:', dados);
            
            const agora = new Date();
            const horaF = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            // Atualiza banco de dados
            await pool.query(
                'UPDATE chamadas SET status = $1, sala = $2 WHERE id = $3',
                ['chamado', dados.sala, dados.id]
            );
            
            // ENVIA APENAS PARA A SALA ESPECÍFICA
            const roomId = `room_${socket.contexto_id}`;
            const payload = { ...dados, hora: horaF };
            
            console.log(`📤 [EMIT] EXCLUSIVO para sala: ${roomId}`);
            console.log(`📤 [EMIT] Payload:`, payload);
            console.log(`📊 [EMIT] Sockets na sala: ${io.sockets.adapter.rooms.get(roomId)?.size || 0}`);
            
            // CRÍTICO: Emite APENAS para a sala específica
            io.to(roomId).emit('exibir_painel', payload);
            
            console.log(`✅ [SUCESSO] Enviado para sala ${roomId}: ${dados.senha} → ${dados.sala}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
        } catch (err) {
            console.error('❌ [ERRO] Chamada:', err);
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`❌ [DISCONNECT] ${socket.userEmail || 'N/A'} (${socket.contexto_id || 'N/A'})`);
    });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏥  SISTEMA DE CHAMADAS - v2.1 (CORRIGIDO)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 Servidor: http://localhost:${PORT}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});