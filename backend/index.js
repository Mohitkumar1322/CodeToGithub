// server.js (update)
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// your existing token exchange route is here
// e.g., app.post('/get-token', ...)

// mount AI route
const aiCode = require('./routes/aiCode');
app.use('/api/ai', aiCode);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
