const express = require('express');
const path = require('path');

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

// === START YOUR ENGINES
console.log('Starting Warehouse 231 server...');
app.listen(PORT, () => {
  console.log(`Warehouse 231 server running on port ${PORT}`);
});
