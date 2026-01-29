const io = require('socket.io-client');

console.log('=== TESTE DE ISOLAMENTO DE ROOMS ===');

// Simula dois usuários diferentes
const usuario1 = { id: 1, email: 'user1@test.com' };
const usuario2 = { id: 2, email: 'user2@test.com' };

function criarSocket(usuario) {
    const socket = io('http://localhost:3000');
    
    socket.on('connect', () => {
        console.log(`✅ [USER ${usuario.id}] Socket conectado:`, socket.id);
        
        // Entra na sala do usuário
        socket.emit('join_room', {
            contexto_id: usuario.id,
            tipo: 'painel',
            email: usuario.email
        });
    });
    
    socket.on('room_joined', (dados) => {
        console.log(`🏠 [USER ${usuario.id}] Entrou na sala:`, dados.roomId);
    });
    
    socket.on('exibir_painel', (dados) => {
        console.log(`📺 [USER ${usuario.id}] RECEBEU CHAMADA:`, dados);
        console.log(`⚠️  [PROBLEMA] User ${usuario.id} recebeu dados que não deveria!`);
    });
    
    socket.on('connect_error', (error) => {
        console.error(`❌ [USER ${usuario.id}] Erro de conexão:`, error.message);
    });
    
    return socket;
}

// Cria dois sockets simulando dois usuários
const socket1 = criarSocket(usuario1);
const socket2 = criarSocket(usuario2);

// Após 2 segundos, simula uma chamada do usuário 1
setTimeout(() => {
    console.log('\n📤 [TESTE] Simulando chamada do usuário 1...');
    socket1.emit('chamar_paciente', {
        id: 123,
        nome: 'TESTE PACIENTE',
        senha: 'T01',
        sala: 'Consultório 1',
        especialidade: 'Teste'
    });
}, 2000);

// Encerra teste após 5 segundos
setTimeout(() => {
    console.log('\n=== FIM DO TESTE ===');
    socket1.disconnect();
    socket2.disconnect();
    process.exit(0);
}, 5000);