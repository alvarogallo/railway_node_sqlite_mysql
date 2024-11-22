// createTables.js
require('dotenv').config();
const mysql = require('mysql2/promise');

const config = {
    host: "mysql.railway.internal",
    port: "3306",
    user: 'root',
    password: process.env.DB_PASSWORD,
    database: 'railway',
    connectTimeout: 10000
};

async function createTables() {
    let connection;
    try {
        connection = await mysql.createConnection(config);
        console.log('✅ Conexión establecida');

        console.log('Creando tablas...');
        
        // Crear tabla bingo_bingos
        await connection.execute(`
            CREATE TABLE bingo_bingos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                evento VARCHAR(32) NOT NULL,
                numeros VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Crear tabla bingo_parametros
        await connection.execute(`
            CREATE TABLE bingo_parametros (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(32) NOT NULL,
                valor VARCHAR(32) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        console.log('✅ Tablas creadas exitosamente');
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        if (connection) await connection.end();
    }
}

createTables();