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
app.use(cors({ 
    origin: process.env.NODE_ENV === 'production' 
        ? 'https://hospital-chamados.onrender.com' 
        : 'http://localhost:3000', 
    credentials: true 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// Sessão
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
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

        // Verifica se usuário já existe
        let result = await pool.query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
        
        if (result.rows.length === 0) {
            // Cria novo usuário com plano gratuito
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
    res.redirect('/login.html');
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
    // Salva plano desejado na sessão
    if (plano) {
        req.session.planoDesejado = plano;
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// Callback do Google
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html?error=true' }),
    (req, res) => {
        // Cria token JWT
        const token = jwt.sign(
            { id: req.user.id, email: req.user.email, plano: req.user.plano },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Salva token em cookie
        res.cookie('auth_token', token, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
        });

        // Verifica se tinha plano desejado
        const planoDesejado = req.session.planoDesejado;
        delete req.session.planoDesejado;

        if (planoDesejado === 'profissional') {
            // Queria plano profissional → vai para upgrade
            res.redirect('/upgrade.html');
        } else if (req.user.plano === 'gratuito') {
            // Novo usuário gratuito → vai para seleção
            res.redirect('/selecao.html?plano=gratuito&novo=true');
        } else {
            // Usuário existente → vai para seleção
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
        res.json({ autenticado: false });
    }
});

// ==========================================
// ROTAS DE PAGAMENTO - KIWIFY
// ==========================================

// Criar checkout Kiwify
app.post('/api/checkout/kiwify', isAuthenticated, async (req, res) => {
    try {
        const { plano } = req.body; // 'profissional' ou 'enterprise'
        
        // Preços
        const precos = {
            'profissional': 99.90,
            'enterprise': 299.90
        };

        const valor = precos[plano];
        if (!valor) {
            return res.status(400).json({ error: 'Plano inválido' });
        }

        // Chama API da Kiwify
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

        // Salva intenção de pagamento
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

// Webhook Kiwify (confirmação de pagamento)
app.post('/webhook/kiwify', async (req, res) => {
    try {
        const { event, data } = req.body;

        // Verifica assinatura do webhook
        const signature = req.headers['x-kiwify-signature'];
        // TODO: Validar assinatura com KIWIFY_WEBHOOK_SECRET

        if (event === 'purchase.approved') {
            const userId = data.metadata.user_id;
            const plano = data.metadata.plano;

            // Atualiza plano do usuário
            await pool.query(
                'UPDATE usuarios SET plano = $1, status = $2, atualizado_em = NOW() WHERE id = $3',
                [plano, 'ativo', userId]
            );

            // Atualiza pagamento
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
// ROTAS DE PAGAMENTO - PAGBANK (ALTERNATIVA)
// ==========================================

app.post('/api/checkout/pagbank', isAuthenticated, async (req, res) => {
    try {
        const { plano } = req.body;
        
        const precos = {
            'profissional': 99.90,
            'enterprise': 299.90
        };

        const valor = precos[plano];

        // API do PagBank/PagSeguro
        const response = await axios.post('https://ws.pagseguro.uol.com.br/v2/checkout', 
            new URLSearchParams({
                email: process.env.PAGBANK_EMAIL,
                token: process.env.PAGBANK_TOKEN,
                currency: 'BRL',
                itemId1: '1',
                itemDescription1: `Plano ${plano}`,
                itemAmount1: valor.toFixed(2),
                itemQuantity1: '1',
                reference: req.user.id,
                redirectURL: `${process.env.BASE_URL}/pagamento/sucesso`,
                notificationURL: `${process.env.BASE_URL}/webhook/pagbank`
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        // Parse XML response (PagBank retorna XML)
        const checkoutCode = response.data.match(/<code>(.*?)<\/code>/)?.[1];

        if (!checkoutCode) {
            throw new Error('Código de checkout não recebido');
        }

        res.json({ 
            checkout_url: `https://pagseguro.uol.com.br/v2/checkout/payment.html?code=${checkoutCode}` 
        });

    } catch (error) {
        console.error('❌ Erro PagBank:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao criar checkout PagBank' });
    }
});

// ==========================================
// ROTAS PROTEGIDAS (COM CONTROLE DE PLANO)
// ==========================================

// Nova senha (limitado por plano)
app.post('/nova-senha', isAuthenticated, async (req, res) => {
    try {
        const { nome, prioridade, especialidade } = req.body;
        const user = req.user;

        // Validações
        if (!nome || !especialidade) {
            return res.status(400).json({ error: 'Nome e especialidade obrigatórios' });
        }

        // Verifica limite do plano gratuito
        if (user.plano === 'gratuito') {
            const hoje = await pool.query(
                'SELECT COUNT(*) FROM chamadas WHERE usuario_id = $1 AND DATE(criado_em) = CURRENT_DATE',
                [user.id]
            );

            if (parseInt(hoje.rows[0].count) >= 10) {
                return res.status(403).json({ 
                    error: 'Limite diário atingido', 
                    mensagem: 'Plano gratuito: máximo 10 senhas por dia. Faça upgrade!' 
                });
            }
        }

        const num = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
        const senha = prioridade ? `P${num}` : `N${num}`;

        const result = await pool.query(
            'INSERT INTO chamadas (usuario_id, paciente_nome, senha, prioridade, status, especialidade, criado_em) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *',
            [user.id, nome.trim(), senha, !!prioridade, 'aguardando', especialidade]
        );

        console.log(`📋 Senha gerada por ${user.email}: ${senha}`);
        res.json(result.rows[0]);

    } catch (err) {
        console.error('❌ Erro:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Listar fila (só do usuário autenticado)
app.get('/pacientes-espera', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM chamadas WHERE usuario_id = $1 AND status = 'aguardando' ORDER BY prioridade DESC, criado_em ASC",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Erro:', err);
        res.status(500).json({ error: 'Erro ao buscar fila' });
    }
});

// Download Excel (limitado por plano)
app.get('/relatorio/download', isAuthenticated, checkPlan('profissional'), async (req, res) => {
    try {
        const caminhoArquivo = path.join(__dirname, `relatorio_${req.user.id}.csv`);
        
        // Gera CSV personalizado do usuário
        const chamadas = await pool.query(
            'SELECT * FROM chamadas WHERE usuario_id = $1 ORDER BY criado_em DESC',
            [req.user.id]
        );

        let csv = "\ufeffData;Hora;Senha;Nome;Especialidade;Sala;Status\n";
        chamadas.rows.forEach(c => {
            const data = new Date(c.criado_em).toLocaleDateString('pt-BR');
            const hora = new Date(c.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            csv += `${data};${hora};${c.senha};${c.paciente_nome};${c.especialidade};${c.sala || 'N/A'};${c.status}\n`;
        });

        fs.writeFileSync(caminhoArquivo, csv, 'utf8');
        
        res.download(caminhoArquivo, `relatorio_medicall_${new Date().toISOString().split('T')[0]}.csv`);

    } catch (err) {
        console.error('❌ Erro:', err);
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
// SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
    console.log('✅ Socket conectado:', socket.id);

    socket.on('chamar_paciente', async (dados) => {
        try {
            const agora = new Date();
            const horaF = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            await pool.query(
                'UPDATE chamadas SET status = $1, sala = $2 WHERE id = $3',
                ['chamado', dados.sala, dados.id]
            );

            io.emit('exibir_painel', { ...dados, hora: horaF });
            console.log(`📢 Chamado: ${dados.senha} → ${dados.sala}`);

        } catch (err) {
            console.error('❌ Erro:', err);
        }
    });

    socket.on('disconnect', () => console.log('❌ Socket desconectado'));
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏥  SISTEMA DE CHAMADAS - v2.0 (OAuth)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 Servidor: http://localhost:${PORT}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});