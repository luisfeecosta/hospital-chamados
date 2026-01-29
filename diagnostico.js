// Teste para verificar se o problema está na autenticação ou no socket
console.log('=== DIAGNÓSTICO DO PROBLEMA ===');

console.log('\n🔍 POSSÍVEIS CAUSAS:');
console.log('1. Socket não está autenticado corretamente');
console.log('2. Middleware de autenticação está bloqueando');
console.log('3. Usuário não está na sala correta');
console.log('4. Dados não estão sendo enviados corretamente');

console.log('\n📋 PASSOS PARA TESTAR:');
console.log('1. Abra o console do navegador (F12)');
console.log('2. Faça login no sistema');
console.log('3. Abra o painel.html');
console.log('4. Abra o medico.html em outra aba');
console.log('5. Chame um paciente');
console.log('6. Verifique os logs no console');

console.log('\n🔧 LOGS IMPORTANTES:');
console.log('- [SOCKET AUTH] - Autenticação do socket');
console.log('- [CONEXÃO] - Conexão estabelecida');
console.log('- [ROOM] - Entrada na sala do usuário');
console.log('- [CHAMADA] - Dados da chamada');
console.log('- [EMITINDO] - Envio para o painel');
console.log('- [PAINEL] - Recebimento no painel');

console.log('\n⚠️ SE NÃO APARECER NO PAINEL:');
console.log('- Verifique se há erro de autenticação no socket');
console.log('- Confirme se o usuário entrou na sala correta');
console.log('- Verifique se os dados estão sendo enviados');

console.log('\n✅ TESTE CONCLUÍDO - Verifique os logs do navegador');