const { pool } = require('./src/config/db');

async function compareFields() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'organization_profiles'");
        const dbColumns = res.rows.map(r => r.column_name);

        const frontendFields = [
            'description', 'address', 'city', 'state', 'pincode',
            'contact_email', 'contact_phone', 'website_url', 'working_hours',
            'gst_number', 'registration_number', 'established_year', 'total_staff',
            'facebook_url', 'instagram_url', 'linkedin_url'
        ];

        console.log('--- Columns in DB ---');
        console.log(dbColumns.sort());

        console.log('\n--- Frontend Fields ---');
        console.log(frontendFields.sort());

        const missingInDB = frontendFields.filter(f => !dbColumns.includes(f));
        console.log('\n--- Missing in DB ---');
        console.log(missingInDB);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

compareFields();
