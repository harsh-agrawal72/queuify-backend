const emailService = require('../services/email.service');

async function testTemplates() {
    console.log('--- Testing New Email Templates ---');
    const to = 'harshagrawal93557@gmail.com';
    
    const mockAppointment = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_name: 'Harsh Agrawal',
        org_name: 'Elite Health Care',
        org_address: '123 Medical Drive, New Delhi',
        service_name: 'General Consultation',
        token_number: '42',
        start_time: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        status: 'confirmed'
    };

    try {
        console.log('1. Sending Booking Confirmation...');
        await emailService.sendBookingConfirmation(to, mockAppointment);
        
        console.log('2. Sending Status Update (Serving)...');
        await emailService.sendStatusUpdateEmail(to, { ...mockAppointment, status: 'serving' });
        
        console.log('3. Sending Admin Notification...');
        await emailService.sendAdminBookingNotification('harshagrawal7274@gmail.com', mockAppointment);

        console.log('All test emails queued successfully!');
    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

testTemplates();
