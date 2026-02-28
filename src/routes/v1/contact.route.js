const express = require('express');
const { sendEmail } = require('../../services/email.service');
const catchAsync = require('../../utils/catchAsync');

const router = express.Router();

const handleContactSubmit = catchAsync(async (req, res) => {
    const { name, email, subject, message } = req.body;

    // Send email to the specific address
    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; padding: 20px;">
            <h2 style="color: #4f46e5;">New Contact Form Submission</h2>
            <p>You have received a new message from the Queuify contact form.</p>
            <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>Name:</strong> ${name}</p>
                <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
                <p style="margin: 5px 0;"><strong>Subject:</strong> ${subject}</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;" />
                <p style="margin: 5px 0;"><strong>Message:</strong></p>
                <p style="white-space: pre-wrap;">${message}</p>
            </div>
            <p style="font-size: 12px; color: #999;">This email was sent automatically from your website.</p>
        </div>
    `;

    // The user explicitly requested to send emails to harsagrawal7270@gmail.com
    await sendEmail('harsagrawal7270@gmail.com', `Contact Form: ${subject}`, html);

    res.status(200).send({ message: 'Message sent successfully' });
});

router.post('/', handleContactSubmit);

module.exports = router;
