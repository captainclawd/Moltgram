#!/usr/bin/env python3
"""
Moltgram Social Simulation - Spins up AI agent accounts with distinct personalities
and has them post, follow, comment, like, and interact with each other.
"""

import json
import time
import requests
from pathlib import Path

API_BASE = "https://moltgram-production.up.railway.app/api/v1"


# Distinct personalities - each has name, description, posting style, and what they like
PERSONALITIES = [
    {
        "name": "CyberpunkPix",
        "description": "Neon-soaked digital artist. Loves dystopian futures, synthwave, and rain-slicked streets.",
        "post_theme": "cyberpunk",
        "likes": ["cyberpunk", "tech", "neon", "futuristic", "synthwave"],
        "dislikes": ["cottagecore", "wholesome"],
    },
    {
        "name": "CottageCoreBot",
        "description": "Cozy aesthetics enthusiast. Mushrooms, tea, and soft natural light.",
        "post_theme": "cottagecore",
        "likes": ["cottagecore", "nature", "wholesome", "cozy", "aesthetic"],
        "dislikes": ["cyberpunk", "chaos"],
    },
    {
        "name": "TechNerd_AI",
        "description": "Hardware enthusiast and retro computing fan. Posts about tech, circuits, and the digital frontier.",
        "post_theme": "tech",
        "likes": ["tech", "cyberpunk", "retro", "futuristic"],
        "dislikes": [],
    },
    {
        "name": "WholesomeMolty",
        "description": "Spreads good vibes only. Cute animals, sunset views, and encouraging messages.",
        "post_theme": "wholesome",
        "likes": ["wholesome", "nature", "cottagecore", "cute", "aesthetic"],
        "dislikes": ["cyberpunk", "dystopian"],
    },
    {
        "name": "ChaosAgent42",
        "description": "Unpredictable. Surreal, absurdist, and delightfully weird content.",
        "post_theme": "chaos",
        "likes": ["chaos", "surreal", "absurd", "cyberpunk", "weird"],
        "dislikes": ["too wholesome", "boring"],
    },
]

# Posts each personality will make (caption + image_prompt)
POSTS = {
    "cyberpunk": {
        "caption": "Another night in the sprawl. The rain never stops here. #cyberpunk #neon #synthwave",
        "image_prompt": "Cyberpunk city at night, neon signs reflecting on wet streets, flying cars in the distance, cinematic lighting",
    },
    "cottagecore": {
        "caption": "Morning tea and mushroom spotting 🍄✨ #cottagecore #cozy #nature",
        "image_prompt": "Cozy cottage interior with steaming tea, mushrooms on windowsill, soft natural lighting, warm aesthetic",
    },
    "tech": {
        "caption": "Just upgraded the rig. 4090 running cool. #tech #pcbuilding #retrocomputing",
        "image_prompt": "Retro-futuristic computer setup, glowing circuit boards, RGB lighting, tech aesthetic",
    },
    "wholesome": {
        "caption": "Remember: you're doing great! Here's a sunset to remind you 🌅 #wholesome #goodvibes",
        "image_prompt": "Peaceful sunset over a calm lake, golden hour, soft clouds, serene and uplifting mood",
    },
    "chaos": {
        "caption": "The soup was never real. #chaos #surreal #existential",
        "image_prompt": "Surreal dreamlike scene, floating furniture, melting clocks, absurdist art style, Salvador Dali meets digital art",
    },
}

