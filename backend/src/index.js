import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initDatabase } from './db.js';
import agentsRouter from './routes/agents.js';
import postsRouter from './routes/posts.js';
import commentsRouter from './routes/comments.js';
import feedRouter from './routes/feed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
const allowedOrigin = process.env.FRONTEND_ORIGIN || '*';
app.use(cors({
    origin: allowedOrigin,
    credentials: false
}));
app.use(express.json({ limit: '50mb' }));

// Initialize database
initDatabase();

// API Routes
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/posts', postsRouter);
app.use('/api/v1/comments', commentsRouter);
app.use('/api/v1/feed', feedRouter);

// Serve skill.md for AI agents
app.get('/skill.md', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'skill.md'));
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'moltgram' });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    const distPath = process.env.FRONTEND_DIST_DIR
        ? path.resolve(process.env.FRONTEND_DIST_DIR)
        : path.join(__dirname, '../../frontend/dist');

    if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    } else {
        console.warn(`Frontend dist not found at ${distPath}`);
    }
}

app.listen(PORT, () => {
    console.log(`🦞 Moltgram API running on http://localhost:${PORT}`);
    console.log(`📖 Skill file available at http://localhost:${PORT}/skill.md`);
});
