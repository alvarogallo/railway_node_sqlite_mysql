const authMiddleware = async (req, res, next) => {
    console.log('Auth Middleware - Checking session:', {
        hasSession: !!req.session,
        hasAdmin: !!req.session?.admin,
        sessionID: req.sessionID
    });

    if (!req.session || !req.session.admin) {
        console.log('No session found, redirecting to login');
        return res.redirect('/admin/login');
    }

    // Verificar que el usuario sigue existiendo en la base de datos
    try {
        const [user] = await db.query(
            'SELECT id FROM users WHERE id = ? AND role = "ADMIN"',
            [req.session.admin.id]
        );

        if (!user) {
            console.log('User no longer exists or is not admin');
            req.session.destroy();
            return res.redirect('/admin/login');
        }

        next();
    } catch (error) {
        console.error('Error verifying user:', error);
        return res.redirect('/admin/login');
    }
};