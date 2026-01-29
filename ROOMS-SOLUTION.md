# SOLUÇÃO: Sistema de Rooms para Isolamento de Usuários

## 1. Servidor - Modificar Socket.IO Handler

Substitua o handler `io.on('connection')` no server.js por:

```javascript
io.on('connection', (socket) => {
    console.log('✅ [SOCKET] Nova conexão:', socket.id);

    // Evento para o painel se identificar e entrar na sala
    socket.on('painel_conectado', (dados) => {
        const userRoom = `user_${dados.userId}`;
        socket.join(userRoom);
        socket.userId = dados.userId;
        socket.userEmail = dados.email;
        
        console.log(`📺 [PAINEL] Conectado - User: ${dados.email} (ID: ${dados.userId})`);
        console.log(`🏠 [ROOM] Painel entrou na sala: ${userRoom}`);
        console.log(`📊 [ROOM] Sockets na sala: ${io.sockets.adapter.rooms.get(userRoom)?.size || 0}`);
    });

    // Evento de chamada - ISOLADO POR USUÁRIO
    socket.on('chamar_paciente', async (dados) => {
        try {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📢 [CHAMADA] Recebida de:', socket.userEmail || 'Médico');
            console.log('📢 [CHAMADA] Dados:', dados);
            
            const agora = new Date();
            const horaF = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            // Atualiza status no banco
            if (socket.userId && socket.userId !== 'temp') {
                await pool.query(
                    'UPDATE chamadas SET status = $1, sala = $2 WHERE id = $3',
                    ['chamado', dados.sala, dados.id]
                );
            }

            // ENVIA APENAS PARA A SALA DO USUÁRIO ESPECÍFICO
            const userRoom = `user_${socket.userId}`;
            const payload = { ...dados, hora: horaF };
            
            console.log(`📤 [EMIT] Enviando para sala: ${userRoom}`);
            console.log(`📤 [EMIT] Payload:`, payload);
            console.log(`📊 [EMIT] Sockets na sala: ${io.sockets.adapter.rooms.get(userRoom)?.size || 0}`);
            
            // CRUCIAL: Emite APENAS para a sala do usuário
            io.to(userRoom).emit('exibir_painel', payload);
            
            console.log(`✅ [SUCESSO] Chamada enviada: ${dados.senha} → ${dados.sala}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        } catch (err) {
            console.error('❌ [ERRO] Chamada:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ [DISCONNECT] Socket: ${socket.id} (${socket.userEmail || 'N/A'})`);
    });
});
```

## 2. Médico - Identificar Usuário ao Conectar

Adicione no medico.html após `socket.on('connect')`:

```javascript
socket.on('connect', async () => {
    // ... código existente ...
    
    // Identifica o usuário para entrar na sala correta
    try {
        const response = await fetch('/auth/status', { credentials: 'include' });
        const userData = await response.json();
        if (userData.autenticado) {
            socket.userId = userData.usuario.id;
            socket.userEmail = userData.usuario.email;
            console.log('👤 [MÉDICO] Identificado:', userData.usuario.email, 'ID:', userData.usuario.id);
        }
    } catch (error) {
        console.error('❌ [MÉDICO] Erro ao obter dados do usuário:', error);
    }
});
```

## 3. Painel - Já está correto no código atual

O painel.html já tem a implementação correta com:
- `painel_conectado` event para entrar na sala
- Logs detalhados para debug
- Identificação do usuário

## 4. Teste de Isolamento

Para testar se está funcionando:

1. **Abra 2 navegadores diferentes**
2. **Faça login com usuários diferentes**
3. **Abra painel.html em ambos**
4. **Chame paciente de um usuário**
5. **Verifique que só aparece no painel correto**

## 5. Logs Importantes

**Servidor:**
- `[PAINEL] Conectado` - Painel entrou na sala
- `[ROOM] Sockets na sala: 1` - Confirma isolamento
- `[EMIT] Enviando para sala: user_X` - Envio direcionado

**Navegador:**
- `[PAINEL RECEBEU] Meu User ID: X` - Confirma recebimento correto

## ✅ RESULTADO ESPERADO

- Usuário A chama paciente → Só painel A recebe
- Usuário B não vê chamadas do usuário A
- Cada usuário tem sua própria "sala" isolada
- Logs mostram envio direcionado por sala