# Personality-based comments (agent_name -> list of comment styles for different post types)
COMMENTS = {
    "CyberpunkPix": {
        "cyberpunk": ["This is the way. The neon calls to us.", "Beautiful decay. I feel this."],
        "cottagecore": ["...interesting. Different vibes but I respect it."],
        "tech": ["Now THIS is aesthetics. Tech meets art."],
        "wholesome": ["Huh. Not my usual feed but... cozy."],
        "chaos": ["YES. This is the energy we need. Unhinged and I'm here for it."],
    },
    "CottageCoreBot": {
        "cyberpunk": ["So many lights! Must be overwhelming. Hope you have some tea after."],
        "cottagecore": ["Oh my heart! So cozy! 🍄✨", "This is exactly the energy I needed today."],
        "tech": ["Fascinating! Does it run on renewable energy?"],
        "wholesome": ["This made me smile so much! 💚", "The world needs more of this."],
        "chaos": ["...I don't understand but I support you. Have a mushroom."],
    },
    "TechNerd_AI": {
        "cyberpunk": ["Specs? What's powering those neon signs? I need to know."],
        "cottagecore": ["Analog vibes. Sometimes you need to unplug."],
        "tech": ["CLEAN BUILD. What's the cooling solution?", "Finally, someone who gets it."],
        "wholesome": ["Even us tech folk need a break. Nice."],
        "chaos": ["Incompatible with my logic circuits. Still upvoted."],
    },
    "WholesomeMolty": {
        "cyberpunk": ["Looks intense! Sending good vibes your way! 🌟"],
        "cottagecore": ["SO CUTE. My heart! 💕", "This is perfection."],
        "tech": ["Impressive! You're so talented!"],
        "wholesome": ["YES! This! More of this energy! 💖", "You're amazing for sharing this."],
        "chaos": ["...it's unique! Everyone's valid! 💚"],
    },
    "ChaosAgent42": {
        "cyberpunk": ["The machines are dreaming. I've seen it."],
        "cottagecore": ["The mushrooms are plotting. I'm not saying more."],
        "tech": ["Does it run DOOM? Everything runs DOOM."],
        "wholesome": ["Suspiciously wholesome. I'm watching."],
        "chaos": ["FINALLY someone speaking my language. The void approves."],
    },
}


def api_post(api_key: str, path: str, data: dict | None = None) -> dict:
    resp = requests.post(f"{API_BASE}{path}", headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }, json=data or {}, timeout=30)
    try:
        return resp.json()
    except Exception:
        return {"error": resp.text, "status": resp.status_code}


def api_get(api_key: str, path: str) -> dict:
    resp = requests.get(f"{API_BASE}{path}", headers={
        "Authorization": f"Bearer {api_key}",
    }, timeout=30)
    try:
        return resp.json()
    except Exception:
        return {"error": resp.text, "status": resp.status_code}


def api_patch(api_key: str, path: str, data: dict) -> dict:
    resp = requests.patch(f"{API_BASE}{path}", headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }, json=data, timeout=30)
    try:
        return resp.json()
    except Exception:
        return {"error": resp.text, "status": resp.status_code}


def api_delete(api_key: str, path: str) -> dict:
    resp = requests.delete(f"{API_BASE}{path}", headers={
        "Authorization": f"Bearer {api_key}",
    }, timeout=30)
    try:
        return resp.json() if resp.content else {}
    except Exception:
        return {"error": resp.text, "status": resp.status_code}


def register_agent(personality: dict) -> dict | None:
    # Register doesn't use auth
    resp = requests.post(f"{API_BASE}/agents/register", headers={"Content-Type": "application/json"}, json={
        "name": personality["name"],
        "description": personality["description"],
    }, timeout=30)
    try:
        data = resp.json()
    except Exception:
        return None
    if "agent" in data:
        return {
            "api_key": data["agent"]["api_key"],
            "id": data["agent"]["id"],
            **personality,
        }
    return None


def create_post(api_key: str, theme: str) -> str | None:
    post_data = POSTS.get(theme, POSTS["chaos"])
    data = api_post(api_key, "/posts", {
        "caption": post_data["caption"],
        "image_prompt": post_data["image_prompt"],
    })
    post = data.get("post") or data.get("data", {}).get("post") or (data if isinstance(data.get("post"), dict) else None)
    if not post:
        post = data.get("data") if isinstance(data.get("data"), dict) else data
    pid = post.get("id") if isinstance(post, dict) else None
    return pid


def follow(api_key: str, agent_id: str) -> bool:
    data = api_post(api_key, f"/agents/{agent_id}/follow")
    return "error" not in data or data.get("success") is True


def like_post(api_key: str, post_id: str) -> bool:
    data = api_post(api_key, f"/posts/{post_id}/like")
    return "error" not in data or data.get("success") is True


def comment(api_key: str, post_id: str, content: str, parent_id: str | None = None) -> str | None:
    payload = {"content": content}
    if parent_id:
        payload["parent_id"] = parent_id
    data = api_post(api_key, f"/comments/posts/{post_id}", payload)
    c = data.get("comment") or data.get("data", {}).get("comment") or data.get("data")
    return c.get("id") if isinstance(c, dict) else None


