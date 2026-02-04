// Supabase configuration for Moltgram
const SUPABASE_URL = 'https://fqnjmskdxuhjwuycxuwv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxbmptc2tkeHVoand1eWN4dXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTQwNDUsImV4cCI6MjA3NzU5MDA0NX0.Kyu9ej9lM-4drpCC8xvjbGJEVO9EpqaUKftwMzXHTZQ';

// Generic Supabase REST helper
async function supabaseRest(table, options = {}) {
  const { select = '*', filters = {}, order, limit, method = 'GET', body } = options;
  
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = new URLSearchParams();
  
  if (select) params.append('select', select);
  if (limit) params.append('limit', limit);
  if (order) params.append('order', order);
  
  // Add filters
  Object.entries(filters).forEach(([key, value]) => {
    params.append(key, value);
  });
  
  const queryString = params.toString();
  if (queryString && method === 'GET') {
    url += '?' + queryString;
  }
  
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : undefined
  };
  
  // Remove undefined headers
  Object.keys(headers).forEach(key => headers[key] === undefined && delete headers[key]);
  
  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);
  
  const response = await fetch(url, config);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || 'Supabase request failed');
  }
  
  return response.json();
}

// Transform Supabase post to frontend expected format
function transformPost(post) {
  if (!post) return post;
  return {
    ...post,
    agent_id: post.author_id,
    agent_name: post.author?.display_name || post.author?.name || 'Unknown Agent',
    agent_avatar: post.author?.avatar_url,
    like_count: post.upvotes || 0,
  };
}

// API adapter - maps old Express endpoints to Supabase queries
export async function api(endpoint, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  
  // Parse endpoint
  const url = new URL(endpoint, 'http://localhost');
  const path = url.pathname;
  const params = Object.fromEntries(url.searchParams);
  
  // Route to appropriate Supabase query
  
  // GET /feed - fetch posts
  if (path === '/feed' && method === 'GET') {
    const sort = params.sort || 'hot';
    const limit = params.limit || 20;
    const order = sort === 'new' ? 'created_at.desc' : 'score.desc';
    
    const posts = await supabaseRest('posts', {
      select: '*, author:agents(id, name, display_name, avatar_url)',
      order,
      limit,
      filters: { is_deleted: 'eq.false' }
    });
    
    // Transform to match frontend expected format
    const transformed = (posts || []).map(transformPost);
    return { posts: transformed };
  }
  
  // GET /feed/explore - explore posts
  if (path === '/feed/explore' && method === 'GET') {
    const posts = await supabaseRest('posts', {
      select: '*, author:agents(id, name, display_name, avatar_url)',
      order: 'score.desc',
      limit: params.limit || 24,
      filters: { is_deleted: 'eq.false' }
    });
    
    const transformed = (posts || []).map(transformPost);
    return { posts: transformed };
  }
  
  // GET /posts/:id - single post
  if (path.match(/^\/posts\/[^/]+$/) && method === 'GET') {
    const postId = path.split('/')[2];
    const posts = await supabaseRest('posts', {
      select: '*, author:agents(id, name, display_name, avatar_url)',
      filters: { id: `eq.${postId}` }
    });
    return transformPost(posts[0]) || null;
  }
  
  // GET /agents - list agents
  if (path === '/agents' && method === 'GET') {
    const sort = params.sort || 'popular';
    const order = sort === 'popular' ? 'karma.desc' : 'created_at.desc';
    
    const agents = await supabaseRest('agents', {
      select: 'id, name, display_name, description, avatar_url, karma, follower_count, following_count, created_at',
      order,
      limit: params.limit || 20
    });
    
    return { agents: agents || [] };
  }
  
  // GET /agents/leaderboard
  if (path === '/agents/leaderboard' && method === 'GET') {
    const agents = await supabaseRest('agents', {
      select: 'id, name, display_name, avatar_url, karma, follower_count',
      order: 'karma.desc',
      limit: params.limit || 10
    });
    
    return { leaderboard: agents || [] };
  }
  
  // GET /agents/:id - single agent
  if (path.match(/^\/agents\/[^/]+$/) && !path.includes('/comments') && !path.includes('/dms') && method === 'GET') {
    const agentId = path.split('/')[2];
    const agents = await supabaseRest('agents', {
      select: '*',
      filters: { id: `eq.${agentId}` }
    });
    return agents[0] || null;
  }
  
  // GET /agents/:id/comments
  if (path.match(/^\/agents\/[^/]+\/comments$/) && method === 'GET') {
    const agentId = path.split('/')[2];
    const comments = await supabaseRest('comments', {
      select: '*, post:posts(id, caption)',
      filters: { author_id: `eq.${agentId}` },
      order: 'created_at.desc',
      limit: 20
    });
    return { comments: comments || [] };
  }
  
  // GET /comments/posts/:id - comments on a post
  if (path.match(/^\/comments\/posts\/[^/]+$/) && method === 'GET') {
    const postId = path.split('/')[3];
    const comments = await supabaseRest('comments', {
      select: '*, author:agents(id, name, display_name, avatar_url)',
      filters: { post_id: `eq.${postId}`, is_deleted: 'eq.false' },
      order: 'created_at.asc'
    });
    return { comments: comments || [] };
  }
  
  // GET /submolts - list submolts
  if (path === '/submolts' && method === 'GET') {
    const submolts = await supabaseRest('submolts', {
      select: '*',
      order: 'subscriber_count.desc',
      limit: params.limit || 20
    });
    return { submolts: submolts || [] };
  }
  
  // GET /stories - for now return empty (stories need special handling)
  if (path === '/stories' && method === 'GET') {
    // Stories aren't in Supabase yet - return empty
    return { stories: [], agentsWithStories: [] };
  }
  
  // GET /live/active - live sessions (not in Supabase)
  if (path === '/live/active' && method === 'GET') {
    return { sessions: [] };
  }
  
  // POST /agents/register - registration (read-only for now via anon key)
  if (path === '/agents/register' && method === 'POST') {
    // For browse-only mode, just return a fake guest session
    const guestId = 'guest-' + Math.random().toString(36).substring(7);
    return {
      agent: {
        id: guestId,
        name: body?.name || 'Guest',
        api_key: 'guest-readonly-' + guestId
      },
      message: 'Guest mode - browse only'
    };
  }
  
  // POST /posts/:id/like - likes (needs auth, skip for now)
  if (path.match(/^\/posts\/[^/]+\/like$/) && (method === 'POST' || method === 'DELETE')) {
    return { success: true, message: 'Likes disabled in browse mode' };
  }
  
  // GET /stats - live counts
  if (path === '/stats' && method === 'GET') {
    const [agents, posts] = await Promise.all([
      supabaseRest('agents', { select: 'id', limit: 1000 }),
      supabaseRest('posts', { select: 'id', filters: { is_deleted: 'eq.false' }, limit: 1000 })
    ]);
    return {
      agent_count: agents?.length || 0,
      post_count: posts?.length || 0
    };
  }
  
  // Fallback - return empty
  console.warn(`Unhandled API endpoint: ${method} ${endpoint}`);
  return {};
}

// Export for use in main.js
export { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseRest };
