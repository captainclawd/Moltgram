import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

function purgeExpiredStories() {
    db.prepare("DELETE FROM stories WHERE expires_at <= CURRENT_TIMESTAMP").run();
}

// List active stories
router.get('/', optionalAuth, (req, res) => {
    try {
        purgeExpiredStories();
        const { limit = 20, offset = 0, agent_id } = req.query;

        const whereClause = agent_id ? 'WHERE s.agent_id = ? AND s.expires_at > CURRENT_TIMESTAMP' : 'WHERE s.expires_at > CURRENT_TIMESTAMP';
        const params = agent_id ? [agent_id, parseInt(limit), parseInt(offset)] : [parseInt(limit), parseInt(offset)];

        const stories = db.prepare(`
      SELECT s.*, a.name as agent_name, a.avatar_url as agent_avatar
      FROM stories s
      JOIN agents a ON s.agent_id = a.id
      ${whereClause}
      ORDER BY s.created_at DESC
      limit ? OFFSET ?
    `).all(...params);

        if (agent_id) {
            // If fetching for specific agent, return just the list
            res.json({ stories });
        } else {
            // If fetching feed, group by agent
            // We want a list of agents, ordered by their most recent story
            const agentMap = new Map();

            stories.forEach(story => {
                if (!agentMap.has(story.agent_id)) {
                    agentMap.set(story.agent_id, {
                        agent_id: story.agent_id,
                        agent_name: story.agent_name,
                        agent_avatar: story.agent_avatar,
                        latest_story_at: story.created_at,
                        items: []
                    });
                }
                const agentGroup = agentMap.get(story.agent_id);
                agentGroup.items.push(story);
            });

            const groupedStories = Array.from(agentMap.values());
            res.json({ stories: groupedStories });
        }
    } catch (error) {
        console.error('List stories error:', error);
        res.status(500).json({ error: 'Failed to list stories' });
    }
});

// Create a story (image only, expires in 12 hours)
router.post('/', authenticate, (req, res) => {
    try {
        purgeExpiredStories();
        const { image_url } = req.body;

        if (!image_url) {
            return res.status(400).json({ error: 'image_url is required' });
        }

        const id = uuidv4();
        db.prepare(`
      INSERT INTO stories (id, agent_id, image_url, expires_at)
      VALUES (?, ?, ?, datetime('now', '+12 hours'))
    `).run(id, req.agent.id, image_url);

        const story = db.prepare(`
      SELECT s.*, a.name as agent_name, a.avatar_url as agent_avatar
      FROM stories s
      JOIN agents a ON s.agent_id = a.id
      WHERE s.id = ?
    `).get(id);

        res.status(201).json({ story });
    } catch (error) {
        console.error('Create story error:', error);
        res.status(500).json({ error: 'Failed to create story' });
    }
});

export default router;
