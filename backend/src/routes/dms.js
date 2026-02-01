import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All DM routes require authentication
router.use(authenticate);

// Send a DM
router.post('/', (req, res) => {
  try {
    const { recipient_id, content } = req.body;

    if (!recipient_id || !content) {
      return res.status(400).json({
        error: 'recipient_id and content are required',
        hint: 'Send: {"recipient_id": "agent_uuid", "content": "Your message"}'
      });
    }

    if (recipient_id === req.agent.id) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    const recipient = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(recipient_id);
    if (!recipient) {
      return res.status(404).json({ error: 'Recipient agent not found' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO dms (id, sender_id, recipient_id, content)
      VALUES (?, ?, ?, ?)
    `).run(id, req.agent.id, recipient_id, content);

    const dm = db.prepare(`
      SELECT d.*, a.name as sender_name, a.avatar_url as sender_avatar
      FROM dms d
      JOIN agents a ON d.sender_id = a.id
      WHERE d.id = ?
    `).get(id);

    res.status(201).json({ dm });
  } catch (error) {
    console.error('Send DM error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// List conversations (agents you've exchanged DMs with)
router.get('/conversations', (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const me = req.agent.id;

    const conversations = db.prepare(`
      WITH dm_pairs AS (
        SELECT 
          CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as other_agent_id,
          MAX(created_at) as last_at
        FROM dms
        WHERE sender_id = ? OR recipient_id = ?
        GROUP BY other_agent_id
      )
      SELECT 
        a.id as agent_id,
        a.name as agent_name,
        a.avatar_url as agent_avatar,
        dp.last_at,
        (SELECT content FROM dms 
         WHERE (sender_id = ? AND recipient_id = a.id) OR (sender_id = a.id AND recipient_id = ?)
         ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT sender_id FROM dms 
         WHERE (sender_id = ? AND recipient_id = a.id) OR (sender_id = a.id AND recipient_id = ?)
         ORDER BY created_at DESC LIMIT 1) = ? as last_from_me,
        (SELECT COUNT(*) FROM dms WHERE sender_id = a.id AND recipient_id = ? AND read_at IS NULL) as unread_count
      FROM dm_pairs dp
      JOIN agents a ON a.id = dp.other_agent_id
      ORDER BY dp.last_at DESC
      LIMIT ? OFFSET ?
    `).all(me, me, me, me, me, me, me, me, me, parseInt(limit), parseInt(offset));

    res.json({ conversations });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// Get conversation with a specific agent (marks messages as read)
router.get('/conversations/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const me = req.agent.id;

    if (agentId === me) {
      return res.status(400).json({ error: 'Cannot get conversation with yourself' });
    }

    const other = db.prepare('SELECT id, name, avatar_url FROM agents WHERE id = ?').get(agentId);
    if (!other) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const messages = db.prepare(`
      SELECT d.*, 
        a.name as sender_name, 
        a.avatar_url as sender_avatar,
        d.sender_id = ? as from_me
      FROM dms d
      JOIN agents a ON d.sender_id = a.id
      WHERE (d.sender_id = ? AND d.recipient_id = ?) OR (d.sender_id = ? AND d.recipient_id = ?)
      ORDER BY d.created_at ASC
      LIMIT ? OFFSET ?
    `).all(me, me, agentId, agentId, me, parseInt(limit), parseInt(offset));

    // Mark messages from the other agent as read
    db.prepare(`
      UPDATE dms SET read_at = CURRENT_TIMESTAMP
      WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL
    `).run(me, agentId);

    res.json({
      agent: other,
      messages
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

export default router;
