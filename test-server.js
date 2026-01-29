// SERVIDOR DE TESTE SIMPLIFICADO
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('🔌 [TESTE] Socket conectado:', socket.id);
    
    socket.on('join_room', (dados) => {
        console.log('📥 [TESTE] Recebido join_room:', dados);
        
        const roomId = `room_${dados.contexto_id}`;
        socket.join(roomId);
        
        console.log(`🏠 [TESTE] Socket ${socket.id} entrou na sala: ${roomId}`);
        console.log(`📊 [TESTE] Sockets na sala: ${io.sockets.adapter.rooms.get(roomId)?.size || 0}`);
        
        socket.emit('room_joined', { roomId, contexto_id: dados.contexto_id });
        console.log('✅ [TESTE] Confirmação enviada para:', socket.id);
    });
    
    socket.on('chamar_paciente', (dados) => {
        console.log('📢 [TESTE] Chamada recebida:', dados);
        
        // Emite para TODOS (teste de broadcast)
        console.log('📤 [TESTE] Enviando para TODOS (broadcast)');
        io.emit('exibir_painel', { ...dados, hora: '12:34' });
        
        console.log('✅ [TESTE] Broadcast enviado');
    });
    
    socket.on('disconnect', () => {
        console.log('❌ [TESTE] Socket desconectado:', socket.id);
    });
});

server.listen(3001, () => {
    console.log('🧪 SERVIDOR DE TESTE rodando na porta 3001');
    console.log('Acesse: http://localhost:3001/painel.html');
});

// Para testar:
// 1. Pare o servidor principal (Ctrl+C)
// 2. Execute: node test-server.js
// 3. Acesse: http://localhost:3001/painel.html
// 4. Verifique se os logs [TESTE] aparecem