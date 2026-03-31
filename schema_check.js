const { pool } = require('./src/config/db'); 
pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'appointments\'')
.then(res => console.log(res.rows))
.catch(console.error)
.finally(() => pool.end());
