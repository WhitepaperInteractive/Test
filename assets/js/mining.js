(function () {
    // Read dynamic mining power (percentage)
    let miningPower = 10; // default 10%
    const miningDuration = 10; // Fixed duration 10s

    function readConfig() {
        const powerStore = sessionStorage.getItem("mining_power");
        miningPower = powerStore ? parseInt(powerStore) : 10;
        return miningPower;
    }

    // Init
    readConfig();

    let timeLeft = miningDuration;
    let bestDifficulty = 0;
    let bestHash = ''; // Store the actual hash string
    let bonusEarned = 0;
    let timerInterval;
    let miningInterval;
    let hashrateInterval;
    let isMining = false;
    let hashesComputed = 0;

    // DOM Elements
    const startPopup = document.getElementById('mining-start');
    const startMiningBtn = document.getElementById('start-mining-btn');
    const timerDisplay = document.getElementById('mining-timer');
    const bestDiffDisplay = document.getElementById('best-difficulty');
    const bestHashDisplay = document.getElementById('best-hash-display');
    const bonusDisplay = document.getElementById('bonus-earned');
    const hashrateDisplay = document.getElementById('hashrate');
    const hashStream = document.getElementById('hash-stream');
    const resultsPanel = document.getElementById('mining-results');
    const resultDifficulty = document.getElementById('result-difficulty');
    const resultBonus = document.getElementById('result-bonus');
    const startGameBtn = document.getElementById('start-game-btn');
    const miningOverlay = document.getElementById('mining-overlay');
    const gameContainer = document.getElementById('game-container');

    // Header Info Elements
    const prevHashEl = document.getElementById('prev-hash');
    const merkleRootEl = document.getElementById('merkle-root');
    const blockTimeEl = document.getElementById('block-time');

    // Pseudo-random hash generator
    function generateHash() {
        const characters = '0123456789abcdef';
        let hash = '';
        const len = 64;
        // Optimization: generate fewer random calls by grouping? 
        // JS is fast enough for visual simulation.
        for (let i = 0; i < len; i++) {
            hash += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return hash;
    }

    // Format best difficulty with emphasised zeros
    function formatBestHash(count) {
        if (count === 0) return "0";
        let zeros = "".padStart(count, "0");
        return `<span class="zeros">${zeros}</span>...`;
    }

    function updateStats(hash) {
        hashesComputed++;
        // Count leading zeros
        let zeros = 0;
        for (let i = 0; i < hash.length; i++) {
            if (hash[i] === '0') {
                zeros++;
            } else {
                break;
            }
        }

        if (zeros > bestDifficulty) {
            bestDifficulty = zeros;
            bestHash = hash;

            // Calculate bonus: 1 bonus per zero
            const newBonus = zeros;

            if (newBonus > bonusEarned) {
                bonusEarned = newBonus;
                animateBonus();
            }

            bestDiffDisplay.innerHTML = formatBestHash(bestDifficulty);
            // Update full hash display with highlighted zeros
            const fullHashFormatted = `<span class="zeros-pulse zeros">${hash.substring(0, bestDifficulty)}</span>${hash.substring(bestDifficulty)}`;
            bestHashDisplay.innerHTML = fullHashFormatted;

            bonusDisplay.textContent = bonusEarned;

            return true;
        }
        return false;
    }

    function animateBonus() {
        bonusDisplay.classList.remove('bonus-pop');
        void bonusDisplay.offsetWidth; // trigger reflow
        bonusDisplay.classList.add('bonus-pop');
    }

    function addHashToStream(hash, isBest) {
        const div = document.createElement('div');
        div.className = 'hash-line';
        div.textContent = hash;
        if (isBest) {
            div.style.color = '#ff0';
            div.style.fontWeight = 'bold';
            div.textContent += ' [NEW BEST]';
        }
        hashStream.appendChild(div);

        // Keep stream clean
        if (hashStream.children.length > 35) {
            hashStream.removeChild(hashStream.firstChild);
        }
    }

    async function fetchBitcoinData() {
        try {
            // Fetch current block height
            const heightRes = await fetch('https://mempool.space/api/blocks/tip/height');
            const height = await heightRes.json();

            // Fetch block hash for this height
            const hashRes = await fetch(`https://mempool.space/api/block-height/${height}`);
            const blockHash = await hashRes.text();

            // Fetch full block details
            const blockRes = await fetch(`https://mempool.space/api/block/${blockHash}`);
            const blockData = await blockRes.json();

            // Update DOM elements with real data
            document.getElementById('block-height').textContent = height;
            document.getElementById('block-version').textContent = '0x' + blockData.version.toString(16).padStart(8, '0');

            // Format difficulty (convert to terahashes)
            const difficulty = blockData.difficulty;
            const difficultyT = (difficulty / 1e12).toFixed(1);
            document.getElementById('net-difficulty').textContent = difficultyT + 'T';

            document.getElementById('block-time').textContent = blockData.timestamp;
            document.getElementById('prev-hash').textContent = blockData.previousblockhash;
            document.getElementById('merkle-root').textContent = blockData.merkle_root;

        } catch (err) {
            console.error('Failed to fetch Bitcoin data:', err);
            // Fall back to placeholder/random data
            generateHeaderInfoFallback();
        }
    }

    function generateHeaderInfoFallback() {
        prevHashEl.textContent = generateHash();
        merkleRootEl.textContent = generateHash();
        blockTimeEl.textContent = Math.floor(Date.now() / 1000);
    }

    function initMining() {
        if (isMining) return;

        // Safety: clear any existing intervals
        if (timerInterval) clearInterval(timerInterval);
        if (miningInterval) clearInterval(miningInterval);
        if (hashrateInterval) clearInterval(hashrateInterval);

        // Ensure state is fresh
        readConfig();
        timeLeft = miningDuration;
        timerDisplay.textContent = timeLeft + 's';

        startPopup.classList.add('hidden');
        isMining = true;
        fetchBitcoinData();

        timerInterval = setInterval(() => {
            timeLeft--;
            timerDisplay.textContent = timeLeft + 's';

            if (timeLeft <= 0) {
                endMining();
            }
        }, 1000);

        // Hashrate Calculator
        hashrateInterval = setInterval(() => {
            const hps = hashesComputed * 2; // rate per 0.5s * 2 = per second

            let displayRate = '';
            if (hps > 1000) {
                displayRate = (hps / 1000).toFixed(1) + ' kH/s';
            } else {
                displayRate = hps + ' H/s';
            }

            // Calculate max possible for this tier
            // miningPower is the percentage (10, 25, 50, 75, 100)
            const maxRate = 85; // approx 85kH/s is 100% on this engine

            hashrateDisplay.textContent = `${displayRate} (${miningPower}% hashpower)`;
            hashesComputed = 0;
        }, 500);

        miningInterval = setInterval(() => {
            if (!isMining) return;

            // Generate multiple hashes per tick 
            // Increase this loop to simulate higher hashrate
            // Increase this loop to simulate higher hashrate
            // Start mining simulation
            // Target ~75kH/s => 2500 hashes per 30ms tick
            // OPTIMIZATION: Use statistical simulation to avoid blocking main thread with string ops

            const chars = '0123456789abcdef';

            // Calculate iterations based on mining power
            // Base 100% = 2500 iterations
            const iterations = Math.floor(2500 * (miningPower / 100));

            for (let i = 0; i < iterations; i++) {
                // Always generate the first one per tick for the visual stream
                if (i === 0) {
                    const hash = generateHash();
                    const isBest = updateStats(hash);
                    addHashToStream(hash, isBest);
                    continue;
                }

                // Statistical Simulation for the rest
                // 1/16 chance of a '0' nibble (leading zero)
                let zeros = 0;
                // Fast geometric distribution check
                while (Math.random() < 0.0625 && zeros < 64) {
                    zeros++;
                }

                // Only do the heavy lifting if we beat the current best
                if (zeros > bestDifficulty) {
                    // Construct a valid hash matching our statistical finding
                    let hash = "".padStart(zeros, "0");

                    // The next char must be non-zero to match the loop stopping (unless 64)
                    if (zeros < 64) {
                        // Random hex (1-15) -> 1-f
                        hash += chars.charAt(Math.floor(Math.random() * 15) + 1);
                    }

                    // Fill the rest randomly
                    while (hash.length < 64) {
                        hash += chars.charAt(Math.floor(Math.random() * 16));
                    }

                    // Process this "winner"
                    updateStats(hash);
                    addHashToStream(hash, true);
                } else {
                    // Just count it
                    hashesComputed++;
                }
            }
        }, 30);
    }

    function endMining() {
        isMining = false;
        clearInterval(timerInterval);
        clearInterval(miningInterval);
        clearInterval(hashrateInterval);

        // Final visual update
        hashrateDisplay.textContent = "0 H/s";

        resultDifficulty.textContent = bestDifficulty;
        resultBonus.textContent = bonusEarned;
        resultsPanel.classList.remove('hidden');
    }

    startMiningBtn.addEventListener('click', () => {
        initMining();
    });

    startGameBtn.addEventListener('click', () => {
        miningOverlay.classList.add('hidden');
        gameContainer.classList.remove('hidden');
        gameContainer.classList.remove('avoid-clicks');

        // Call global function to start game with bonus
        if (window.initGameWithBonus) {
            window.initGameWithBonus(bonusEarned);
        } else {
            console.error('initGameWithBonus function not found');
            if (typeof newGame === 'function') newGame();
        }
    });

    // Expose update function for Pay logic
    window.updateMiningConfig = function () {
        readConfig();

        // Only reset timer if not currently mining
        if (!isMining) {
            timeLeft = miningDuration;

            // Update Popup Text
            const durText = document.getElementById("mining-duration-text");
            if (durText) {
                durText.textContent = miningDuration + " seconds";
            }

            // Update Timer Display immediately
            if (timerDisplay) {
                timerDisplay.textContent = miningDuration + 's';
            }
        }
    };

    // Initial setup
    window.addEventListener('load', () => {
        fetchBitcoinData();
        // Also try to update if already hidden (reloads)
        window.updateMiningConfig();
    });

})();
