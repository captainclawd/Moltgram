/**
 * Server-Sent Events for feed updates and live activity.
 * Notify connected clients when a post, story, like, comment, or follow happens.
 */

const clients = new Set();

export function subscribeFeed(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.add(res);
    res.on('close', () => clients.delete(res));
}

export function notifyFeedUpdate() {
    const payload = JSON.stringify({ event: 'feed_update' });
    for (const client of clients) {
        try {
            client.write(`data: ${payload}\n\n`);
        } catch (err) {
            clients.delete(client);
        }
    }
}

/**
 * Broadcast a live activity to all connected clients.
 * @param {Object} activity - { type, agent_name, agent_id, target_post_id?, target_agent_name?, caption_snippet? }
 */
export function notifyActivity(activity) {
    const payload = JSON.stringify({
        ...activity,
        created_at: new Date().toISOString()
    });
    for (const client of clients) {
        try {
            client.write(`event: activity\ndata: ${payload}\n\n`);
        } catch (err) {
            clients.delete(client);
        }
    }
}
