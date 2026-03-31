const { pool } = require('./src/config/db');
require('dotenv').config({path: './.env'});
pool.query('SELECT a.id, a.admin_remarks FROM appointments a JOIN services s ON a.service_id = s.id WHERE a.status = \'completed\' ORDER BY a.created_at DESC LIMIT 5').then(res => { console.log(res.rows); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
