const express = require('express');
const { sendEmail } = require('../../services/email.service');
const catchAsync = require('../../utils/catchAsync');

const router = express.Router();

const handleContactSubmit = catchAsync(async (req, res) => {
    const { name, email, subject, message } = req.body;

    // Send the contact form details to the official business email
    await require('../../services/email.service').sendContactFormEmail('support@queuify.in', { name, email, subject, message });

    res.status(200).send({ message: 'Message sent successfully' });
});

router.post('/', handleContactSubmit);

module.exports = router;
