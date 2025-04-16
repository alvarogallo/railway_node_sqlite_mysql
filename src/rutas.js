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
// Obtener IPs de un canal
router.get('/api/canales/:canal/ips', async (req, res) => {
    try {
        const { canal } = req.params;

        // Obtener el ID del canal
        const [canalInfo] = await db.query(
            'SELECT id FROM socket_io_canales WHERE nombre = ?',
            [canal]
        );

        if (!canalInfo) {
            return res.status(404).json({ error: 'Canal no encontrado' });
        }

        // Obtener las IPs
        const ips = await db.query(
            'SELECT ip FROM socket_io_ips_validas WHERE id_canal = ?',
            [canalInfo.id]
        );

        res.json({
            ips: ips.map(row => row.ip)
        });
    } catch (error) {
        console.error('Error al obtener IPs:', error);
        res.status(500).json({ error: 'Error al obtener IPs' });
    }
});

// Agregar IP a un canal
router.post('/api/canales/:canal/ips', async (req, res) => {
    try {
        const { canal } = req.params;
        const { ip } = req.body;

        if (!ip) {
            return res.status(400).json({ error: 'IP requerida' });
        }

        // Validar formato de IP
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(ip)) {
            return res.status(400).json({ error: 'Formato de IP inválido' });
        }

        // Obtener el ID del canal
        const [canalInfo] = await db.query(
            'SELECT id FROM socket_io_canales WHERE nombre = ?',
            [canal]
        );

        if (!canalInfo) {
            return res.status(404).json({ error: 'Canal no encontrado' });
        }

        // Verificar si la IP ya existe para este canal
        const [ipExistente] = await db.query(
            'SELECT id FROM socket_io_ips_validas WHERE id_canal = ? AND ip = ?',
            [canalInfo.id, ip]
        );

        if (ipExistente) {
            return res.status(400).json({ error: 'La IP ya está autorizada para este canal' });
        }

        // Agregar la IP
        await db.query(
            'INSERT INTO socket_io_ips_validas (id_canal, ip) VALUES (?, ?)',
            [canalInfo.id, ip]
        );

        res.json({ message: 'IP agregada exitosamente' });
    } catch (error) {
        console.error('Error al agregar IP:', error);
        res.status(500).json({ error: 'Error al agregar IP' });
    }
});

// Ruta para borrar registros específicos con {"minutos":3}
router.post('/api/logs/borrar-registros-minutos3', authMiddleware, async (req, res) => {
    try {
      console.log('Iniciando borrado de registros con {"minutos":3} que no sean de hoy');
  
      const result = await db.query(`
        DELETE FROM socket_io_historial 
        WHERE DATE(created_at) < CURRENT_DATE() 
        AND mensaje = ?
      `, ['{"minutos":3}']);
  
      // Verificar cuántos registros fueron borrados
      if (result.affectedRows === 0) {
        console.log('No se encontraron registros que cumplan con los criterios');
        return res.json({ 
          success: true,
          message: 'No hay registros que cumplan con estos criterios para borrar',
          registrosBorrados: 0
        });
      }
  
      console.log(`Se borraron ${result.affectedRows} registros específicos`);
      
      res.json({
        success: true,
        message: `Se borraron ${result.affectedRows} registros específicos`,
        registrosBorrados: result.affectedRows
      });
    } catch (error) {
      console.error('Error al borrar registros específicos:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error al borrar registros específicos',
        details: error.message 
      });
    }
  });

// Eliminar IP de un canal
router.delete('/api/canales/:canal/ips/:ip', async (req, res) => {
    try {
        const { canal, ip } = req.params;

        // Obtener el ID del canal
        const [canalInfo] = await db.query(
            'SELECT id FROM socket_io_canales WHERE nombre = ?',
            [canal]
        );

        if (!canalInfo) {
            return res.status(404).json({ error: 'Canal no encontrado' });
        }

        // Eliminar la IP
        await db.query(
            'DELETE FROM socket_io_ips_validas WHERE id_canal = ? AND ip = ?',
            [canalInfo.id, ip]
        );

        res.json({ message: 'IP eliminada exitosamente' });
    } catch (error) {
        console.error('Error al eliminar IP:', error);
        res.status(500).json({ error: 'Error al eliminar IP' });
    }
});
module.exports = router;