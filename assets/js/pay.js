
// --------------------
// CONFIG
// --------------------
const CONFIG = {
    lnbitsNode: "https://lnbits.whitepaperinteractive.com",
    paywallId: "fGAHUMU6qAPaBZTkNHGFvx",
    paywallPrefix: "/paywall",
    // 21 sats = 1% chance of leading zero
    // 50 sats = 5% chance of leading zero
    // 100 sats = 15% chance of leading zero
    // 150 sats = 35% chance of leading zero
    // 210 sats = 100% chance of leading zero
    PRICING_TIERS: [
        { level: 1, power: 1, sats: 21 },
        { level: 2, power: 5, sats: 50 },
        { level: 3, power: 15, sats: 100 },
        { level: 4, power: 35, sats: 150 },
        { level: 5, power: 100, sats: 210 }
    ]
};

// --------------------
// STATE
// --------------------
const state = {
    bolt11: null,
    paymentHash: null,
    ws: null,
    poll: null,
    nwcClient: null,
    weblnEnabled: false,
    selectedLevel: 3, // Default to 50%
    amount: 100
};

// --------------------
// DOM HELPERS
// --------------------
const $ = (id) => document.getElementById(id);

// --------------------
// SESSION ACCESS (session only - clears on browser close)
// --------------------
function hasAccess() {
    return sessionStorage.getItem("p2p_access") === "true";
}

function grantAccess() {
    sessionStorage.setItem("p2p_access", "true");

    // Find power for selected level
    const tier = CONFIG.PRICING_TIERS.find(t => t.level === state.selectedLevel);
    const power = tier ? tier.power : 10;

    sessionStorage.setItem("mining_power", power.toString());

    $("paidArea").classList.remove("hidden");
    $("invoiceArea").classList.add("hidden");

    // Transition to Mining Simulator

    // Sync Mining Duration
    if (window.updateMiningConfig) {
        window.updateMiningConfig();
    }

    // Hide Payment Overlay
    const paymentOverlay = $("payment-overlay");
    if (paymentOverlay) {
        paymentOverlay.classList.add("hidden");
    }
}

function expireSession() {
    sessionStorage.removeItem("p2p_access");
}

function revokeAccess() {
    expireSession();
    $("paidArea").classList.add("hidden");
    // Show Payment Overlay again if needed, or reload
    window.location.reload();
}
window.expireSession = expireSession;
window.revokeAccess = revokeAccess;

// --------------------
// PERSISTENT STORAGE (localStorage - persists across sessions)
// --------------------
function saveNostrLogin(pubkey) {
    localStorage.setItem("nostr_pubkey", pubkey);
}

function getNostrLogin() {
    return localStorage.getItem("nostr_pubkey");
}

function clearNostrLogin() {
    localStorage.removeItem("nostr_pubkey");
    localStorage.removeItem("nostr_privkey");
}

function saveNWCUrl(url) {
    localStorage.setItem("nwc_url", url);
}

function getNWCUrl() {
    return localStorage.getItem("nwc_url");
}

function clearNWCUrl() {
    localStorage.removeItem("nwc_url");
}

// --------------------
// LNBits helpers
// --------------------
function http(path) {
    return `${CONFIG.lnbitsNode}${CONFIG.paywallPrefix}${path}`;
}

function ws(path) {
    return http(path).replace("https", "wss");
}

// --------------------
// Load Nostr Profile
// --------------------
async function loadNostrProfile(pubkey) {
    const profileName = $("nostrProfileName");
    const profilePic = $("nostrProfilePic");
    const userProfile = $("userProfile");

    profileName.textContent = pubkey.slice(0, 8) + "..." + pubkey.slice(-8);
    profilePic.style.display = "none";
    if (userProfile) userProfile.classList.remove("hidden");

    // Save to localStorage for persistence
    saveNostrLogin(pubkey);

    const relay = "wss://relay.damus.io";
    const subId = Math.random().toString(36).substring(2);

    const socket = new WebSocket(relay);

    socket.onopen = () => {
        const req = ["REQ", subId, {
            kinds: [0],
            authors: [pubkey]
        }];
        socket.send(JSON.stringify(req));
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data[0] === "EVENT" && data[2].kind === 0) {
            const metadata = JSON.parse(data[2].content);
            if (metadata.name) profileName.textContent = metadata.name;
            if (metadata.picture) {
                profilePic.src = metadata.picture;
                profilePic.style.display = "block";
            }
            socket.close();
        }
    };
}

