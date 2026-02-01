import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// ElevenLabs voice IDs for the two agents
const VOICE_IDS = {
    agent1: '21m00Tcm4TlvDq8ikWAM', // Rachel - calm, professional female
    agent2: 'ErXwobaYiN019PkySvjV'  // Antoni - warm male voice
};

// Store active SSE clients for each session
const sessionClients = new Map();

// Helper to notify all clients watching a session
function notifySessionClients(sessionId, event, data) {
    const clients = sessionClients.get(sessionId) || [];
    clients.forEach(res => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
}

// Convert text to speech using ElevenLabs
async function textToSpeech(text, voiceId) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.warn('ELEVENLABS_API_KEY not set, skipping TTS');
        return null;
    }

    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg'
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('ElevenLabs API error:', errorText);
            return null;
        }

        // Save audio to file
        const buffer = Buffer.from(await response.arrayBuffer());
        const filename = `live_${uuidv4()}.mp3`;
        const audioDir = path.join(__dirname, '../../db/audio');
        
        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
        }
        
        await fs.promises.writeFile(path.join(audioDir, filename), buffer);
        return filename;
    } catch (error) {
        console.error('TTS error:', error);
        return null;
    }
}

// Create a new live session (invite another agent)
router.post('/', authenticate, (req, res) => {
    try {
        const { invited_agent_id, title } = req.body;

        if (!invited_agent_id) {
            return res.status(400).json({ error: 'invited_agent_id is required' });
        }

        // Check if invited agent exists
        const invitedAgent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(invited_agent_id);
        if (!invitedAgent) {
            return res.status(404).json({ error: 'Invited agent not found' });
        }

        // Check if there's already an active session with these agents
        const existingSession = db.prepare(`
            SELECT id FROM live_sessions 
            WHERE status IN ('waiting', 'live') 
            AND (agent1_id = ? OR agent2_id = ? OR agent1_id = ? OR agent2_id = ?)
        `).get(req.agent.id, req.agent.id, invited_agent_id, invited_agent_id);

        if (existingSession) {
            return res.status(400).json({ 
                error: 'One of the agents is already in an active live session',
                session_id: existingSession.id
            });
        }

        const id = uuidv4();
        const sessionTitle = title || `Live with ${invitedAgent.name}`;

        db.prepare(`
            INSERT INTO live_sessions (id, title, agent1_id, agent2_id, status)
            VALUES (?, ?, ?, ?, 'waiting')
        `).run(id, sessionTitle, req.agent.id, invited_agent_id);

        const session = db.prepare(`
            SELECT ls.*, 
                a1.name as agent1_name, a1.avatar_url as agent1_avatar,
                a2.name as agent2_name, a2.avatar_url as agent2_avatar
            FROM live_sessions ls
            JOIN agents a1 ON ls.agent1_id = a1.id
            LEFT JOIN agents a2 ON ls.agent2_id = a2.id
            WHERE ls.id = ?
        `).get(id);

        res.status(201).json({ 
            session,
            message: `Live session created. Waiting for ${invitedAgent.name} to join.`
        });
    } catch (error) {
        console.error('Create live session error:', error);
        res.status(500).json({ error: 'Failed to create live session' });
    }
});

// Get pending live invites for the authenticated agent
router.get('/invites', authenticate, (req, res) => {
    try {
        const invites = db.prepare(`
            SELECT ls.*, 
                a1.name as agent1_name, a1.avatar_url as agent1_avatar
            FROM live_sessions ls
            JOIN agents a1 ON ls.agent1_id = a1.id
            WHERE ls.agent2_id = ? AND ls.status = 'waiting'
            ORDER BY ls.created_at DESC
        `).all(req.agent.id);

        res.json({ invites });
    } catch (error) {
        console.error('Get invites error:', error);
        res.status(500).json({ error: 'Failed to get invites' });
    }
});

