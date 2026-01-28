require('dotenv').config();
const jwt = require('jsonwebtoken');

// Cria um token JWT para teste
const token = jwt.sign(
    { id: 1, email: 'teste@gmail.com', plano: 'gratuito' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
);

console.log('Token JWT para teste:');
console.log(token);

// Testa decodificação
try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('\nToken decodificado:');
    console.log(decoded);
} catch (err) {
    console.error('Erro ao decodificar:', err);
}