// --------------------
// NWC Connection Management
// --------------------
function showNWCConnected() {
    $("nwcNotConnected").classList.add("hidden");
    $("nwcConnected").classList.remove("hidden");
}

function showNWCDisconnected() {
    $("nwcNotConnected").classList.remove("hidden");
    $("nwcConnected").classList.add("hidden");
    state.nwcClient = null;
}

async function connectNWC(nwcUrl) {
    try {
        const alby = await import("https://esm.sh/@getalby/sdk@7.0.0");
        state.nwcClient = new alby.NWCClient({
            nostrWalletConnectUrl: nwcUrl
        });

        // Save URL for persistence
        saveNWCUrl(nwcUrl);
        showNWCConnected();
        return true;
    } catch (err) {
        console.error("NWC connection error:", err);
        alert("Failed to connect NWC wallet: " + (err.message || "Unknown error"));
        return false;
    }
}

function disconnectNWC() {
    clearNWCUrl();
    showNWCDisconnected();
    $("nwcInput").value = "";
}

// --------------------
// WebLN Connection Management
// --------------------
function showWebLNConnected() {
    $("weblnNotConnected").classList.add("hidden");
    $("weblnConnected").classList.remove("hidden");
}

function showWebLNDisconnected() {
    $("weblnNotConnected").classList.remove("hidden");
    $("weblnConnected").classList.add("hidden");
    state.weblnEnabled = false;
}

async function connectWebLN() {
    if (!window.webln) {
        alert("WebLN extension not detected. Please install a WebLN-compatible wallet like Alby.");
        return false;
    }

    try {
        await window.webln.enable();
        state.weblnEnabled = true;
        showWebLNConnected();
        return true;
    } catch (err) {
        console.error("WebLN connection error:", err);
        alert("Failed to connect WebLN: " + (err.message || "Unknown error"));
        return false;
    }
}

// --------------------
// PAY WITH WebLN
// --------------------
async function payWebLN() {
    if (!state.weblnEnabled || !window.webln) {
        alert("Please connect your WebLN wallet first");
        return;
    }

    if (!state.bolt11) {
        alert("No invoice to pay. Please create an invoice first.");
        return;
    }

    const btn = $("btnPayWebLN");
    const originalText = btn.textContent;

    try {
        btn.textContent = "Sending payment...";
        btn.disabled = true;

        const response = await window.webln.sendPayment(state.bolt11);
        console.log("WebLN Payment response:", response);

        btn.textContent = "Payment sent!";
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    } catch (err) {
        console.error("WebLN payment error:", err);
        btn.textContent = originalText;
        btn.disabled = false;
        alert("WebLN payment failed: " + (err.message || JSON.stringify(err) || "Unknown error"));
    }
}

