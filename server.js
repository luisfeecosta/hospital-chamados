require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
// CORREÇÃO: Importar store do Postgres
const pgSession = require('connect-pg-simple')(session); 
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
// CORREÇÃO CRÍTICA: TRUST PROXY
// ==========================================
// Necessário para cookies 'secure: true' funcionarem atrás de load balancers (Render, Heroku, etc)
app.set('trust proxy', 1);

// ==========================================
// MIDDLEWARES
// ==========================================
app.use(cors({ 
    origin: process.env.BASE_URL || 'http://localhost:3000', 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// ==========================================
// CORREÇÃO: SESSÃO COM PERSISTÊNCIA NO DB
// ==========================================
app.use(session({
    store: new pgSession({
        pool: pool,                // Usa a conexão existente
        tableName: 'session',      // Tabela criada no SQL acima
        createTableIfMissing: true // Tenta criar se não existir
    }),
    secret: process.env.SESSION_SECRET || 'secret-padrao-mude-isso',
    resave: false,
    saveUninitialized: false, // Importante: false evita criar sessões vazias para bots
    proxy: true, // Importante para SSL reverso
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // true em prod (HTTPS), false em dev
        httpOnly: true, // Protege contra XSS
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' é necessário se o front e back estiverem em domínios diferentes
        maxAge: 24 * 60 * 60 * 1000 // 1 dia
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
            console.log(`✅ Novo usuário criado: ${email}`);
        } else {
            console.log(`✅ Usuário logado: ${email}`);
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
        if (result.rows.length > 0) {
            done(null, result.rows[0]);
        } else {
            done(new Error("Usuário não encontrado"), null);
        }
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
    // Retorna 401 se for API, redireciona se for navegador
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(401).json({ error: 'Não autenticado', redirect: '/login.html' });
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

app.get('/auth/google', (req, res, next) => {
    const plano = req.query.plano;
    if (plano) {
        req.session.planoDesejado = plano;
        req.session.save(); // Força salvar a sessão antes de redirecionar
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html?error=true' }),
    (req, res) => {
        // Gera JWT como backup/uso no frontend se necessário
        const token = jwt.sign(
            { id: req.user.id, email: req.user.email, plano: req.user.plano },
            process.env.JWT_SECRET || 'secret-jwt-padrao-mude-isso',
            { expiresIn: '7d' }
        );

        res.cookie('auth_token', token, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        const planoDesejado = req.session.planoDesejado;
        delete req.session.planoDesejado;
        
        // Salvar sessão antes de redirecionar para garantir persistência
        req.session.save((err) => {
            if (err) console.error("Erro ao salvar sessão:", err);
            
            if (planoDesejado === 'profissional') {
                res.redirect('/upgrade.html');
            } else if (req.user.plano === 'gratuito') {
                res.redirect('/selecao.html?plano=gratuito&novo=true');
            } else {
                res.redirect('/selecao.html');
            }
        });
    }
);

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.clearCookie('auth_token');
        req.session.destroy(() => {
            res.redirect('/');
        });
    });
});

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
    // ... (MANTENHA O CÓDIGO ORIGINAL AQUI)
    // O código original estava ok, apenas a autenticação falhava
    // Copie o conteúdo original das rotas de pagamento aqui
    try {
        const { plano } = req.body;
        const precos = { 'profissional': 99.90, 'enterprise': 299.90 };
        const valor = precos[plano];
        
        if (!valor) return res.status(400).json({ error: 'Plano inválido' });

        const response = await axios.post('https://api.kiwify.com.br/v1/checkout', {
            product_id: process.env.KIWIFY_PRODUCT_ID,
            customer_email: req.user.email,
            customer_name: req.user.nome,
            amount: valor,
            metadata: { user_id: req.user.id, plano: plano }
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

        res.json({ checkout_url: response.data.checkout_url });
    } catch (error) {
        console.error('❌ Erro Kiwify:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao criar checkout' });
    }
});

app.post('/webhook/kiwify', async (req, res) => {
    // ... (MANTENHA O CÓDIGO ORIGINAL AQUI)
    try {
        const { event, data } = req.body;
        if (event === 'purchase.approved') {
            const userId = data.metadata.user_id;
            const plano = data.metadata.plano;
            await pool.query('UPDATE usuarios SET plano = $1, status = $2, atualizado_em = NOW() WHERE id = $3', [plano, 'ativo', userId]);
            await pool.query('UPDATE pagamentos SET status = $1, data_pagamento = NOW() WHERE transacao_id = $2', ['aprovado', data.transaction_id]);
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.sendStatus(500);
    }
});

// ==========================================
// ROTAS PROTEGIDAS (MANTIDAS COMO NO ORIGINAL)
// ==========================================

// Nova senha
app.post('/nova-senha', isAuthenticated, async (req, res) => {
    try {
        const { nome, prioridade, especialidade } = req.body;
        const user = req.user;

        // Validações
        if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
        if (!especialidade) return res.status(400).json({ error: 'Especialidade é obrigatória' });

        // Verifica limite do plano gratuito
        if (user.plano === 'gratuito') {
            const hoje = await pool.query(
                'SELECT COUNT(*) FROM chamadas WHERE usuario_id = $1 AND DATE(criado_em) = CURRENT_DATE',
                [user.id]
            );
            if (parseInt(hoje.rows[0].count) >= 10) {
                return res.status(403).json({ error: 'Limite diário atingido' });
            }
        }

        const num = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
        const senha = prioridade ? `P${num}` : `N${num}`;

        const result = await pool.query(
            'INSERT INTO chamadas (usuario_id, paciente_nome, senha, prioridade, status, especialidade, criado_em) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *',
            [user.id, nome.trim(), senha, !!prioridade, 'aguardando', especialidade]
        );

        io.to(`room_${user.id}`).emit('nova_senha_gerada', result.rows[0]); // Atualiza fila em tempo real
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Erro ao criar senha:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Listar fila
app.get('/pacientes-espera', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM chamadas WHERE usuario_id = $1 AND status = 'aguardando' ORDER BY prioridade DESC, criado_em ASC",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Erro ao buscar fila:', err);
        res.status(500).json({ error: 'Erro ao buscar fila' });
    }
});

// Download Excel
app.get('/relatorio/download', isAuthenticated, checkPlan('profissional'), async (req, res) => {
    // ... (MANTENHA O CÓDIGO ORIGINAL AQUI - Está correto)
    try {
        const chamadas = await pool.query('SELECT * FROM chamadas WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 1000', [req.user.id]);
        let csv = "\ufeffData;Hora;Senha;Nome;Especialidade;Sala;Status\n";
        chamadas.rows.forEach(c => {
            const data = new Date(c.criado_em).toLocaleDateString('pt-BR');
            const hora = new Date(c.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            csv += `${data};${hora};${c.senha};${c.paciente_nome};${c.especialidade || 'N/A'};${c.sala || 'N/A'};${c.status}\n`;
        });
        const filename = `relatorio_${req.user.id}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: 'Erro no download' });
    }
});

// ==========================================
// ROTAS PÚBLICAS
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
// Rotas protegidas (só servem arquivo se logado)
const protectedPages = ['selecao', 'triagem', 'medico', 'painel', 'upgrade'];
protectedPages.forEach(page => {
    app.get(`/${page}.html`, isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`)));
});


// ==========================================
// SOCKET.IO (MANTIDO DO ORIGINAL)
// ==========================================
io.on('connection', (socket) => {
    socket.on('join_room', (dados) => {
        if (!dados.contexto_id) return;
        const roomId = `room_${dados.contexto_id}`;
        socket.join(roomId);
        socket.contexto_id = dados.contexto_id;
        socket.emit('room_joined', { roomId });
    });
    
    socket.on('chamar_paciente', async (dados) => {
        try {
            if (!socket.contexto_id) return;
            await pool.query('UPDATE chamadas SET status = $1, sala = $2 WHERE id = $3', ['chamado', dados.sala, dados.id]);
            const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            io.to(`room_${socket.contexto_id}`).emit('exibir_painel', { ...dados, hora: agora });
        } catch (err) {
            console.error('❌ Erro chamada:', err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});