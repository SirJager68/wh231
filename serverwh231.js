const express = require('express');
const path = require('path');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3231;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
    res.json({ status: 'Warehouse 231 server running.' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// === SLIDE SHOW
const fs = require('fs');
const imagesDir = path.join(__dirname, 'public', 'studio-images');

app.get('/api/studio-images', (req, res) => {
    fs.readdir(imagesDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Unable to list images' });
        // filter to jpg/png
        const images = files.filter(file =>
            /\.(jpg|jpeg|png|gif)$/i.test(file)
        );
        res.json(images);
    });
});
// === END SLIDE SHOW

// === add audio
const audioDir = path.join(__dirname, 'public', 'audio');

app.get('/api/audio-files', (req, res) => {
    fs.readdir(audioDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Unable to list audio files' });
        const wavs = files.filter(file => /\.(wav)$/i.test(file));
        res.json(wavs);
    });
});
// === END AUDIO


// === MAIL SERVER
const nodemailer = require('nodemailer');

// Replace with your email service/provider details!
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,    // 'jagerbb@gmail.com'
        pass: process.env.SMTP_PASS     // 16-char App Password from .env
    }
});

app.post('/api/contact', express.json(), async (req, res) => {
  console.log('Received contact form submission:', req.body);
  const { name, email, subject, message } = req.body;
  if(!name || !email || !subject || !message) return res.json({ success: false, error: "All fields required." });
  try {
    await transporter.sendMail({
      from: `"Warehouse 231 Contact" <${process.env.SMTP_USER}>`,
      to: process.env.MAIL_TO,
      subject: `[${subject}] New message from ${name} (warehouse231.com)`,
      replyTo: email,
      text: `Subject: ${subject}\nName: ${name}\nEmail: ${email}\n\n${message}`,
    });
    res.json({ success: true });
  } catch(err) {
    console.error("Nodemailer error:", err);
    res.json({ success: false, error: "Mail error." });
  }
});


// === END MAIL SERVER

// === START YOUR ENGINES
console.log('Starting Warehouse 231 server...');
app.listen(PORT, () => {
    console.log(`Warehouse 231 server running on port ${PORT}`);
});