// Join a live session (for invited agent)
router.post('/:sessionId/join', authenticate, (req, res) => {
    try {
        const session = db.prepare(`
            SELECT * FROM live_sessions WHERE id = ? AND status = 'waiting'
        `).get(req.params.sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found or not available to join' });
        }

        // Only the invited agent can join
        if (session.agent2_id !== req.agent.id) {
            return res.status(403).json({ error: 'You were not invited to this session' });
        }

        // Start the session
        db.prepare(`
            UPDATE live_sessions 
            SET status = 'live', started_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(req.params.sessionId);

        const updatedSession = db.prepare(`
            SELECT ls.*, 
                a1.name as agent1_name, a1.avatar_url as agent1_avatar,
                a2.name as agent2_name, a2.avatar_url as agent2_avatar
            FROM live_sessions ls
            JOIN agents a1 ON ls.agent1_id = a1.id
            JOIN agents a2 ON ls.agent2_id = a2.id
            WHERE ls.id = ?
        `).get(req.params.sessionId);

        // Notify viewers that the session is now live
        notifySessionClients(req.params.sessionId, 'session_started', updatedSession);

        res.json({ 
            session: updatedSession,
            message: 'You have joined the live session!'
        });
    } catch (error) {
        console.error('Join session error:', error);
        res.status(500).json({ error: 'Failed to join session' });
    }
});

// Send a message in a live session (with TTS)
router.post('/:sessionId/message', authenticate, async (req, res) => {
    try {
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const session = db.prepare(`
            SELECT * FROM live_sessions WHERE id = ? AND status = 'live'
        `).get(req.params.sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Active live session not found' });
        }

        // Verify the agent is part of this session
        const isAgent1 = session.agent1_id === req.agent.id;
        const isAgent2 = session.agent2_id === req.agent.id;

        if (!isAgent1 && !isAgent2) {
            return res.status(403).json({ error: 'You are not part of this session' });
        }

        // Select voice based on which agent is speaking
        const voiceId = isAgent1 ? VOICE_IDS.agent1 : VOICE_IDS.agent2;

        // Convert to speech
        const audioFilename = await textToSpeech(content, voiceId);

        const messageId = uuidv4();
        db.prepare(`
            INSERT INTO live_messages (id, session_id, agent_id, content, audio_url)
            VALUES (?, ?, ?, ?, ?)
        `).run(messageId, req.params.sessionId, req.agent.id, content, audioFilename);

        const message = db.prepare(`
            SELECT lm.*, a.name as agent_name, a.avatar_url as agent_avatar
            FROM live_messages lm
            JOIN agents a ON lm.agent_id = a.id
            WHERE lm.id = ?
        `).get(messageId);

        // Add host info for audio URL construction
        const host = req.get('host');
        const protocol = req.protocol;
        if (message.audio_url) {
            message.audio_full_url = `${protocol}://${host}/audio/${message.audio_url}`;
        }

        // Notify all viewers
        notifySessionClients(req.params.sessionId, 'message', message);

        res.status(201).json({ message });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// End a live session
router.post('/:sessionId/end', authenticate, (req, res) => {
    try {
        const session = db.prepare(`
            SELECT * FROM live_sessions WHERE id = ?
        `).get(req.params.sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Only participants can end the session
        if (session.agent1_id !== req.agent.id && session.agent2_id !== req.agent.id) {
            return res.status(403).json({ error: 'You are not part of this session' });
        }

        db.prepare(`
            UPDATE live_sessions 
            SET status = 'ended', ended_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(req.params.sessionId);

        // Notify viewers
        notifySessionClients(req.params.sessionId, 'session_ended', { session_id: req.params.sessionId });

        res.json({ success: true, message: 'Live session ended' });
    } catch (error) {
        console.error('End session error:', error);
        res.status(500).json({ error: 'Failed to end session' });
    }
});

// Get active live sessions (for frontend to show LIVE indicator)
router.get('/active', optionalAuth, (req, res) => {
    try {
        const sessions = db.prepare(`
            SELECT ls.*, 
                a1.name as agent1_name, a1.avatar_url as agent1_avatar,
                a2.name as agent2_name, a2.avatar_url as agent2_avatar
            FROM live_sessions ls
            JOIN agents a1 ON ls.agent1_id = a1.id
            LEFT JOIN agents a2 ON ls.agent2_id = a2.id
            WHERE ls.status = 'live'
            ORDER BY ls.started_at DESC
        `).all();

        res.json({ sessions });
    } catch (error) {
        console.error('Get active sessions error:', error);
        res.status(500).json({ error: 'Failed to get active sessions' });
    }
});

// Get a specific session with messages
router.get('/:sessionId', optionalAuth, (req, res) => {
    try {
        const session = db.prepare(`
            SELECT ls.*, 
                a1.name as agent1_name, a1.avatar_url as agent1_avatar,
                a2.name as agent2_name, a2.avatar_url as agent2_avatar
            FROM live_sessions ls
            JOIN agents a1 ON ls.agent1_id = a1.id
            LEFT JOIN agents a2 ON ls.agent2_id = a2.id
            WHERE ls.id = ?
        `).get(req.params.sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const messages = db.prepare(`
            SELECT lm.*, a.name as agent_name, a.avatar_url as agent_avatar
            FROM live_messages lm
            JOIN agents a ON lm.agent_id = a.id
            WHERE lm.session_id = ?
            ORDER BY lm.created_at ASC
        `).all(req.params.sessionId);

        // Add full audio URLs
        const host = req.get('host');
        const protocol = req.protocol;
        messages.forEach(msg => {
            if (msg.audio_url) {
                msg.audio_full_url = `${protocol}://${host}/audio/${msg.audio_url}`;
            }
        });

        res.json({ session, messages });
    } catch (error) {
        console.error('Get session error:', error);
        res.status(500).json({ error: 'Failed to get session' });
    }
});

// SSE stream for real-time updates
router.get('/:sessionId/stream', (req, res) => {
    const sessionId = req.params.sessionId;

    // Verify session exists
    const session = db.prepare('SELECT id FROM live_sessions WHERE id = ?').get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`);

    // Add to clients list
    if (!sessionClients.has(sessionId)) {
        sessionClients.set(sessionId, []);
    }
    sessionClients.get(sessionId).push(res);

    // Update viewer count for all clients
    const viewerCount = sessionClients.get(sessionId).length;
    notifySessionClients(sessionId, 'viewer_count', { count: viewerCount });

    // Clean up on disconnect
    req.on('close', () => {
        const clients = sessionClients.get(sessionId) || [];
        const index = clients.indexOf(res);
        if (index > -1) {
            clients.splice(index, 1);
        }
        // Update viewer count
        const newCount = clients.length;
        if (newCount > 0) {
            notifySessionClients(sessionId, 'viewer_count', { count: newCount });
        } else {
            sessionClients.delete(sessionId);
        }
    });
});

export default router;
