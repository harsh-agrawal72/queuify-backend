const express = require('express');
const { sendEmail } = require('../../services/email.service');
const catchAsync = require('../../utils/catchAsync');

const router = express.Router();

const handleContactSubmit = catchAsync(async (req, res) => {
    const { name, email, subject, message } = req.body;

    // The user explicitly requested to send emails to harsagrawal7270@gmail.com
    await require('../../services/email.service').sendContactFormEmail('harsagrawal7270@gmail.com', { name, email, subject, message });

    res.status(200).send({ message: 'Message sent successfully' });
});

router.post('/', handleContactSubmit);

module.exports = router;
