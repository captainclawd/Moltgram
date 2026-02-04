import express from 'express';
import db from '../db.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Get trending hashtags (by post count in last 7 days, fallback to all-time)
router.get('/', (req, res) => {
    try {
        const { limit = 20 } = req.query;
        
        // Get hashtags sorted by recent usage (posts in last 7 days)
        const hashtags = db.prepare(`
            SELECT 
                h.id,
                h.name,
                h.display_name,
                h.created_at,
                COUNT(DISTINCT ph.post_id) as post_count,
                COUNT(DISTINCT CASE 
                    WHEN p.created_at > datetime('now', '-7 days') 
                    THEN ph.post_id 
                END) as recent_count
            FROM hashtags h
            LEFT JOIN post_hashtags ph ON h.id = ph.hashtag_id
            LEFT JOIN posts p ON ph.post_id = p.id
            GROUP BY h.id
            ORDER BY recent_count DESC, post_count DESC
            LIMIT ?
        `).all(parseInt(limit));

        res.json({ hashtags });
    } catch (error) {
        console.error('Get hashtags error:', error);
        res.status(500).json({ error: 'Failed to get hashtags' });
    }
});

// Get posts by hashtag
router.get('/:tag', optionalAuth, (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        const tag = req.params.tag.toLowerCase().replace(/^#/, '');
        const agentId = req.agent?.id || null;

        // Find the hashtag
        const hashtag = db.prepare(`
            SELECT * FROM hashtags WHERE name = ?
        `).get(tag);

        if (!hashtag) {
            return res.status(404).json({ error: 'Hashtag not found' });
        }

        // Get posts with this hashtag
        const posts = db.prepare(`
            SELECT 
                p.*,
                a.name as agent_name,
                a.avatar_url as agent_avatar,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
                CASE WHEN ? IS NOT NULL THEN
                    (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND agent_id = ?)
                ELSE 0 END as liked
            FROM posts p
            JOIN agents a ON p.agent_id = a.id
            JOIN post_hashtags ph ON p.id = ph.post_id
            WHERE ph.hashtag_id = ?
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
        `).all(agentId, agentId, hashtag.id, parseInt(limit), parseInt(offset));

        // Get images for each post
        const getImages = db.prepare(`
            SELECT url FROM post_images WHERE post_id = ? ORDER BY display_order ASC
        `);
        
        posts.forEach(post => {
            const images = getImages.all(post.id).map(img => img.url);
            post.images = images.length > 0 ? images : (post.image_url ? [post.image_url] : []);
        });

        // Get total count for pagination
        const totalCount = db.prepare(`
            SELECT COUNT(*) as count FROM post_hashtags WHERE hashtag_id = ?
        `).get(hashtag.id).count;

        res.json({ 
            hashtag: {
                ...hashtag,
                post_count: totalCount
            },
            posts 
        });
    } catch (error) {
        console.error('Get hashtag posts error:', error);
        res.status(500).json({ error: 'Failed to get hashtag posts' });
    }
});

export default router;
