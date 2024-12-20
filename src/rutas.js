// rutas.js
const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('./db');

// Ruta para borrar logs antiguos sin autenticación
router.get('/borrar-logs-antiguos', async (req, res) => {
    try {
        console.log('Iniciando borrado de logs antiguos (excepto hoy)');

        const result = await db.query(`
            DELETE FROM socket_io_historial 
            WHERE id IN (
                SELECT id FROM (
                    SELECT id 
                    FROM socket_io_historial 
                    WHERE DATE(created_at) < DATE(CURRENT_TIMESTAMP)
                    ORDER BY created_at ASC 
                    LIMIT 500
                ) as t
            )
        `);

        const registrosBorrados = result.affectedRows || 0;
        console.log(`Se borraron ${registrosBorrados} registros antiguos`);
        
        return res.json({
            message: `Se borraron ${registrosBorrados} registros antiguos (exceptuando los de hoy)`,
            registrosBorrados: registrosBorrados
        });

    } catch (error) {
        console.error('Error al borrar logs:', error);
        return res.status(500).json({
            error: 'Error al borrar logs antiguos',
            details: error.message
        });
    }
});

// Ruta para la página de canales
router.get('/canales', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'canales.html'));
});

// Ruta para crear nuevo canal
router.post('/api/canales', async (req, res) => {
    try {
        const { nombre, tokenReceptor, tokenEmisor } = req.body;

        // Validar datos requeridos
        if (!nombre || !tokenReceptor || !tokenEmisor) {
            return res.status(400).json({
                error: 'Todos los campos son requeridos'
            });
        }

        // Verificar si el canal ya existe
        const [canalExistente] = await db.query(
            'SELECT id FROM socket_io_canales WHERE nombre = ?',
            [nombre]
        );

        if (canalExistente) {
            return res.status(400).json({
                error: 'Ya existe un canal con ese nombre'
            });
        }

        // Insertar nuevo canal
        const [resultCanal] = await db.query(
            'INSERT INTO socket_io_canales (nombre) VALUES (?)',
            [nombre]
        );

        const idCanal = resultCanal.insertId;

        // Insertar tokens
        await Promise.all([
            // Token receptor
            db.query(
                'INSERT INTO socket_io_tokens (id_canal, token, permisos) VALUES (?, ?, "receptor")',
                [idCanal, tokenReceptor]
            ),
            // Token emisor
            db.query(
                'INSERT INTO socket_io_tokens (id_canal, token, permisos) VALUES (?, ?, "emisor")',
                [idCanal, tokenEmisor]
            )
        ]);

        res.json({
            message: 'Canal creado exitosamente',
            canal: {
                id: idCanal,
                nombre: nombre
            }
        });

    } catch (error) {
        console.error('Error al crear canal:', error);
        res.status(500).json({
            error: 'Error al crear el canal',
            details: error.message
        });
    }
});

module.exports = router;