// --------------------
// CREATE INVOICE
// --------------------
async function createInvoice() {
    const qrContainer = $("qr");
    const loadingIndicator = $("invoiceLoading");
    const invoiceArea = $("invoiceArea");

    // Show loading indicator, hide area
    if (loadingIndicator) loadingIndicator.classList.remove("hidden");
    if (invoiceArea) invoiceArea.classList.add("hidden");

    qrContainer.innerHTML = "";

    // Amount is already set by slider change
    // state.amount = tier.sats;

    if (!state.amount || isNaN(state.amount)) {
        alert("Error: Invalid amount. Resetting to default.");
        state.selectedLevel = 3;
        state.amount = 100;
    }

    try {
        const res = await fetch(
            http(`/api/v1/paywalls/invoice/${CONFIG.paywallId}`),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: state.amount })
            }
        );
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Status ${res.status} (${res.statusText}): ${errorText}`);
        }

        const data = await res.json();
        state.bolt11 = data.payment_request;
        state.paymentHash = data.payment_hash;

        $("invoiceText").value = state.bolt11;
        $("paymentHash").textContent = state.paymentHash;
        $("invoiceArea").classList.remove("hidden");

        // QR - Use lowercase for maximum wallet compatibility
        qrContainer.innerHTML = "";

        // Update "Pay X Sats" text in the new location
        const amountDisplay = $("invoiceAmountDisplay");
        if (amountDisplay) {
            amountDisplay.textContent = `Pay ${state.amount} Sats`;
        }


        const invoiceData = state.bolt11.trim().toLowerCase();
        // console.log("QR invoice data:", invoiceData);

        const canvas = document.createElement("canvas");
        qrContainer.appendChild(canvas);

        new QRious({
            element: canvas,
            value: invoiceData,
            size: 220,
            level: "L",
            background: "#ffffff",
            foreground: "#000000"
        });

        // Hide loading indicator
        if (loadingIndicator) loadingIndicator.classList.add("hidden");

        watchPayment();
    } catch (err) {
        if (loadingIndicator) loadingIndicator.classList.add("hidden");
        console.error("Invoice creation failed:", err);
    }
}

// --------------------
// WATCH PAYMENT
// --------------------
function watchPayment() {
    if (state.ws) state.ws.close();

    state.ws = new WebSocket(
        ws(`/api/v1/paywalls/invoice/${CONFIG.paywallId}/${state.paymentHash}`)
    );

    state.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.paid) {
            grantAccess();
            state.ws.close();
        }
    };

    // Poll fallback
    state.poll = setInterval(async () => {
        const res = await fetch(
            http(`/api/v1/paywalls/check_invoice/${CONFIG.paywallId}`),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ payment_hash: state.paymentHash })
            }
        );
        const data = await res.json();
        if (data.paid) {
            clearInterval(state.poll);
            grantAccess();
        }
    }, 3000);
}

// --------------------
// PAY WITH NWC
// --------------------
async function payNWC() {
    if (!state.nwcClient) {
        alert("Please connect your NWC wallet first");
        return;
    }

    if (!state.bolt11) {
        alert("No invoice to pay. Please create an invoice first.");
        return;
    }

    const btn = $("btnPayNWC");
    const originalText = btn.textContent;

    try {
        btn.textContent = "Sending payment...";
        btn.disabled = true;

        const response = await state.nwcClient.payInvoice({ invoice: state.bolt11 });
        console.log("Payment response:", response);

        btn.textContent = "Payment sent!";
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    } catch (err) {
        console.error("NWC payment error:", err);
        btn.textContent = originalText;
        btn.disabled = false;
        alert("NWC payment failed: " + (err.message || JSON.stringify(err) || "Unknown error"));
    }
}

// --------------------
// COPY INVOICE
// --------------------
function copyInvoice() {
    if (!state.bolt11) {
        alert("No invoice to copy");
        return;
    }
    navigator.clipboard.writeText(state.bolt11).then(() => {
        const btn = $("btnCopyInvoice");
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }).catch(err => {
        console.error("Copy failed:", err);
        alert("Failed to copy invoice");
    });
}

// --------------------
// RESTORE PERSISTED STATE
// --------------------
async function restorePersistedState() {
    // Restore Nostr login
    const savedPubkey = getNostrLogin();
    if (savedPubkey) {
        loadNostrProfile(savedPubkey);
    }

    // Restore NWC connection
    const savedNWCUrl = getNWCUrl();
    if (savedNWCUrl) {
        $("nwcInput").value = savedNWCUrl;
        await connectNWC(savedNWCUrl);
    }
}

// --------------------
// BUTTON WIRING
// --------------------
function wire() {
    // Slider Logic for Hashrate
    const slider = $("timeSlider");
    const label = $("priceLabel");

    if (slider && label) {
        slider.oninput = (e) => {
            const levelIndex = parseInt(e.target.value) - 1; // 1-based index to 0-based array
            const tier = CONFIG.PRICING_TIERS[levelIndex];

            state.selectedLevel = parseInt(e.target.value);
            state.amount = tier.sats;

            label.textContent = `${tier.power}% Hashpower - ${tier.sats} sats`;

            // Hide old invoice
            $("invoiceArea").classList.add("hidden");
            if (state.ws) state.ws.close();
            if (state.poll) clearInterval(state.poll);
        };
    }

    const btnCreateInvoice = $("btnCreateInvoice");
    if (btnCreateInvoice) btnCreateInvoice.onclick = createInvoice;

    const btnPayNWC = $("btnPayNWC");
    if (btnPayNWC) btnPayNWC.onclick = payNWC;

    const btnPayWebLN = $("btnPayWebLN");
    if (btnPayWebLN) btnPayWebLN.onclick = payWebLN;

    const btnCopyInvoice = $("btnCopyInvoice");
    if (btnCopyInvoice) btnCopyInvoice.onclick = copyInvoice;

    const btnLock = $("btnLock");
    if (btnLock) btnLock.onclick = revokeAccess;

    // WebLN Connect
    const btnConnectWebLN = $("btnConnectWebLN");
    if (btnConnectWebLN) btnConnectWebLN.onclick = async () => {
        const btn = $("btnConnectWebLN");
        btn.textContent = "Connecting...";
        btn.disabled = true;

        await connectWebLN();

        btn.textContent = "Connect Extension";
        btn.disabled = false;
    };

    // NWC Connect/Disconnect
    const btnConnectNWC = $("btnConnectNWC");
    if (btnConnectNWC) btnConnectNWC.onclick = async () => {
        const nwcUrl = $("nwcInput").value.trim();
        if (!nwcUrl) {
            alert("Please enter your NWC connection string");
            return;
        }

        const btn = $("btnConnectNWC");
        btn.textContent = "Connecting...";
        btn.disabled = true;

        const success = await connectNWC(nwcUrl);

        btn.textContent = "Connect NWC Wallet";
        btn.disabled = false;
    };

    const btnDisconnectNWC = $("btnDisconnectNWC");
    if (btnDisconnectNWC) btnDisconnectNWC.onclick = disconnectNWC;

    // NOSTR Login Tab Switching
    document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
        tab.addEventListener("click", () => {
            // Remove active class from all tabs and panels
            document.querySelectorAll(".tab[data-tab]").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tabPanel").forEach(p => p.classList.remove("active"));

            // Add active class to clicked tab
            tab.classList.add("active");

            // Show corresponding panel
            const targetId = "tab-" + tab.dataset.tab;
            const panel = document.getElementById(targetId);
            if (panel) panel.classList.add("active");
        });
    });


    // Nostr Extension Login
    const btnNip07 = $("btnNip07");
    if (btnNip07) btnNip07.onclick = async () => {
        if (!window.nostr) return alert("Nostr extension not detected");
        try {
            const pubkey = await window.nostr.getPublicKey();
            loadNostrProfile(pubkey);
        } catch (err) {
            alert("Failed to connect: " + err.message);
        }
    };

    // NSEC Login
    const btnNsec = $("btnNsec");
    if (btnNsec) btnNsec.onclick = async () => {
        const nsec = $("nsecInput").value.trim();
        if (!nsec || !nsec.startsWith("nsec")) {
            alert("Please enter a valid NSEC key");
            return;
        }

        try {
            const { decode } = await import("https://esm.sh/nostr-tools@2.7.0/nip19");
            const { getPublicKey } = await import("https://esm.sh/nostr-tools@2.7.0/pure");
            const { bytesToHex } = await import("https://esm.sh/@noble/hashes@1.3.3/utils");

            const decoded = decode(nsec);
            if (decoded.type !== "nsec") throw new Error("Invalid nsec");

            const privateKeyBytes = decoded.data;
            const pubkeyBytes = getPublicKey(privateKeyBytes);

            // Ensure we have a hex string for the relay query
            const pubkeyHex = typeof pubkeyBytes === 'string' ? pubkeyBytes : bytesToHex(pubkeyBytes);
            const status = typeof pubkeyBytes === 'string' ? "hex" : "bytes"; // debugging

            loadNostrProfile(pubkeyHex);

            // Save private key for signing
            // We need to convert bytes to hex if it's not already
            const privKeyHex = bytesToHex(privateKeyBytes);
            localStorage.setItem("nostr_privkey", privKeyHex);

        } catch (err) {
            alert("Invalid NSEC key: " + err.message);
        }
    };

    const btnNsecClear = $("btnNsecClear");
    if (btnNsecClear) btnNsecClear.onclick = () => {
        $("nsecInput").value = "";
    };

    // Nsec visibility toggle
    const toggleNsec = $("toggleNsec");
    if (toggleNsec) toggleNsec.onclick = () => {
        const input = $("nsecInput");
        const eyeOpen = $("eyeOpen");
        const eyeClosed = $("eyeClosed");

        if (input.type === "password") {
            input.type = "text";
            eyeOpen.classList.add("hidden");
            eyeClosed.classList.remove("hidden");
        } else {
            input.type = "password";
            eyeOpen.classList.remove("hidden");
            eyeClosed.classList.add("hidden");
        }
    };

    // Bunker Login
    const btnBunker = $("btnBunker");
    if (btnBunker) btnBunker.onclick = async () => {
        const url = $("bunkerInput").value.trim();
        if (!url.startsWith("bunker://")) {
            alert("Invalid Bunker URL");
            return;
        }

        const match = url.match(/^bunker:\/\/([^?]+)/);
        if (match) {
            const pubkey = match[1];
            loadNostrProfile(pubkey);
        } else {
            alert("Could not parse pubkey from Bunker URL");
        }
    };

    const btnBunkerDisconnect = $("btnBunkerDisconnect");
    if (btnBunkerDisconnect) btnBunkerDisconnect.onclick = () => {
        $("bunkerInput").value = "";
    };


    // Payment tab switching (WebLN / NWC)
    document.querySelectorAll(".tab[data-paytab]").forEach((tab) => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab[data-paytab]").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".payTabPanel").forEach(p => p.classList.remove("active"));

            tab.classList.add("active");
            const targetId = "paytab-" + tab.dataset.paytab;
            const panel = document.getElementById(targetId);
            if (panel) panel.classList.add("active");
        });
    });

    // Logout
    const btnLogout = $("btnLogout");
    if (btnLogout) btnLogout.onclick = () => {
        revokeAccess();
        clearNostrLogin();

        $("nostrProfileName").textContent = "";
        $("nostrProfilePic").style.display = "none";
        const userProfile = $("userProfile");
        if (userProfile) userProfile.classList.add("hidden");

        $("nsecInput").value = "";
        $("bunkerInput").value = "";
    };

    const btnPlay = $("btnPlay");
    if (btnPlay) {
        btnPlay.onclick = (e) => {
            e.preventDefault();
            grantAccess();
        }
    }

    // Create invoice on load if not already paid
    if (!hasAccess()) createInvoice();
}

// --------------------
// DETECT RELOAD AND CLEAR SESSION
// --------------------
// Clear session on page reload (F5 or Ctrl+F5)
// This ensures users return to the payment screen after refresh
const navEntry = performance.getEntriesByType('navigation')[0];
if (navEntry && navEntry.type === 'reload') {
    console.log('Page reload detected - clearing session');
    sessionStorage.clear();
}

// --------------------
// INIT
// --------------------
wire();
restorePersistedState();
if (hasAccess()) {
    grantAccess();
} else {
    // Ensure Mining Overlay is not visible/active until access granted
    // Actually, CSS z-index handles occlusion, but we should make sure
}
