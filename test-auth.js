require('dotenv').config();
const jwt = require('jsonwebtoken');

console.log('=== TESTE DE AUTENTICAÇÃO ===');
console.log('JWT_SECRET definido:', !!process.env.JWT_SECRET);
console.log('JWT_SECRET valor:', process.env.JWT_SECRET ? 'Configurado' : 'NÃO CONFIGURADO');

if (!process.env.JWT_SECRET) {
    console.error('❌ ERRO: JWT_SECRET não está definido no arquivo .env');
    console.log('Adicione a linha: JWT_SECRET=sua_chave_secreta_aqui');
    process.exit(1);
}

// Teste de criação e verificação de token
try {
    const testPayload = { id: 1, email: 'test@test.com', plano: 'gratuito' };
    const token = jwt.sign(testPayload, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log('✅ Token criado com sucesso');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token verificado com sucesso');
    console.log('Payload decodificado:', decoded);
    
    console.log('✅ Autenticação JWT funcionando corretamente!');
} catch (error) {
    console.error('❌ Erro no teste JWT:', error.message);
}