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
        if (btnMainMenu) btnMainMenu.onclick = () => this.playAgain(); // Same functionality

        // Share Modal Wiring
        const btnShareNostr = document.getElementById("btnShareNostr");
        if (btnShareNostr) btnShareNostr.onclick = () => this.performNostrShare();

        const btnCancelShare = document.getElementById("btnCancelShare");
        if (btnCancelShare) btnCancelShare.onclick = () => this.closeShareModal();
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
        const text = `I just scored ${this.currentScore} on SatSnake 🐍\n\nPlay now at SatSnake.WhitepaperInteractive.com\n\n#SatSnake #Gamestr`;
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
            // Use extension if available (preferred)
            if (window.nostr) {
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
                throw new Error("NIP-07 extension not found (window.nostr)");
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
        list.innerHTML = "<li>Loading...</li>";

        const socket = new WebSocket("wss://relay.damus.io");
        const events = [];

        socket.onopen = () => {
            const req = {
                kinds: [30762],
                authors: [this.devPubkey],
                "#d": ["satsnake"], // Optimization if worker uses d-tag
                limit: 50
            };
            socket.send(JSON.stringify(["REQ", "satsnake-lb", req]));
        };

        socket.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data[0] === "EVENT") {
                events.push(data[2]);
            } else if (data[0] === "EOSE") {
                socket.close();
                this.renderLeaderboard(events);
            }
        };
    },

    renderLeaderboard(events) {
        const list = document.getElementById("leaderboard-list");
        list.innerHTML = "";

        // Filter for game="SatSnake" just in case
        // Parse content? The prompt says event content is "Player scored X..."
        // But the tags have the real data: ["score", score], ["game", "satsnake"]

        const scores = events
            .filter(e => {
                const gameTag = e.tags.find(t => t[0] === "game");
                return gameTag && gameTag[1].toLowerCase() === "satsnake";
            })
            .map(e => {
                const scoreTag = e.tags.find(t => t[0] === "score");
                const pTag = e.tags.find(t => t[0] === "p"); // Player pubkey
                // We might need to parse name from content or aux tags? 
                // Worker content: `${playerName} scored...`
                // We can just use the content or try to parse. 
                // Let's use content for simplicity as it contains the name.

                return {
                    id: e.id,
                    content: e.content,
                    score: scoreTag ? parseInt(scoreTag[1]) : 0,
                    created_at: e.created_at
                };
            })
            .sort((a, b) => b.score - a.score); // Descending

        scores.forEach((s, index) => {
            const li = document.createElement("li");
            li.innerHTML = `
                <span class="rank">#${index + 1}</span>
                <span class="text">${s.content}</span>
                <span class="score">${s.score}</span>
            `;
            list.appendChild(li);
        });

        if (scores.length === 0) {
            list.innerHTML = "<li>No scores yet. Be the first!</li>";
        }
    }
};

// Expose globally
window.GAMESTR = GAMESTR;
