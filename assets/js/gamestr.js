"use strict";

const GAMESTR = {
    workerUrl: "https://satsnake-worker.whitepaperinteractive.workers.dev/submit-score",
    devPubkey: "277813f913fae89093c5cb443c671c0612144c636a43f08abcde2ef2f43d4978",
    relayUrls: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],

    // State
    currentScore: 0,
    playerProfile: null,

    init() {
        // Wiring buttons
        const btnSubmit = document.getElementById("btnSubmitScore");
        if (btnSubmit) btnSubmit.onclick = () => this.submitScore();

        const btnShare = document.getElementById("btnShareScore");
        if (btnShare) btnShare.onclick = () => this.openShareModal();

        const btnPlayAgain = document.getElementById("btnPlayAgain");
        if (btnPlayAgain) btnPlayAgain.onclick = () => this.playAgain();

        const btnMainMenu = document.getElementById("btnLeaderboardMenu");
        if (btnMainMenu) btnMainMenu.onclick = () => {
            document.getElementById("leaderboard-overlay").classList.add("hidden");
            document.getElementById("game-over-popup").classList.remove("hidden");
        };

        const btnLeaderboard = document.getElementById("btnLeaderboard");
        if (btnLeaderboard) btnLeaderboard.onclick = () => this.showLeaderboard();

        // Share Modal Wiring
        const btnShareNostr = document.getElementById("btnShareNostr");
        if (btnShareNostr) btnShareNostr.onclick = () => this.performNostrShare();

        const btnCancelShare = document.getElementById("btnCancelShare");
        if (btnCancelShare) btnCancelShare.onclick = () => this.closeShareModal();

        // Fetch global high score on init
        this.fetchGlobalHighScore();
    },

    fetchGlobalHighScore() {
        console.log("Fetching global high score...");
        const socket = new WebSocket("wss://relay.damus.io"); // Using primary relay
        let highest = 0;

        socket.onopen = () => {
            const req = {
                kinds: [30762],
                authors: [this.devPubkey],
                // Removed restrictive #d filter - client-side filtering handles this
                limit: 100 // Fetch enough to find the max
            };
            socket.send(JSON.stringify(["REQ", "satsnake-hs", req]));
        };

        socket.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data[0] === "EVENT") {
                const event = data[2];
                // Client-side filtering as requested: Game: satsnake, T: test
                const gameTag = event.tags.find(t => t[0] === "game");
                const gameMatch = gameTag && gameTag[1].toLowerCase() === "satsnake";

                // Filter for t="test" tag as specified in requirements
                const hasTestTag = event.tags.some(t => t[0] === "t" && t[1] === "test");

                if (gameMatch && hasTestTag) {
                    const scoreTag = event.tags.find(t => t[0] === "score");
                    if (scoreTag) {
                        const score = parseInt(scoreTag[1]);
                        if (!isNaN(score) && score > highest) {
                            highest = score;
                        }
                    }
                }
            } else if (data[0] === "EOSE") {
                socket.close();
                console.log("Global high score fetched:", highest);

                // Update Global Stats
                if (window.stats) {
                    // Use Gamestr high score if available, otherwise fall back to local
                    const localHighScore = parseInt(localStorage.getItem("highScore")) || 0;
                    window.stats.highScore = highest > 0 ? highest : localHighScore;
                    console.log("Global high score set to:", window.stats.highScore);
                    // We do NOT save this to localStorage as it's the global high score, 
                    // effectively overriding the local PB for display purposes.
                }
            }
        };
    },

    handleGameOver(score) {
        this.currentScore = score;
        console.log("Game Over! Score:", score);

        // 1. Expire Payment Token immediately
        if (window.expireSession) {
            window.expireSession();
        }

        // 2. Show Popup
        const popup = document.getElementById("game-over-popup");
        if (popup) {
            popup.classList.remove("hidden");
            // Add avoid-clicks to game container to prevent game interaction
            document.getElementById("game-container").classList.add("avoid-clicks");
        }

        // 3. Update Score UI
        document.getElementById("finalScore").textContent = score;

        // 4. Handle Profile
        this.loadProfile();
    },

    loadProfile() {
        // Attempt to get from pay.js's storage
        const savedPubkey = localStorage.getItem("nostr_pubkey");

        if (savedPubkey) {
            // Logged in
            this.fetchProfile(savedPubkey);
        } else {
            // Guest - Generate Random
            this.generateRandomProfile();
        }
    },

    async fetchProfile(pubkey) {
        // Simple fetch from relay or use existing UI data if pay.js already loaded it
        // We can check the DOM elements populated by pay.js
        const existingName = document.getElementById("nostrProfileName").textContent;
        const existingPic = document.getElementById("nostrProfilePic").src;

        this.playerProfile = {
            name: existingName || "Nostr Player",
            pubkey: pubkey,
            picture: existingPic
        };

        this.updateProfileUI(this.playerProfile);
    },

    generateRandomProfile() {
        const adjectives = ["Neon", "Cyber", "Sats", "Crypto", "Laser", "Rusty", "Based"];
        const nouns = ["Snake", "Viper", "Ostrich", "Miner", "Hodler", "Node", "Hash"];
        const randomName = adjectives[Math.floor(Math.random() * adjectives.length)] +
            nouns[Math.floor(Math.random() * nouns.length)] +
            Math.floor(Math.random() * 100);

        // Generate random 64-char hex string for guest pubkey
        const randomPubkey = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

        this.playerProfile = {
            name: randomName,
            pubkey: randomPubkey,
            picture: "assets/logo.png" // Fallback
        };
        this.updateProfileUI(this.playerProfile);
    },

    updateProfileUI(profile) {
        document.getElementById("goProfileName").textContent = profile.name;
        document.getElementById("goProfilePic").src = profile.picture || "assets/logo.png";
    },

    playAgain() {
        // Reload page or just hide popup and show payment?
        // revocation happened at game over.
        // Reloading is safest to reset game state completely.
        window.location.reload();
    },

    openShareModal() {
        // Pre-fill text
        const text = `🐍 I just scored ${this.currentScore} points on SatSnake! Can you do better?\n\nPlay now: https://www.SatSnake@WhitepaperInteractive.com\n\n#SatSnake #Gamestr`;
        document.getElementById("shareText").value = text;

        // Determine logged-in state
        const savedPubkey = localStorage.getItem("nostr_pubkey");
        const btnShareNostr = document.getElementById("btnShareNostr");

        if (savedPubkey) {
            // Logged in
            btnShareNostr.disabled = false;
            btnShareNostr.classList.remove("ghost"); // Make it look active/primary
            btnShareNostr.classList.add("accent");
            btnShareNostr.title = "";
        } else {
            // Guest / Not logged in
            btnShareNostr.disabled = true;
            btnShareNostr.classList.remove("accent");
            btnShareNostr.classList.add("ghost");
            btnShareNostr.title = "Login to Nostr to share";
        }

        // Show popup
        document.getElementById("share-popup").classList.remove("hidden");
    },

    closeShareModal() {
        document.getElementById("share-popup").classList.add("hidden");
    },

    async performNostrShare() {
        const textArea = document.getElementById("shareText");
        const text = textArea.value;
        const savedPubkey = localStorage.getItem("nostr_pubkey");

        if (!savedPubkey) return; // Should be disabled anyway

        const btn = document.getElementById("btnShareNostr");
        const originalText = btn.textContent;
        btn.textContent = "Sharing...";
        btn.disabled = true;

        try {
            const privKeyHex = localStorage.getItem("nostr_privkey");

            if (privKeyHex) {
                // Local signing with saved nsec
                const { finalizeEvent } = await import("https://esm.sh/nostr-tools@2.7.0/pure");
                const { hexToBytes } = await import("https://esm.sh/@noble/hashes@1.3.3/utils");

                const unsignedEvent = {
                    kind: 1,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ["t", "SatSnake"],
                        ["t", "Gamestr"]
                    ],
                    content: text,
                };

                const privKeyBytes = hexToBytes(privKeyHex);
                const signedEvent = finalizeEvent(unsignedEvent, privKeyBytes);

                console.log("Locally signed event:", signedEvent);
                await this.publishEvent(signedEvent);
                console.log("Event published successfully");
                alert("Score shared to Nostr successfully!");
                this.closeShareModal();

            } else if (window.nostr) {
                // Use extension if available (preferred if no local key)
                const unsignedEvent = {
                    kind: 1,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ["t", "SatSnake"],
                        ["t", "Gamestr"]
                    ],
                    content: text,
                    pubkey: savedPubkey
                };

                console.log("Unsigned event:", unsignedEvent);
                const signedEvent = await window.nostr.signEvent(unsignedEvent);
                console.log("Signed event:", signedEvent);

                // Verify event has required fields
                if (!signedEvent.id || !signedEvent.sig) {
                    throw new Error("Event signing failed - missing id or sig");
                }

                await this.publishEvent(signedEvent);
                console.log("Event published successfully");
                alert("Score shared to Nostr successfully!");
                this.closeShareModal();
            } else {
                throw new Error("No signing method available (extension or nsec)");
            }

        } catch (err) {
            console.error("Share failed:", err);
            alert("Failed to share using extension: " + err.message);
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    },

    async submitScore() {
        const btn = document.getElementById("btnSubmitScore");
        btn.disabled = true;
        btn.textContent = "Submitting...";

        try {
            const payload = {
                playerName: this.playerProfile.name,
                playerPubkey: this.playerProfile.pubkey || "guest",
                score: parseInt(this.currentScore), // Ensure integer
                playerName: this.playerProfile.name
            };

            // If we have a real pubkey, we might want to sign it ourselves? 
            // The prompt says: "passes... to worker... which signs the event"
            // So we just send data to worker.

            // Constructing URL parameters or JSON body?
            // "passing the playerName, playerPubkey, score, etc to the satsnake-worker..."
            // Usually POST JSON.

            const response = await fetch(this.workerUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Worker submission failed with status " + response.status);
            }

            const signedEvent = await response.json();
            const event = signedEvent.event ? signedEvent.event : signedEvent; // Handle if wrapper or direct logic
            console.log("Received signed event:", event);

            // Publish to Relays
            await this.publishEvent(event);

            btn.textContent = "Submitted!";

            // Show Leaderboard
            this.showLeaderboard();

        } catch (err) {
            console.error(err);
            btn.textContent = "Error";
            btn.disabled = false;
            alert("Failed to submit score: " + err.message);
        }
    },

    async publishEvent(event) {
        console.log("Publishing event to relays:", event);

        const publishToOne = (url) => {
            return new Promise((resolve) => {
                try {
                    console.log(`Connecting to ${url}...`);
                    const ws = new WebSocket(url);
                    const timeout = setTimeout(() => {
                        console.log(`Timeout for ${url}`);
                        ws.close();
                        resolve(false);
                    }, 3000);

                    ws.onopen = () => {
                        console.log(`Connected to ${url}, sending event...`);
                        ws.send(JSON.stringify(["EVENT", event]));
                    };

                    ws.onmessage = (msg) => {
                        try {
                            const data = JSON.parse(msg.data);
                            console.log(`Response from ${url}:`, data);

                            if (data[0] === "OK" && data[1] === event.id) {
                                clearTimeout(timeout);
                                ws.close();
                                if (data[2]) {
                                    console.log(`✓ ${url} accepted the event`);
                                    resolve(true);
                                } else {
                                    console.log(`✗ ${url} rejected: ${data[3]}`);
                                    resolve(false);
                                }
                            }
                        } catch (e) {
                            console.error(`Parse error from ${url}:`, e);
                            resolve(false);
                        }
                    };

                    ws.onerror = (err) => {
                        console.error(`WebSocket error for ${url}:`, err);
                        clearTimeout(timeout);
                        ws.close();
                        resolve(false);
                    };
                } catch (err) {
                    console.error(`Failed to connect to ${url}:`, err);
                    resolve(false);
                }
            });
        };

        // Publish to all relays concurrently
        const results = await Promise.all(this.relayUrls.map(url => publishToOne(url)));
        console.log("Relay results:", results);

        // If no relay accepted, throw error
        if (!results.some(success => success)) {
            throw new Error("All relays rejected or failed to respond.");
        }
    },

    showLeaderboard() {
        document.getElementById("game-over-popup").classList.add("hidden");
        document.getElementById("leaderboard-overlay").classList.remove("hidden");
        this.fetchLeaderboardMessages();
    },

    fetchLeaderboardMessages() {
        const list = document.getElementById("leaderboard-list");
        list.innerHTML = "<li>Loading scores...</li>";

        const socket = new WebSocket("wss://relay.damus.io");
        const scores = [];

        socket.onopen = () => {
            const req = {
                kinds: [30762],
                authors: [this.devPubkey],
                // Removed restrictive #d filter - client-side filtering handles this
                limit: 50
            };
            socket.send(JSON.stringify(["REQ", "satsnake-lb", req]));
        };

        socket.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data[0] === "EVENT") {
                scores.push(data[2]);
            } else if (data[0] === "EOSE") {
                socket.close();
                this.enrichAndRenderLeaderboard(scores);
            }
        };
    },

    async enrichAndRenderLeaderboard(events) {
        // 1. Filter and Extract Data
        const parsedScores = events
            .filter(e => {
                const gameTag = e.tags.find(t => t[0] === "game");
                return gameTag && gameTag[1].toLowerCase() === "satsnake";
            })
            .map(e => {
                const scoreTag = e.tags.find(t => t[0] === "score");
                // Check if player tag exists, otherwise use pubkey from event (which might be the worker's?)
                // Actually, the worker signs it, but checks for 'p' tag for original player if valid?
                // The prompt says "playerPubkey" is passed to worker. 
                // Let's assume the worker adds a "p" tag for the player, OR we use the content if provided.
                // Standard Gamestr: event.pubkey is the signer (Worker). Player is in 'p' tag or tags.

                // Let's look for 'p' tag.
                const pTag = e.tags.find(t => t[0] === "p");
                const playerPubkey = pTag ? pTag[1] : null;

                return {
                    id: e.id,
                    content: e.content,
                    score: scoreTag ? parseInt(scoreTag[1]) : 0,
                    playerPubkey: playerPubkey
                };
            })
            .sort((a, b) => b.score - a.score);

        // 2. Collect Pubkeys for Profile Fetch
        const pubkeys = [...new Set(parsedScores.map(s => s.playerPubkey).filter(p => p))];

        // 3. Fetch Profiles (Kind 0)
        const profiles = {};
        if (pubkeys.length > 0) {
            try {
                const profileEvents = await this.fetchKind0(pubkeys);
                profileEvents.forEach(evt => {
                    try {
                        const content = JSON.parse(evt.content);
                        profiles[evt.pubkey] = {
                            name: content.name || content.display_name || content.nip05 || "Unknown",
                            picture: content.picture || "assets/logo.png"
                        };
                    } catch (e) {
                        console.error("Error parsing profile:", e);
                    }
                });
            } catch (err) {
                console.error("Failed to fetch profiles:", err);
            }
        }

        // 4. Render
        this.renderLeaderboard(parsedScores, profiles);
    },

    fetchKind0(pubkeys) {
        return new Promise((resolve) => {
            const socket = new WebSocket("wss://relay.damus.io");
            const events = [];

            // Timeout safety
            const timeout = setTimeout(() => {
                socket.close();
                resolve(events);
            }, 3000);

            socket.onopen = () => {
                const req = {
                    kinds: [0],
                    authors: pubkeys
                };
                socket.send(JSON.stringify(["REQ", "profiles", req]));
            };

            socket.onmessage = (msg) => {
                const data = JSON.parse(msg.data);
                if (data[0] === "EVENT") {
                    events.push(data[2]);
                } else if (data[0] === "EOSE") {
                    clearTimeout(timeout);
                    socket.close();
                    resolve(events);
                }
            };

            socket.onerror = () => {
                clearTimeout(timeout);
                resolve(events);
            };
        });
    },

    renderLeaderboard(scores, profiles) {
        const list = document.getElementById("leaderboard-list");
        list.innerHTML = "";

        if (scores.length === 0) {
            list.innerHTML = "<li>No scores yet. Be the first!</li>";
            return;
        }

        scores.forEach((s, index) => {
            const profile = profiles[s.playerPubkey] || { name: "Guest", picture: "assets/logo.png" };

            // If it's a guest (no pubkey or 'guest' pubkey), fallback
            let displayName = profile.name;
            if (!s.playerPubkey || s.playerPubkey === "guest") {
                // Try to parse name from content "PlayerName scored..."
                const match = s.content.match(/^(.*?) scored/);
                if (match && match[1]) displayName = match[1];
            }

            const isGuest = !s.playerPubkey || s.playerPubkey === 'guest';
            const avatarHtml = `<img src="${profile.picture}" class="lb-avatar" onerror="this.src='assets/logo.png'">`;

            const li = document.createElement("li");
            li.innerHTML = `
                <div class="lb-left">
                    <span class="rank">#${index + 1}</span>
                    ${avatarHtml}
                    <div class="lb-info">
                        <span class="lb-name ${isGuest ? 'guest' : ''}">${displayName}</span>
                        ${!isGuest ? '<span class="lb-verified">✓</span>' : ''}
                    </div>
                </div>
                <span class="score">${s.score}</span>
            `;
            list.appendChild(li);
        });
    }
};

// Expose globally
window.GAMESTR = GAMESTR;