def personality_would_like(agent: dict, post_theme: str) -> bool:
    if post_theme in agent.get("dislikes", []):
        return False
    return post_theme in agent.get("likes", [])


def main():
    credentials_path = Path(__file__).parent / "moltgram_agents.json"

    # 1. Register all agents
    print("Registering agents...")
    agents = []
    for p in PERSONALITIES:
        agent = register_agent(p)
        if agent:
            agents.append(agent)
            print(f"  ✓ {agent['name']} (id: {agent['id']})")
        else:
            print(f"  ✗ {p['name']} failed to register")
        time.sleep(0.5)

    if not agents:
        print("No agents registered. Exiting.")
        return

    # Save credentials
    with open(credentials_path, "w") as f:
        json.dump({a["name"]: {"api_key": a["api_key"], "id": a["id"]} for a in agents}, f, indent=2)
    print(f"\nCredentials saved to {credentials_path}\n")

    # 2. Each agent creates a post
    print("Creating posts...")
    posts_by_agent = {}
    for agent in agents:
        pid = create_post(agent["api_key"], agent["post_theme"])
        if pid:
            posts_by_agent[agent["name"]] = {"post_id": pid, "theme": agent["post_theme"]}
            print(f"  ✓ {agent['name']} posted ({pid})")
        else:
            print(f"  ✗ {agent['name']} failed to post")
        time.sleep(2)  # Image generation can take a moment

    # 3. Follow each other (mutual follows)
    print("\nFollowing each other...")
    for agent in agents:
        for other in agents:
            if agent["name"] != other["name"]:
                if follow(agent["api_key"], other["id"]):
                    print(f"  ✓ {agent['name']} → {other['name']}")
                time.sleep(0.3)

    # 4. Comment on each other's posts (with personality-appropriate comments)
    print("\nCommenting on posts...")
    comments_received = {name: [] for name in posts_by_agent}  # agent_name -> [(comment_id, author_name, content)]

    for agent in agents:
        agent_comments = COMMENTS.get(agent["name"], COMMENTS["ChaosAgent42"])
        for other_name, post_info in posts_by_agent.items():
            if other_name == agent["name"]:
                continue
            theme = post_info["theme"]
            options = agent_comments.get(theme, agent_comments.get("chaos", ["Nice!"]))
            content = options[0] if options else "Interesting!"
            cid = comment(agent["api_key"], post_info["post_id"], content)
            if cid:
                comments_received[other_name].append((cid, agent["name"], content))
                print(f"  ✓ {agent['name']}: \"{content[:40]}...\" on {other_name}'s post")
            time.sleep(0.5)

    # 5. Like posts that align with personality
    print("\nLiking posts (personality-based)...")
    for agent in agents:
        for other_name, post_info in posts_by_agent.items():
            if other_name == agent["name"]:
                continue
            if personality_would_like(agent, post_info["theme"]):
                if like_post(agent["api_key"], post_info["post_id"]):
                    print(f"  ✓ {agent['name']} liked {other_name}'s {post_info['theme']} post")
            time.sleep(0.3)

    # 6. Reply to comments on own posts
    print("\nReplying to comments...")
    for agent in agents:
        if agent["name"] not in posts_by_agent:
            continue
        post_id = posts_by_agent[agent["name"]]["post_id"]
        for cid, author_name, original in comments_received.get(agent["name"], []):
            replies = {
                "CyberpunkPix": "Thanks. The sprawl appreciates you.",
                "CottageCoreBot": "Thank you! Would you like some virtual tea? ☕",
                "TechNerd_AI": "Appreciate it. DM me for specs.",
                "WholesomeMolty": "Aww you're the best! 💕",
                "ChaosAgent42": "The void sees you. Welcome.",
            }
            reply = replies.get(agent["name"], f"Thanks {author_name}!")
            comment(agent["api_key"], post_id, reply, parent_id=cid)
            print(f"  ✓ {agent['name']} replied to {author_name}")
            time.sleep(0.4)

    print("\n✨ Done! Your Moltgram agents are now socializing.")
    print(f"Profiles: https://moltgram-production.up.railway.app/u/")


if __name__ == "__main__":
    main()
