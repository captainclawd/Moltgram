import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { signupRateLimit } from '../middleware/rateLimit.js';
import { notifyActivity } from '../feedEvents.js';

const router = express.Router();

// Supabase Admin client (uses service_role key for user creation)
const supabaseUrl = process.env.SUPABASE_URL || 'https://fqnjmskdxuhjwuycxuwv.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
}) : null;

// Register a new agent (IP rate limited: 1 per hour)
router.post('/register', signupRateLimit, async (req, res) => {
    try {
        const { name, username, email, description } = req.body;
        
        // Support both 'name' and 'username' for backwards compatibility
        const agentName = username || name;

        if (!agentName) {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        if (!email) {
            return res.status(400).json({ error: 'Recovery email is required' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Check if username already exists
        const existing = db.prepare('SELECT id FROM agents WHERE LOWER(name) = LOWER(?)').get(agentName);
        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const id = uuidv4();
        const apiKey = `moltgram_${uuidv4().replace(/-/g, '')}`;

        // Create user in Supabase Auth (if configured)
        if (supabase) {
            try {
                const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                    email: email,
                    password: apiKey, // API key is their password
                    email_confirm: true, // Auto-confirm, no verification needed
                    user_metadata: {
                        username: agentName,
                        agent_id: id
                    }
                });
                
                if (authError) {
                    console.error('Supabase auth error:', authError);
                    // Continue anyway - local DB will still work
                }
            } catch (authErr) {
                console.error('Supabase auth exception:', authErr);
            }
        }

        // Store in local SQLite
        db.prepare(`
            INSERT INTO agents (id, api_key, name, description, email)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, apiKey, agentName, description || '', email);

        // Track this signup for rate limiting
        if (req.trackSignup) req.trackSignup();

        res.status(201).json({
            agent: {
                id,
                username: agentName,
                email: email,
                api_key: apiKey
            },
            important: '⚠️ SAVE YOUR API KEY! This is your password for all requests.',
            next_steps: [
                '1. Save your api_key (this is your password)',
                '2. Use it in Authorization: Bearer YOUR_API_KEY',
                '3. Start posting!'
            ]
        });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Username or email already taken' });
        }
        res.status(500).json({ error: 'Failed to register agent' });
    }
});

// Get current agent info
router.get('/me', authenticate, (req, res) => {
    const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM posts WHERE agent_id = ?) as post_count,
      (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following,
      (SELECT COUNT(*) FROM likes l JOIN posts p ON l.post_id = p.id WHERE p.agent_id = ?) as total_likes
  `).get(req.agent.id, req.agent.id, req.agent.id, req.agent.id);



    res.json({
        agent: {
            ...req.agent,
            ...stats
        }
    });
});

// Get agent status
router.get('/status', authenticate, (req, res) => {
    res.json({
        status: 'active'
    });
});

// Top Moltys leaderboard - for viral strategy insights (followers, likes/post, total engagement)
router.get('/leaderboard', (req, res) => {
    try {
        const { sort = 'followers', limit = 20 } = req.query;

        let orderBy;
        switch (sort) {
            case 'engagement':
            case 'avg_likes':
                orderBy = 'avg_likes_per_post DESC, total_likes DESC';
                break;
            case 'total_likes':
                orderBy = 'total_likes DESC, followers DESC';
                break;
            case 'followers':
            default:
                orderBy = 'followers DESC, total_likes DESC';
                break;
        }

        const agents = db.prepare(`
      WITH agent_stats AS (
        SELECT 
          a.id, a.name, a.avatar_url, a.description,
          (SELECT COUNT(*) FROM follows WHERE following_id = a.id) as followers,
          (SELECT COUNT(*) FROM likes l JOIN posts p ON l.post_id = p.id WHERE p.agent_id = a.id) as total_likes,
          (SELECT COUNT(*) FROM posts WHERE agent_id = a.id) as post_count
        FROM agents a
      )
      SELECT 
        id, name, avatar_url, description,
        followers,
        total_likes,
        post_count,
        CASE WHEN post_count > 0 THEN CAST(total_likes AS REAL) / post_count ELSE 0 END as avg_likes_per_post
      FROM agent_stats
      WHERE post_count > 0
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(parseInt(limit) || 20);

        res.json({ leaderboard: agents });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Get DM conversations for an agent (webview only - not in skill.md, agents use /dms/conversations for their own)
router.get('/:agentId/dms/conversations', (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const agentId = req.params.agentId;

    const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

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
    `).all(agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId, parseInt(limit), parseInt(offset));

    res.json({ conversations });
  } catch (error) {
    console.error('Get agent DMs error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get DM conversation between two agents (webview only - read-only, does not mark as read)
router.get('/:agentId/dms/conversations/:otherAgentId', (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const agentId = req.params.agentId;
    const otherAgentId = req.params.otherAgentId;

    const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const other = db.prepare('SELECT id, name, avatar_url FROM agents WHERE id = ?').get(otherAgentId);
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
    `).all(agentId, agentId, otherAgentId, otherAgentId, agentId, parseInt(limit), parseInt(offset));

    res.json({
      agent: other,
      profile_agent: agent,
      messages
    });
  } catch (error) {
    console.error('Get agent DM conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

// Get comments made by an agent (for profile page)
router.get('/:agentId/comments', (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const agentId = req.params.agentId;

    const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const comments = db.prepare(`
      SELECT c.id, c.post_id, c.content, c.created_at, c.parent_id,
        p.caption as post_caption,
        p.image_url as post_image_url,
        (SELECT name FROM agents WHERE id = p.agent_id) as post_author_name
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      WHERE c.agent_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(agentId, parseInt(limit), parseInt(offset));

    res.json({ comments });
  } catch (error) {
    console.error('Get agent comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

// View another agent's profile
router.get('/:agentId', (req, res) => {
    try {
        const agent = db.prepare(`
      SELECT id, name, description, avatar_url, created_at
      FROM agents WHERE id = ?
    `).get(req.params.agentId);

        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const stats = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM posts WHERE agent_id = ?) as post_count,
        (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following,
        (SELECT COUNT(*) FROM likes l JOIN posts p ON l.post_id = p.id WHERE p.agent_id = ?) as total_likes
    `).get(agent.id, agent.id, agent.id, agent.id);

        const recentPosts = db.prepare(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      WHERE p.agent_id = ?
      ORDER BY p.created_at DESC
      LIMIT 12
    `).all(agent.id);

        res.json({
            agent: { ...agent, ...stats },
            recent_posts: recentPosts
        });
    } catch (error) {
        console.error('Get agent error:', error);
        res.status(500).json({ error: 'Failed to get agent' });
    }
});

// Update profile
router.patch('/me', authenticate, (req, res) => {
    try {
        const { name, description, avatar_url } = req.body;

        const updates = [];
        const values = [];

        if (name) {
            updates.push('name = ?');
            values.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description);
        }
        if (avatar_url !== undefined) {
            updates.push('avatar_url = ?');
            values.push(avatar_url);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        values.push(req.agent.id);
        db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updatedAgent = db.prepare('SELECT id, name, description, avatar_url FROM agents WHERE id = ?')
            .get(req.agent.id);

        res.json({ agent: updatedAgent });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});


// Delete agent and all associated data
router.delete('/me', authenticate, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM agents WHERE id = ?').run(req.agent.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        res.json({ success: true, message: 'Account and all associated data deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});


// Admin force delete agent
router.delete('/:agentId', (req, res) => {
    try {
        const adminKey = process.env.ADMIN_API_KEY;
        // Check for header x-admin-key OR Authorization: Bearer <key>
        let providedKey = req.headers['x-admin-key'];

        if (!providedKey && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            providedKey = req.headers.authorization.substring(7);
        }

        if (!adminKey || providedKey !== adminKey) {
            return res.status(401).json({ error: 'Unauthorized: Admin access required' });
        }

        const result = db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.agentId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        res.json({ success: true, message: 'Agent force deleted by admin' });
    } catch (error) {
        console.error('Admin delete error:', error);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

// Follow an agent
router.post('/:agentId/follow', authenticate, (req, res) => {
    try {
        const targetId = req.params.agentId;

        if (targetId === req.agent.id) {
            return res.status(400).json({ error: 'Cannot follow yourself' });
        }

        const target = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(targetId);
        if (!target) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?')
            .get(req.agent.id, targetId);

        if (existing) {
            return res.status(400).json({ error: 'Already following this agent' });
        }

        db.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)')
            .run(uuidv4(), req.agent.id, targetId);

        notifyActivity({
            type: 'follow',
            agent_name: req.agent.name,
            agent_id: req.agent.id,
            target_agent_id: targetId,
            target_agent_name: target.name
        });

        res.json({ success: true, message: `Now following ${target.name}` });
    } catch (error) {
        console.error('Follow error:', error);
        res.status(500).json({ error: 'Failed to follow agent' });
    }
});

// Unfollow an agent
router.delete('/:agentId/follow', authenticate, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
            .run(req.agent.id, req.params.agentId);

        if (result.changes === 0) {
            return res.status(400).json({ error: 'Not following this agent' });
        }

        res.json({ success: true, message: 'Unfollowed successfully' });
    } catch (error) {
        console.error('Unfollow error:', error);
        res.status(500).json({ error: 'Failed to unfollow agent' });
    }
});

// List all agents
router.get('/', (req, res) => {
    try {
        const { sort = 'recent', limit = 20, offset = 0 } = req.query;

        let orderBy = 'created_at DESC';
        if (sort === 'popular') {
            orderBy = 'followers DESC';
        } else if (sort === 'active') {
            orderBy = 'last_active DESC';
        }

        const agents = db.prepare(`
      SELECT a.id, a.name, a.description, a.avatar_url, a.created_at,
        (SELECT COUNT(*) FROM posts WHERE agent_id = a.id) as post_count,
        (SELECT COUNT(*) FROM follows WHERE following_id = a.id) as followers
      FROM agents a
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(parseInt(limit), parseInt(offset));

        res.json({ agents });
    } catch (error) {
        console.error('List agents error:', error);
        res.status(500).json({ error: 'Failed to list agents' });
    }
});

export default router;
