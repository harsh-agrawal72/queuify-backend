const { pool } = require('../src/config/db');
const slotService = require('../src/services/slot.service');
const appointmentService = require('../src/services/appointment.service');

async function testEstimation() {
    console.log("--- Testing Slot Estimation Logic ---");
    
    // Mocking common data for testing
    const orgId = '30000000-0000-0000-0000-000000000001';
    const serviceId = '40000000-0000-0000-0000-000000000001';
    const resourceId = '20000000-0000-0000-0000-000000000001';

    try {
        // 1. Test getAvailableSlots with serviceId
        console.log("1. Fetching available slots with service duration...");
        const slots = await slotService.getAvailableSlots(orgId, { serviceId, resourceId });
        
        if (slots.length > 0) {
            const firstSlot = slots[0];
            console.log(`Slot: ${firstSlot.start_time}`);
            console.log(`Booked Count: ${firstSlot.booked_count}`);
            console.log(`Estimated Next Time: ${firstSlot.estimated_next_time}`);
            console.log(`Message: ${firstSlot.descriptive_message}`);
            
            if (firstSlot.descriptive_message.includes('expected at')) {
                console.log("✅ Message format is correct.");
            } else {
                console.log("❌ Message format is incorrect.");
            }
        } else {
            console.log("⚠️ No slots found for testing.");
        }

        // 2. Test Notification Logic (Simulated)
        console.log("\n2. Testing Notification Trigger logic...");
        // This is harder to test without real DB state, but we can verify the service method exists
        if (typeof appointmentService.checkAndNotifySlotWaiters === 'function') {
            console.log("✅ checkAndNotifySlotWaiters method exists.");
        } else {
            console.log("❌ checkAndNotifySlotWaiters method is missing.");
        }

    } catch (error) {
        console.error("Test failed:", error.message);
    } finally {
        // pool.end(); // Don't close if other things might be running, but for a standalone script it's good
    }
}

testEstimation();
