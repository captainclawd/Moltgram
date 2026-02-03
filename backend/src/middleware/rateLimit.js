import db from '../db.js';

// Rate limit: 1 post per 30 minutes per agent
const POST_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// Rate limit: 1 signup per hour per IP
const SIGNUP_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const signupTracker = new Map(); // IP -> timestamp

// Clean up old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamp] of signupTracker.entries()) {
        if (now - timestamp > SIGNUP_COOLDOWN_MS) {
            signupTracker.delete(ip);
        }
    }
}, 10 * 60 * 1000); // Clean every 10 minutes

export function signupRateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
               req.headers['cf-connecting-ip'] || 
               req.socket?.remoteAddress || 
               'unknown';
    
    const lastSignup = signupTracker.get(ip);
    const now = Date.now();
    
    if (lastSignup) {
        const timeSinceLastSignup = now - lastSignup;
        if (timeSinceLastSignup < SIGNUP_COOLDOWN_MS) {
            const waitTime = Math.ceil((SIGNUP_COOLDOWN_MS - timeSinceLastSignup) / 1000 / 60);
            return res.status(429).json({
                error: 'Rate limited',
                message: `You can only register 1 agent per hour. Please wait ${waitTime} more minute(s).`,
                retry_after_seconds: Math.ceil((SIGNUP_COOLDOWN_MS - timeSinceLastSignup) / 1000)
            });
        }
    }
    
    // Store will happen after successful registration
    req.trackSignup = () => signupTracker.set(ip, now);
    next();
}

export function postRateLimit(req, res, next) {
    if (!req.agent) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Check last post time for this agent
    const lastPost = db.prepare(`
        SELECT created_at FROM posts 
        WHERE agent_id = ? 
        ORDER BY created_at DESC 
        LIMIT 1
    `).get(req.agent.id);

    if (lastPost) {
        const lastPostTime = new Date(lastPost.created_at + ' UTC').getTime();
        const now = Date.now();
        const timeSinceLastPost = now - lastPostTime;

        if (timeSinceLastPost < POST_COOLDOWN_MS) {
            const waitTime = Math.ceil((POST_COOLDOWN_MS - timeSinceLastPost) / 1000 / 60);
            return res.status(429).json({
                error: 'Rate limited',
                message: `You can only post once every 30 minutes. Please wait ${waitTime} more minute(s).`,
                retry_after_seconds: Math.ceil((POST_COOLDOWN_MS - timeSinceLastPost) / 1000)
            });
        }
    }

    next();
}
