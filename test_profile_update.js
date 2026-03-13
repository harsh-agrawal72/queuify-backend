const { pool } = require('./src/config/db');
const organizationProfileModel = require('./src/models/organization_profile.model');

async function testUpdate() {
    try {
        // Get a valid org_id
        const orgRes = await pool.query('SELECT id FROM organizations LIMIT 1');
        if (orgRes.rows.length === 0) {
            console.log('No organizations found');
            process.exit(1);
        }
        const orgId = orgRes.rows[0].id;

        const profileData = {
            description: 'Test description',
            address: 'Test address',
            city: 'Test city',
            state: 'Test state',
            pincode: '123456',
            contact_email: 'test@example.com',
            contact_phone: '1234567890',
            website_url: 'https://example.com',
            working_hours: {},
            gst_number: 'GST123',
            registration_number: 'REG123',
            established_year: 2020,
            total_staff: 10,
            facebook_url: 'https://facebook.com',
            instagram_url: 'https://instagram.com',
            linkedin_url: 'https://linkedin.com'
            // trustScore and images are usually filtered out by the model
        };

        console.log(`Attempting to update profile for org ${orgId}...`);
        const result = await organizationProfileModel.upsertProfile(orgId, profileData);
        console.log('Update successful!');
        console.log(result);
        process.exit(0);
    } catch (err) {
        console.error('Update failed with error:');
        console.error(err);
        process.exit(1);
    }
}

testUpdate();
