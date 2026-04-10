const { pool } = require('../config/db');

/**
 * Migration: Add subscription restoration tracking columns
 */
const migrate = async () => {
    try {
        console.log('--- Starting Plan Restoration Migration ---');

        // 1. Update Organizations
        await pool.query(`
            ALTER TABLE organizations 
            ADD COLUMN IF NOT EXISTS last_paid_plan_id UUID REFERENCES plans(id),
            ADD COLUMN IF NOT EXISTS last_paid_plan_expiry TIMESTAMPTZ;
        `);
        console.log('[OK] Added columns to organizations table');

        // 2. Update Users (for individual plans)
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS last_paid_plan_id UUID REFERENCES plans(id),
            ADD COLUMN IF NOT EXISTS last_paid_plan_expiry TIMESTAMPTZ;
        `);
        console.log('[OK] Added columns to users table');

        console.log('--- Plan Restoration Migration Completed Successfully ---');
        process.exit(0);
    } catch (err) {
        console.error('--- Plan Restoration Migration Failed ---');
        console.error(err);
        process.exit(1);
    }
};

migrate();
