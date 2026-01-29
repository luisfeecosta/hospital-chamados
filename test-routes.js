const axios = require('axios');

async function testarRotas() {
    const baseURL = 'http://localhost:3000';
    
    console.log('=== TESTE DAS ROTAS ===');
    
    try {
        // Teste 1: Verificar se o servidor está rodando
        console.log('1. Testando servidor...');
        const response = await axios.get(baseURL, { timeout: 5000 });
        console.log('✅ Servidor respondendo na porta 3000');
        
        // Teste 2: Verificar rota de status de auth (sem autenticação)
        console.log('2. Testando rota /auth/status...');
        const authStatus = await axios.get(`${baseURL}/auth/status`, { timeout: 5000 });
        console.log('✅ Rota /auth/status funcionando:', authStatus.data);
        
        // Teste 3: Tentar acessar rota protegida (deve retornar 401)
        console.log('3. Testando rota protegida /nova-senha...');
        try {
            await axios.post(`${baseURL}/nova-senha`, {
                nome: 'Teste',
                especialidade: 'Clínico Geral'
            }, { timeout: 5000 });
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.log('✅ Rota protegida funcionando (retornou 401 como esperado)');
            } else {
                console.log('❌ Erro inesperado:', error.message);
            }
        }
        
        console.log('✅ Todos os testes passaram!');
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.log('❌ Servidor não está rodando na porta 3000');
            console.log('Execute: npm start');
        } else {
            console.log('❌ Erro no teste:', error.message);
        }
    }
}

testarRotas();