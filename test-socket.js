// Teste simples para verificar se o socket está funcionando
const io = require('socket.io-client');

async function testarSocket() {
    console.log('=== TESTE DE SOCKET ===');
    
    try {
        const socket = io('http://localhost:3000');
        
        socket.on('connect', () => {
            console.log('✅ Socket conectado:', socket.id);
            
            // Simula uma chamada
            const dadosTeste = {
                id: 1,
                nome: 'TESTE PACIENTE',
                senha: 'N01',
                sala: 'Consultório 1',
                especialidade: 'Clínico Geral'
            };
            
            console.log('📤 Enviando chamada de teste:', dadosTeste);
            socket.emit('chamar_paciente', dadosTeste);
        });
        
        socket.on('exibir_painel', (dados) => {
            console.log('📺 Recebido no painel:', dados);
        });
        
        socket.on('disconnect', () => {
            console.log('❌ Socket desconectado');
        });
        
        socket.on('connect_error', (error) => {
            console.error('❌ Erro de conexão:', error.message);
        });
        
        // Desconecta após 5 segundos
        setTimeout(() => {
            socket.disconnect();
            process.exit(0);
        }, 5000);
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

testarSocket();