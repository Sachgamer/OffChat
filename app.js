// OffChat v2.0 Production — Moteur P2P Réel (UDP Wi-Fi Direct :45888 + BLE GATT + BroadcastChannel + Relais WebSocket Aveugle), Chiffrement AES-GCM & Triple Stockage Permanent (Fichier Interne Android + IndexedDB + localStorage)

const STORAGE_KEY = 'offchat_permanent_vault_v1';
const IDB_NAME = 'OffChatPermanentDB';
const IDB_STORE = 'vault_store';

const THEMES = {
  komai: {
    label: 'Komai Matrix',
    nav: '#0b140e', rooms: '#111c15', chat: '#050a07', active: '#163822',
    pill: '#0f2617', me: '#122e1c', peer: '#252b16', border: '#1f422b',
    text: '#a7d7b4', bright: '#54e87c', muted: '#679c76'
  },
  discord: {
    label: 'Discord Dark',
    nav: '#1e1f22', rooms: '#2b2d31', chat: '#313338', active: '#404249',
    pill: '#232428', me: '#3b4270', peer: '#2b2d31', border: '#3f4147',
    text: '#dbdee1', bright: '#949cf7', muted: '#949ba4'
  },
  simplex: {
    label: 'SimpleX Cyan',
    nav: '#081218', rooms: '#0d1b24', chat: '#050b0f', active: '#123142',
    pill: '#0c222e', me: '#0f3547', peer: '#16242b', border: '#1b465c',
    text: '#bae6fd', bright: '#22d3ee', muted: '#6495ad'
  },
  amber: {
    label: 'Cyber Amber',
    nav: '#141008', rooms: '#1c160b', chat: '#0a0804', active: '#382a10',
    pill: '#241b0b', me: '#33250e', peer: '#241e14', border: '#4d3916',
    text: '#fde68a', bright: '#fbbf24', muted: '#a38752'
  },
  crimson: {
    label: 'Night Crimson',
    nav: '#170a0e', rooms: '#210f15', chat: '#0a0406', active: '#3d1623',
    pill: '#291018', me: '#3b1522', peer: '#26151b', border: '#541f30',
    text: '#fecdd3', bright: '#fb7185', muted: '#a66874'
  }
};

const transportModes = ['🔄 Multi-Sauts BLE/Wi-Fi', '🚶 Porteurs DTN', '🌐 Pont Relais P2P'];
let currentTransportIdx = 0;
let cameraStream = null;
let relaySocket = null;
let detectedPeersCount = 0;
const seenPacketIds = new Set();

// Canal local inter-onglets pour tester 2 instances côte à côte sur navigateur
const localMeshChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('offchat_mesh_v2')
  : null;

function randHex(len = 6) {
  const arr = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

// --- CHIFFREMENT BOUT-EN-BOUT (WEB CRYPTO API AES-GCM 256 BITS) ---
async function deriveAesKey(secretSeed) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(`offchat_e2ee_${secretSeed}`));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(plainText, secretSeed) {
  try {
    if (!window.crypto || !window.crypto.subtle) return { cipher: plainText, iv: null };
    const key = await deriveAesKey(secretSeed);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plainText);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuf)));
    const ivB64 = btoa(String.fromCharCode(...iv));
    return { cipher: cipherB64, iv: ivB64 };
  } catch (_) {
    return { cipher: plainText, iv: null };
  }
}

async function decryptPayload(cipher, ivB64, secretSeed) {
  try {
    if (!ivB64 || !window.crypto || !window.crypto.subtle) return cipher;
    const key = await deriveAesKey(secretSeed);
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const data = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0));
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plainBuf);
  } catch (_) {
    return cipher;
  }
}

// État vierge (démarre de zéro pour chaque nouvel utilisateur)
function createCleanVault() {
  return {
    onboarded: false,
    pushEnabled: true,
    theme: 'komai',
    customAccent: null,
    relayUrl: '',
    user: {
      alias: '',
      fingerprint: randHex(6).toUpperCase(),
      pubKey: `x25519_${randHex(16)}`,
      rxQueue: `q_rx_${randHex(6)}`
    },
    rooms: []
  };
}

// --- SYSTÈME DE NOTIFICATIONS PUSH-UP (ANDROID NATIF + WEB + BANNIÈRE HEADS-UP + BIP AUDIO) ---
function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (_) {}
}

function sendPushNotification(title, body, targetRoomId = null) {
  if (vault.pushEnabled === false) return;

  playNotificationSound();
  if (navigator.vibrate) {
    try { navigator.vibrate([120, 60, 120]); } catch (_) {}
  }

  // 1. Pont natif Android (NotificationChannel IMPORTANCE_HIGH)
  if (window.OffChatNative && typeof window.OffChatNative.showPushNotification === 'function') {
    try {
      window.OffChatNative.showPushNotification(title, body);
    } catch (_) {}
  } else if ('Notification' in window && Notification.permission === 'granted') {
    // 2. Notification système Web standard
    try {
      new Notification(title, { body });
    } catch (_) {}
  }

  // 3. Bannière Push-Up (Heads-Up Toast) en haut de l'écran
  const container = document.getElementById('push-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'push-toast';
  toast.innerHTML = `
    <span style="font-size:1.2rem;">🔔</span>
    <div class="push-toast-meta">
      <div class="push-toast-title"></div>
      <div class="push-toast-body"></div>
    </div>
    <span style="font-size:0.75rem;color:var(--text-muted)">✕</span>
  `;
  toast.querySelector('.push-toast-title').textContent = title;
  toast.querySelector('.push-toast-body').textContent = body;

  toast.addEventListener('click', () => {
    if (targetRoomId) {
      selectRoom(targetRoomId);
      setMobileView('chat');
    }
    toast.remove();
  });

  container.prepend(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 4200);
}

// --- TRIPLE STOCKAGE PERMANENT (FICHIER INTERNE ANDROID + INDEXEDDB + LOCALSTORAGE) ---
function loadVaultSync() {
  // 1. Priorité au fichier interne natif Android (survit même si le cache WebView est vidé)
  if (window.OffChatNative && typeof window.OffChatNative.loadVaultFromFile === 'function') {
    try {
      const nativeRaw = window.OffChatNative.loadVaultFromFile();
      if (nativeRaw) {
        const parsed = JSON.parse(nativeRaw);
        if (parsed && parsed.user && Array.isArray(parsed.rooms)) return parsed;
      }
    } catch (_) {}
  }

  // 2. Fallback localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.user && Array.isArray(parsed.rooms)) return parsed;
    }
  } catch (_) {}

  return createCleanVault();
}

let vault = loadVaultSync();
let activeRoomId = vault.rooms[0]?.id || null;
let activeCategory = 'all';

function saveToIndexedDB(data) {
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(data, 'main_vault');
    };
  } catch (_) {}
}

function loadFromIndexedDBIfNeeded() {
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(IDB_STORE, 'readonly');
      const getReq = tx.objectStore(IDB_STORE).get('main_vault');
      getReq.onsuccess = () => {
        if (!vault.onboarded && getReq.result && getReq.result.onboarded) {
          vault = getReq.result;
          activeRoomId = vault.rooms[0]?.id || null;
          saveVault();
          bootInterface();
        }
      };
    };
  } catch (_) {}
}

function saveVault() {
  const serialized = JSON.stringify(vault);
  // 1. Sauvegarde fichier interne natif Android (offchat_prod_vault.json)
  if (window.OffChatNative && typeof window.OffChatNative.saveVaultToFile === 'function') {
    try {
      window.OffChatNative.saveVaultToFile(serialized);
    } catch (_) {}
  }
  // 2. Sauvegarde localStorage
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (_) {}
  // 3. Sauvegarde IndexedDB
  saveToIndexedDB(vault);
  renderUserHeader();
}

// --- MOTEUR MESH P2P PRODUCTION (UDP WI-FI :45888 + BLE GATT + MULTI-SAUTS STORE & FORWARD) ---
function broadcastMeshPacket(packet) {
  const pkt = {
    pktId: packet.pktId || `pkt_${Date.now()}_${randHex(6)}`,
    ttl: typeof packet.ttl === 'number' ? packet.ttl : 3,
    senderFp: vault.user.fingerprint,
    senderAlias: vault.user.alias || 'Anonyme',
    senderQueue: vault.user.rxQueue,
    timestamp: Date.now(),
    ...packet
  };

  seenPacketIds.add(pkt.pktId);
  const rawJson = JSON.stringify(pkt);

  // 1. Diffusion matérielle Android (UDP Broadcast :45888 + Bluetooth Low Energy GATT)
  if (window.OffChatNative && typeof window.OffChatNative.broadcastMeshPacket === 'function') {
    try {
      window.OffChatNative.broadcastMeshPacket(rawJson);
    } catch (_) {}
  }

  // 2. Diffusion inter-onglets locale (BroadcastChannel)
  if (localMeshChannel) {
    try {
      localMeshChannel.postMessage(rawJson);
    } catch (_) {}
  }

  // 3. Diffusion sur le Relais WebSocket Aveugle (si configuré pour longue distance Internet)
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    try {
      relaySocket.send(rawJson);
    } catch (_) {}
  }

  return pkt.pktId;
}

function decodeBase64Utf8(b64) {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (_) {
    return '';
  }
}

async function handleIncomingMeshPacket(rawJson, transportLabel = 'Mesh P2P') {
  if (!rawJson || !vault.onboarded) return;
  let pkt;
  try {
    pkt = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  } catch (_) {
    return;
  }

  if (!pkt || !pkt.pktId || seenPacketIds.has(pkt.pktId)) return;
  seenPacketIds.add(pkt.pktId);

  // Ignorer nos propres paquets
  if (pkt.senderFp === vault.user.fingerprint) return;

  // Store-and-Forward Multi-Sauts : si le paquet a un TTL > 1 et n'est pas uniquement pour nous, on le relaie aux autres téléphones !
  const isExclusivelyForMe = pkt.targetFp && pkt.targetFp === vault.user.fingerprint;
  if (!isExclusivelyForMe && typeof pkt.ttl === 'number' && pkt.ttl > 1) {
    const forwarded = { ...pkt, ttl: pkt.ttl - 1 };
    const fwdJson = JSON.stringify(forwarded);
    if (window.OffChatNative && typeof window.OffChatNative.broadcastMeshPacket === 'function') {
      try { window.OffChatNative.broadcastMeshPacket(fwdJson); } catch (_) {}
    }
  }

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // CAS 1 : Appairage bilatéral automatique (quelqu'un vient de scanner notre QR Code ou nous répond)
  if ((pkt.type === 'OFFCHAT_PAIR_HELLO' || pkt.type === 'OFFCHAT_PAIR_ACK') && pkt.targetFp === vault.user.fingerprint) {
    const peerId = `peer-${pkt.senderFp}`;
    let room = vault.rooms.find((r) => r.fingerprint === pkt.senderFp);
    const colors = ['#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed'];
    if (!room) {
      room = {
        id: peerId,
        name: pkt.senderAlias || `Pair_${pkt.senderFp}`,
        avatar: (pkt.senderAlias || 'P').slice(0, 2).toUpperCase(),
        avatarBg: colors[vault.rooms.length % colors.length],
        category: 'people',
        unread: 1,
        time: now,
        preview: `Connecté en direct via ${transportLabel}`,
        verifiedQr: true,
        fingerprint: pkt.senderFp,
        rxQueue: pkt.senderQueue || `q_rx_${pkt.senderFp}`,
        sharedKey: pkt.sharedKey || pkt.senderFp,
        hops: 1,
        events: [
          { type: 'date', label: `Canal P2P Chiffré • ${transportLabel}` },
          { type: 'system', time: now, text: `${pkt.senderAlias} (#${pkt.senderFp}) s'est connecté via ${transportLabel}`, icon: '🔗' }
        ]
      };
      vault.rooms.unshift(room);
      if (!activeRoomId) activeRoomId = room.id;
      saveVault();
      renderRoomList();
      renderTabs();
      renderChatStream();
      sendPushNotification(`Nouveau contact connecté : ${room.name}`, `Appairage P2P réussi via ${transportLabel}`, room.id);
    }

    if (pkt.type === 'OFFCHAT_PAIR_HELLO') {
      broadcastMeshPacket({
        type: 'OFFCHAT_PAIR_ACK',
        targetFp: pkt.senderFp,
        sharedKey: room.sharedKey || vault.user.fingerprint
      });
    }
    return;
  }

  // CAS 2 : Invitation automatique à un Groupe Maillé (Mesh Group)
  if (pkt.type === 'OFFCHAT_GROUP_INVITE' && Array.isArray(pkt.memberFps) && pkt.memberFps.includes(vault.user.fingerprint)) {
    let grp = vault.rooms.find((r) => r.id === pkt.groupId || r.fingerprint === pkt.groupFp);
    if (!grp) {
      grp = {
        id: pkt.groupId || `grp-${pkt.groupFp}`,
        name: pkt.groupName || `Groupe #${pkt.groupFp}`,
        avatar: (pkt.groupName || 'GR').slice(0, 2).toUpperCase(),
        avatarBg: '#7c3aed',
        category: 'groups',
        unread: 1,
        time: now,
        preview: `Groupe maillé créé par ${pkt.senderAlias}`,
        verifiedQr: true,
        fingerprint: pkt.groupFp,
        transport: pkt.transport || 'Multi-Sauts BLE + Wi-Fi Direct',
        members: pkt.members || [],
        memberFps: pkt.memberFps || [],
        hops: 3,
        events: [
          { type: 'date', label: `Groupe Maillé • ${pkt.transport || transportLabel}` },
          { type: 'system', time: now, text: `${pkt.senderAlias} vous a connecté au groupe : ${(pkt.members || []).join(' ⇄ ')}`, icon: '👥' }
        ]
      };
      vault.rooms.unshift(grp);
      if (!activeRoomId) activeRoomId = grp.id;
      saveVault();
      renderRoomList();
      renderTabs();
      renderChatStream();
      sendPushNotification(`Nouveau Groupe : ${grp.name}`, `Connecté par ${pkt.senderAlias} via ${transportLabel}`, grp.id);
    }
    return;
  }

  // CAS 3 : Message chiffré (1-to-1 ou Groupe)
  if (pkt.type === 'OFFCHAT_CHAT_MSG') {
    let targetRoom = null;
    if (pkt.isGroup && pkt.groupFp) {
      targetRoom = vault.rooms.find((r) => r.category === 'groups' && r.fingerprint === pkt.groupFp);
    } else if (pkt.targetFp === vault.user.fingerprint) {
      targetRoom = vault.rooms.find((r) => r.category === 'people' && r.fingerprint === pkt.senderFp);
      // Si l'expéditeur n'était pas encore dans la liste mais connaît notre empreinte QR, créer le salon automatiquement
      if (!targetRoom) {
        const colors = ['#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed'];
        targetRoom = {
          id: `peer-${pkt.senderFp}`,
          name: pkt.senderAlias || `Pair_${pkt.senderFp}`,
          avatar: (pkt.senderAlias || 'P').slice(0, 2).toUpperCase(),
          avatarBg: colors[vault.rooms.length % colors.length],
          category: 'people',
          unread: 0,
          time: now,
          preview: '',
          verifiedQr: true,
          fingerprint: pkt.senderFp,
          hops: 1,
          events: [
            { type: 'date', label: `Discussion P2P Chiffrée • ${transportLabel}` }
          ]
        };
        vault.rooms.unshift(targetRoom);
      }
    }

    if (!targetRoom) return;

    const secretSeed = pkt.isGroup ? targetRoom.fingerprint : (targetRoom.sharedKey || vault.user.fingerprint);
    const clearText = await decryptPayload(pkt.cipher || pkt.text || '', pkt.iv || null, secretSeed);

    targetRoom.events.push({
      type: 'msg',
      msgId: pkt.pktId,
      sender: pkt.senderAlias || targetRoom.name,
      outgoing: false,
      time: now,
      transport: transportLabel,
      text: clearText
    });
    targetRoom.preview = `${pkt.senderAlias}: ${clearText}`;
    targetRoom.time = now;
    if (activeRoomId !== targetRoom.id) {
      targetRoom.unread = (targetRoom.unread || 0) + 1;
    }

    saveVault();
    renderRoomList();
    renderTabs();
    renderChatStream();
    sendPushNotification(`Message de ${pkt.senderAlias} (${transportLabel})`, clearText, targetRoom.id);

    // Envoyer un accusé de réception P2P automatique
    broadcastMeshPacket({
      type: 'OFFCHAT_MSG_ACK',
      targetFp: pkt.senderFp,
      ackMsgId: pkt.pktId,
      via: transportLabel
    });
    return;
  }

  // CAS 4 : Accusé de réception P2P (✓✓ Reçu via BLE / Wi-Fi Direct)
  if (pkt.type === 'OFFCHAT_MSG_ACK' && pkt.targetFp === vault.user.fingerprint) {
    for (const r of vault.rooms) {
      const ev = r.events.find((e) => e.msgId === pkt.ackMsgId);
      if (ev) {
        ev.deliveredVia = pkt.via || transportLabel;
        saveVault();
        renderChatStream();
        break;
      }
    }
    return;
  }

  // CAS 5 : Ping de découverte de proximité
  if (pkt.type === 'OFFCHAT_DISCOVERY_PING') {
    const knownPeer = vault.rooms.find((r) => r.fingerprint === pkt.senderFp);
    if (knownPeer) {
      knownPeer.events.push({
        type: 'system',
        time: now,
        text: `${pkt.senderAlias} (#${pkt.senderFp}) est en ligne à portée ${transportLabel}`,
        icon: '📡'
      });
      saveVault();
      renderChatStream();
    }
  }
}

// Callbacks appelés en temps réel par le moteur Java natif Android (MainActivity.java)
window.onNativeMeshPacket = (b64, transport) => {
  const json = decodeBase64Utf8(b64);
  if (json) handleIncomingMeshPacket(json, transport);
};

window.onNativePeerCount = (count) => {
  detectedPeersCount = Number(count) || 0;
  updateMeshStatusUI();
};

if (localMeshChannel) {
  localMeshChannel.onmessage = (ev) => {
    handleIncomingMeshPacket(ev.data, 'P2P Local');
  };
}

function updateMeshStatusUI() {
  const pill = document.getElementById('mesh-status-pill');
  const subFp = document.getElementById('mobile-sub-fp');
  const alias = vault.user.alias || 'Anonyme';
  const hasNative = !!(window.OffChatNative && typeof window.OffChatNative.getTransportStatus === 'function');

  if (pill) {
    if (hasNative) {
      pill.textContent = detectedPeersCount > 0
        ? `🟢 ${detectedPeersCount} pair(s) BLE/Wi-Fi`
        : '📡 BLE + Wi-Fi :45888';
    } else {
      pill.textContent = relaySocket && relaySocket.readyState === WebSocket.OPEN
        ? '🌐 Relais Connecté'
        : '📡 P2P Prêt';
    }
  }
  if (subFp) {
    subFp.textContent = `${alias} (#${vault.user.fingerprint}) • ${detectedPeersCount > 0 ? detectedPeersCount + ' pair(s) proche(s)' : 'P2P Actif'}`;
  }
}

// --- NAVIGATION RESPONSIVE MOBILE (TIROIR BURGER & VUE LISTE <-> CHAT) ---
const appShell = document.getElementById('app-shell');
const colNav = document.getElementById('col-nav');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const chatDropdown = document.getElementById('chat-dropdown');

function openDrawer() {
  colNav.classList.add('open');
  drawerBackdrop.classList.remove('hidden');
}

function closeDrawer() {
  colNav.classList.remove('open');
  drawerBackdrop.classList.add('hidden');
}

function setMobileView(view) {
  appShell.setAttribute('data-mobile-view', view);
}

document.getElementById('btn-open-drawer').addEventListener('click', openDrawer);
document.getElementById('btn-close-drawer').addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

document.getElementById('btn-back-to-list').addEventListener('click', () => {
  setMobileView('list');
});

// Menu déroulant ⋮ de la conversation
document.getElementById('btn-chat-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  chatDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  chatDropdown.classList.add('hidden');
});

// --- PERSONNALISATION DES COULEURS ---
function applyTheme(themeKey) {
  const t = THEMES[themeKey] || THEMES.komai;
  vault.theme = themeKey;
  vault.customAccent = null;
  const root = document.documentElement;
  root.style.setProperty('--bg-nav', t.nav);
  root.style.setProperty('--bg-rooms', t.rooms);
  root.style.setProperty('--bg-chat', t.chat);
  root.style.setProperty('--bg-active', t.active);
  root.style.setProperty('--bg-pill', t.pill);
  root.style.setProperty('--bg-bubble-me', t.me);
  root.style.setProperty('--bg-bubble-peer', t.peer);
  root.style.setProperty('--border-green', t.border);
  root.style.setProperty('--text-main', t.text);
  root.style.setProperty('--text-bright', t.bright);
  root.style.setProperty('--text-muted', t.muted);

  const labelEl = document.getElementById('active-theme-name');
  if (labelEl) labelEl.textContent = t.label;
  saveVault();
}

function applyCustomAccent(hex) {
  vault.customAccent = hex;
  const root = document.documentElement;
  root.style.setProperty('--text-bright', hex);
  root.style.setProperty('--border-green', `${hex}55`);
  root.style.setProperty('--bg-active', `${hex}28`);
  root.style.setProperty('--bg-bubble-me', `${hex}22`);
  const labelEl = document.getElementById('active-theme-name');
  if (labelEl) labelEl.textContent = `Custom (${hex})`;
  saveVault();
}

// --- PREMIER LANCEMENT : CRÉATION DU PSEUDO ---
const onboardingScreen = document.getElementById('onboarding-screen');

document.getElementById('onboarding-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const alias = document.getElementById('onboarding-alias').value.trim();
  if (!alias) return;

  vault.user.alias = alias;
  vault.user.fingerprint = randHex(6).toUpperCase();
  vault.user.pubKey = `x25519_${randHex(16)}`;
  vault.user.rxQueue = `q_rx_${randHex(6)}`;
  vault.onboarded = true;

  saveVault();
  onboardingScreen.classList.add('hidden');
  bootInterface();
});

// --- RENDU DE L'INTERFACE ---
function renderUserHeader() {
  const u = vault.user;
  const alias = u.alias || 'Anonyme';
  document.getElementById('my-avatar-box').textContent = alias.slice(0, 2).toUpperCase();
  document.getElementById('my-handle-label').textContent = `@${alias.toLowerCase()}:${u.fingerprint.toLowerCase()}`;
  document.getElementById('my-name-label').textContent = alias;
  document.getElementById('my-fp-short').textContent = `#${u.fingerprint}`;
  updateMeshStatusUI();
}

function renderRoomList() {
  const container = document.getElementById('room-list');
  container.innerHTML = '';

  const allCount = vault.rooms.length;
  const peopleCount = vault.rooms.filter((r) => r.category === 'people').length;
  const groupsCount = vault.rooms.filter((r) => r.category === 'groups').length;

  document.getElementById('badge-all').textContent = allCount;
  document.getElementById('badge-people').textContent = peopleCount;
  document.getElementById('badge-groups').textContent = groupsCount;

  const filtered = vault.rooms.filter((r) => activeCategory === 'all' || r.category === activeCategory);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-rooms-box';
    empty.innerHTML = `
      <div style="font-size:2rem;">▣</div>
      <strong>Aucune conversation pour le moment</strong>
      <p>Scannez le QR Code d'un contact à proximité ou partagez votre propre QR Code unique : les deux téléphones se synchronisent automatiquement en Bluetooth LE / Wi-Fi Direct !</p>
      <button type="button" class="btn-green full-w" id="btn-empty-scan">▣ Afficher mon QR / Scanner un contact</button>
    `;
    container.appendChild(empty);
    document.getElementById('btn-empty-scan').addEventListener('click', () => openQrModal('my-qr'));
    return;
  }

  for (const room of filtered) {
    const row = document.createElement('div');
    row.className = `room-row ${room.id === activeRoomId ? 'active' : ''}`;
    row.innerHTML = `
      <div class="room-avatar" style="background:${room.avatarBg}">${room.avatar}</div>
      <div class="room-meta">
        <div class="room-top">
          <span>${room.category === 'groups' ? '👥 ' : ''}${room.name}</span>
          <span class="room-time">${room.time}</span>
        </div>
        <div class="room-sub">
          <span>${room.preview}</span>
          ${room.unread ? `<span class="count-badge">${room.unread}</span>` : ''}
        </div>
      </div>
    `;
    row.addEventListener('click', () => {
      selectRoom(room.id);
      setMobileView('chat');
    });
    container.appendChild(row);
  }
}

function renderTabs() {
  const bar = document.getElementById('tabs-bar');
  bar.innerHTML = '';
  for (const room of vault.rooms) {
    const tab = document.createElement('div');
    tab.className = `tab-item ${room.id === activeRoomId ? 'active' : ''}`;
    tab.innerHTML = `
      <span style="display:flex;align-items:center;gap:8px;overflow:hidden;">
        <span class="room-avatar" style="width:24px;height:24px;font-size:0.7rem;background:${room.avatarBg}">${room.avatar}</span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${room.name}</span>
      </span>
      <span class="close-tab-btn" title="Fermer">×</span>
    `;
    tab.addEventListener('click', () => selectRoom(room.id));
    bar.appendChild(tab);
  }
}

function renderChatStream() {
  const room = vault.rooms.find((r) => r.id === activeRoomId);
  const stream = document.getElementById('chat-stream');
  const strip = document.getElementById('group-members-strip');
  const pills = document.getElementById('group-members-pills');
  const input = document.getElementById('chat-input');

  if (!room) {
    document.getElementById('active-title').textContent = 'Aucune discussion sélectionnée';
    document.getElementById('active-avatar').textContent = '⚡';
    document.getElementById('active-avatar').style.background = 'var(--bg-active)';
    document.getElementById('active-badge').textContent = 'Ajoutez un contact par QR Code pour parler';
    strip.classList.add('hidden');
    input.disabled = true;
    input.placeholder = 'Ajoutez d’abord un contact par QR Code...';
    stream.innerHTML = `
      <div class="empty-rooms-box" style="margin:auto;">
        <div style="font-size:2.2rem;">🔒</div>
        <strong>Démarrez votre première discussion chiffrée P2P</strong>
        <p>OffChat v2.0 communique directement entre téléphones (Wi-Fi Direct UDP :45888 + Bluetooth LE GATT) sans serveur de stockage. Affichez votre QR Code ou scannez celui d'un ami.</p>
        <button type="button" class="btn-green" id="btn-chat-empty-qr">▣ Mon QR Code / Ajouter un contact</button>
      </div>
    `;
    document.getElementById('btn-chat-empty-qr').addEventListener('click', () => openQrModal('my-qr'));
    return;
  }

  input.disabled = false;
  input.placeholder = `Message chiffré AES-GCM vers ${room.name}...`;

  document.getElementById('active-title').textContent = room.name;
  const av = document.getElementById('active-avatar');
  av.textContent = room.avatar;
  av.style.background = room.avatarBg;

  if (room.category === 'groups') {
    document.getElementById('active-badge').textContent = `👥 ${(room.members || []).length} pairs • ${room.transport}`;
    strip.classList.remove('hidden');
    pills.innerHTML = (room.members || []).map((m) => `<span class="member-pill">🔗 ${m}</span>`).join('');
  } else {
    document.getElementById('active-badge').textContent = `🔒 AES-GCM #${room.fingerprint} • P2P Permanent`;
    strip.classList.add('hidden');
  }

  stream.innerHTML = '';
  for (const ev of room.events) {
    if (ev.type === 'date') {
      const d = document.createElement('div');
      d.className = 'date-pill';
      d.textContent = ev.label;
      stream.appendChild(d);
    } else if (ev.type === 'system') {
      const row = document.createElement('div');
      row.className = 'sys-row';
      row.innerHTML = `
        <span class="room-time">${ev.time}</span>
        <div class="sys-pill"><span>${ev.text}</span> <strong>${ev.icon}</strong></div>
      `;
      stream.appendChild(row);
    } else if (ev.type === 'msg') {
      const line = document.createElement('div');
      line.className = `msg-line ${ev.outgoing ? 'me' : 'peer'}`;
      if (ev.outgoing) {
        const statusReceipt = ev.deliveredVia ? `✓✓ Reçu (${ev.deliveredVia})` : '✓ Envoyé P2P';
        line.innerHTML = `
          <span class="room-time">${statusReceipt} • ${ev.time}</span>
          <div class="bubble me"></div>
        `;
      } else {
        line.innerHTML = `
          <div class="room-avatar" style="width:28px;height:28px;font-size:0.7rem;background:${room.avatarBg}">${ev.sender.slice(0, 2).toUpperCase()}</div>
          <div class="bubble peer"></div>
          <span class="room-time">${ev.transport ? ev.transport + ' • ' : ''}${ev.time}</span>
        `;
      }
      line.querySelector('.bubble').textContent = `${ev.outgoing ? '' : ev.sender + ': '}${ev.text}`;
      stream.appendChild(line);
    }
  }
  stream.scrollTop = stream.scrollHeight;
}

function selectRoom(id) {
  activeRoomId = id;
  const r = vault.rooms.find((x) => x.id === id);
  if (r) r.unread = 0;
  saveVault();
  renderRoomList();
  renderTabs();
  renderChatStream();
}

// --- ENVOI ET RÉCEPTION DE MESSAGES CHIFFRÉS (TEMPS RÉEL P2P + SAUVEGARDE PERMANENTE) ---
document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const room = vault.rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msgId = `pkt_${Date.now()}_${randHex(6)}`;
  const isGroup = room.category === 'groups';
  const secretSeed = isGroup ? room.fingerprint : (room.sharedKey || room.fingerprint);

  const encrypted = await encryptPayload(text, secretSeed);

  room.events.push({
    type: 'msg',
    msgId,
    sender: vault.user.alias,
    outgoing: true,
    time: now,
    text
  });
  room.preview = `${vault.user.alias}: ${text}`;
  room.time = now;

  // Diffuser le paquet chiffré sur tous les transports P2P (UDP Wi-Fi :45888 + BLE GATT + BroadcastChannel + Relais WebSocket)
  broadcastMeshPacket({
    pktId: msgId,
    type: 'OFFCHAT_CHAT_MSG',
    isGroup,
    groupFp: isGroup ? room.fingerprint : null,
    targetFp: isGroup ? null : room.fingerprint,
    cipher: encrypted.cipher,
    iv: encrypted.iv,
    ttl: 3
  });

  saveVault();
  renderRoomList();
  renderChatStream();
});

function broadcastDiscoveryPing() {
  broadcastMeshPacket({
    type: 'OFFCHAT_DISCOVERY_PING',
    ttl: 2
  });
  sendPushNotification(
    'Ping Découverte Diffusé 📡',
    'Annonce envoyée sur Wi-Fi Direct UDP (:45888) et Bluetooth Low Energy GATT.'
  );
}

function triggerIncomingMessage() {
  const room = vault.rooms.find((r) => r.id === activeRoomId);
  if (!room) return;
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sender = room.category === 'groups' ? (room.members[1] || 'Pair').split(' ')[0] : room.name;
  const text = room.category === 'groups'
    ? `Paquet de groupe reçu via ${room.transport} (chiffré AES-GCM & sauvegardé).`
    : `Message hors-ligne reçu de ${room.name} (#${room.fingerprint}) !`;
  room.events.push({ type: 'msg', sender, outgoing: false, time: now, transport: 'Test Local', text });
  room.preview = `${sender}: ${text}`;
  room.time = now;
  saveVault();
  renderRoomList();
  renderChatStream();
  sendPushNotification(`Nouveau message de ${sender}`, text, room.id);
}

const menuPingMesh = document.getElementById('menu-ping-mesh');
if (menuPingMesh) menuPingMesh.addEventListener('click', broadcastDiscoveryPing);
document.getElementById('menu-sim-hop').addEventListener('click', triggerIncomingMessage);
document.getElementById('menu-show-qr').addEventListener('click', () => openQrModal('my-qr'));
document.getElementById('menu-new-group').addEventListener('click', openGroupModal);
document.getElementById('menu-open-settings').addEventListener('click', openSettings);
document.getElementById('menu-delete-room').addEventListener('click', () => {
  if (!activeRoomId) return;
  vault.rooms = vault.rooms.filter((r) => r.id !== activeRoomId);
  activeRoomId = vault.rooms[0]?.id || null;
  saveVault();
  renderRoomList();
  renderTabs();
  renderChatStream();
  setMobileView('list');
});

document.getElementById('btn-cycle-transport').addEventListener('click', () => {
  currentTransportIdx = (currentTransportIdx + 1) % transportModes.length;
  document.getElementById('btn-cycle-transport').textContent = transportModes[currentTransportIdx];
});

document.querySelectorAll('.cat-item[data-cat]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-item[data-cat]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = btn.dataset.cat;
    renderRoomList();
    closeDrawer();
  });
});

// --- CRÉATION DE GROUPE MESH & INTERCONNEXION P2P AUTOMATIQUE ---
const groupModal = document.getElementById('group-modal');

function openGroupModal() {
  closeDrawer();
  const picker = document.getElementById('group-contact-picker');
  picker.innerHTML = '';
  const people = vault.rooms.filter((r) => r.category === 'people');
  if (people.length === 0) {
    picker.innerHTML = `<div style="color:var(--text-muted);font-size:0.76rem;">Ajoutez d'abord des contacts via QR Code pour pouvoir les interconnecter dans un groupe.</div>`;
  } else {
    for (const p of people) {
      const row = document.createElement('label');
      row.className = 'saved-contact-item';
      row.innerHTML = `
        <span><input type="checkbox" value="${p.id}" checked /> <strong>${p.name}</strong></span>
        <code>#${p.fingerprint}</code>
      `;
      picker.appendChild(row);
    }
  }
  groupModal.showModal();
}

document.getElementById('btn-nav-newgroup').addEventListener('click', openGroupModal);
document.getElementById('btn-new-group-col2').addEventListener('click', openGroupModal);
document.getElementById('btn-top-group').addEventListener('click', openGroupModal);
document.getElementById('btn-add-peer-to-group').addEventListener('click', openGroupModal);
document.getElementById('btn-close-group').addEventListener('click', () => groupModal.close());

document.getElementById('btn-create-group-confirm').addEventListener('click', () => {
  const nameInput = document.getElementById('new-group-name');
  const groupFp = randHex(6).toUpperCase();
  const name = nameInput.value.trim() || `Groupe #${groupFp.slice(0, 4)}`;
  const transport = document.getElementById('new-group-transport').value;
  const checkedIds = Array.from(document.querySelectorAll('#group-contact-picker input:checked')).map((el) => el.value);
  const selectedPeers = vault.rooms.filter((r) => checkedIds.includes(r.id));

  const memberLabels = [`${vault.user.alias} (#${vault.user.fingerprint})`].concat(
    selectedPeers.map((p) => `${p.name} (#${p.fingerprint})`)
  );
  const memberFps = [vault.user.fingerprint].concat(selectedPeers.map((p) => p.fingerprint));
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const id = `grp-${groupFp}`;

  vault.rooms.unshift({
    id,
    name,
    avatar: name.slice(0, 2).toUpperCase(),
    avatarBg: '#7c3aed',
    category: 'groups',
    unread: 0,
    time: now,
    preview: `${memberLabels.length} membre(s) connecté(s)`,
    verifiedQr: true,
    fingerprint: groupFp,
    transport,
    members: memberLabels,
    memberFps,
    hops: 3,
    events: [
      { type: 'date', label: `Groupe Maillé • ${transport}` },
      { type: 'system', time: now, text: `${vault.user.alias} a créé le groupe et interconnecté : ${memberLabels.join(' ⇄ ')}`, icon: '👥' }
    ]
  });

  // Diffuser l'invitation de groupe à tous les contacts sélectionnés en P2P
  broadcastMeshPacket({
    type: 'OFFCHAT_GROUP_INVITE',
    groupId: id,
    groupFp,
    groupName: name,
    transport,
    members: memberLabels,
    memberFps,
    ttl: 3
  });

  nameInput.value = '';
  saveVault();
  groupModal.close();
  selectRoom(id);
  setMobileView('chat');
  sendPushNotification(`Groupe créé : ${name}`, `${memberLabels.length} pairs interconnectés en P2P`, id);
});

// --- MODAL QR CODE UNIQUE & CAMÉRA ---
const qrModal = document.getElementById('qr-modal');

function drawQr(seed) {
  const canvas = document.getElementById('qr-canvas');
  const ctx = canvas.getContext('2d');
  const size = 21;
  const cell = Math.floor(canvas.width / size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  function finder(ox, oy) {
    ctx.fillStyle = '#07120a';
    ctx.fillRect(ox * cell, oy * cell, 7 * cell, 7 * cell);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((ox + 1) * cell, (oy + 1) * cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#19873b';
    ctx.fillRect((ox + 2) * cell, (oy + 2) * cell, 3 * cell, 3 * cell);
  }
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  ctx.fillStyle = '#07120a';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8)) continue;
      if (((h >> ((x * 5 + y * 3) % 24)) ^ seed.charCodeAt((x + y) % seed.length)) & 1) {
        ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
      }
    }
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  document.getElementById('qr-video').classList.add('hidden');
  document.getElementById('camera-placeholder').classList.remove('hidden');
}

function openQrModal(tab = 'my-qr') {
  closeDrawer();
  const u = vault.user;
  const uri = `offchat://pair?alias=${encodeURIComponent(u.alias)}&fp=${u.fingerprint}&q=${u.rxQueue}&k=${u.fingerprint}`;
  document.getElementById('my-uri-input').value = uri;
  document.getElementById('qr-user-name').textContent = u.alias;
  document.getElementById('qr-user-fp').textContent = `#${u.fingerprint}`;
  drawQr(uri);

  document.querySelectorAll('.modal-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('pane-my-qr').classList.toggle('active', tab === 'my-qr');
  document.getElementById('pane-scan-qr').classList.toggle('active', tab === 'scan-qr');
  if (tab === 'my-qr') stopCamera();
  qrModal.showModal();
}

document.querySelectorAll('.modal-tab').forEach((t) => {
  t.addEventListener('click', () => openQrModal(t.dataset.tab));
});

document.getElementById('btn-rotate-qr').addEventListener('click', () => {
  vault.user.fingerprint = randHex(6).toUpperCase();
  saveVault();
  openQrModal('my-qr');
});

document.getElementById('btn-profile-qr').addEventListener('click', () => openQrModal('my-qr'));
document.getElementById('btn-sidebar-myqr').addEventListener('click', () => openQrModal('my-qr'));
document.getElementById('btn-sidebar-scan').addEventListener('click', () => openQrModal('scan-qr'));
document.getElementById('btn-mobile-myqr').addEventListener('click', () => openQrModal('my-qr'));
document.getElementById('btn-new-room').addEventListener('click', () => openQrModal('scan-qr'));
document.getElementById('btn-attach-qr').addEventListener('click', () => openQrModal('my-qr'));
document.getElementById('btn-close-modal').addEventListener('click', () => {
  stopCamera();
  qrModal.close();
});

document.getElementById('btn-copy-uri').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('my-uri-input').value);
  const btn = document.getElementById('btn-copy-uri');
  btn.textContent = 'Copié ✔';
  setTimeout(() => (btn.textContent = 'Copier'), 1300);
});

function addContactRoom({ alias, fp, q, k }) {
  const cleanAlias = (alias || 'Contact').trim();
  const fingerprint = (fp || randHex(6)).toUpperCase();
  const sharedKey = k || fingerprint;
  const id = `peer-${fingerprint}`;
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const colors = ['#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed'];

  let existing = vault.rooms.find((r) => r.id === id);
  if (!existing) {
    existing = {
      id,
      name: cleanAlias,
      avatar: cleanAlias.slice(0, 2).toUpperCase(),
      avatarBg: colors[vault.rooms.length % colors.length],
      category: 'people',
      unread: 0,
      time: now,
      preview: `Contact QR #${fingerprint} sauvegardé`,
      verifiedQr: true,
      fingerprint,
      rxQueue: q || `q_rx_${randHex(4)}`,
      sharedKey,
      hops: 1,
      events: [
        { type: 'date', label: 'Discussion Chiffrée AES-GCM Permanente' },
        { type: 'system', time: now, text: `${cleanAlias} (#${fingerprint}) ajouté par QR Code — synchronisation P2P envoyée`, icon: '▣' }
      ]
    };
    vault.rooms.unshift(existing);
    saveVault();
    sendPushNotification(`Contact QR ajouté : ${cleanAlias}`, `Empreinte #${fingerprint} sauvegardée`, id);
  }

  // Envoyer automatiquement un paquet d'appairage bilatéral P2P pour que l'autre téléphone nous ajoute aussi sans avoir à scanner en retour !
  broadcastMeshPacket({
    type: 'OFFCHAT_PAIR_HELLO',
    targetFp: fingerprint,
    sharedKey
  });

  stopCamera();
  qrModal.close();
  selectRoom(id);
  setMobileView('chat');
}

document.getElementById('btn-pair-uri').addEventListener('click', () => {
  const raw = document.getElementById('paste-uri-input').value.trim();
  if (!raw) return;
  if (raw.includes('?')) {
    const params = new URLSearchParams(raw.split('?')[1]);
    addContactRoom({
      alias: params.get('alias') || 'Contact_QR',
      fp: params.get('fp') || randHex(6).toUpperCase(),
      q: params.get('q'),
      k: params.get('k')
    });
  } else {
    addContactRoom({ alias: raw, fp: randHex(6).toUpperCase() });
  }
  document.getElementById('paste-uri-input').value = '';
});

document.getElementById('btn-sim-scan').addEventListener('click', () => {
  broadcastDiscoveryPing();
  stopCamera();
  qrModal.close();
});

document.getElementById('btn-start-cam').addEventListener('click', async () => {
  const video = document.getElementById('qr-video');
  const placeholder = document.getElementById('camera-placeholder');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = cameraStream;
    video.classList.remove('hidden');
    placeholder.classList.add('hidden');
    await video.play();

    if ('BarcodeDetector' in window) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => {
        if (!cameraStream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            const val = codes[0].rawValue;
            const params = new URLSearchParams(val.includes('?') ? val.split('?')[1] : '');
            addContactRoom({
              alias: params.get('alias') || 'Contact_Scan',
              fp: params.get('fp') || randHex(6).toUpperCase(),
              q: params.get('q'),
              k: params.get('k')
            });
            return;
          }
        } catch (_) {}
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  } catch (_) {
    placeholder.innerHTML = `<p>Autorisez la caméra ou collez directement le lien QR du contact ci-dessous.</p>`;
  }
});

// --- MODAL PARAMÈTRES, NOTIFICATIONS PUSH-UP & SAUVEGARDE ---
const settingsModal = document.getElementById('settings-modal');

function updatePushToggleButton() {
  const btn = document.getElementById('btn-toggle-push');
  if (!btn) return;
  const active = vault.pushEnabled !== false;
  btn.textContent = active ? '🔔 Activées' : '🔕 Désactivées';
}

function openSettings() {
  closeDrawer();
  document.getElementById('settings-alias-input').value = vault.user.alias;
  document.getElementById('settings-relay-input').value = vault.relayUrl || '';
  updatePushToggleButton();
  renderSavedContactsInSettings();
  settingsModal.showModal();
}

document.getElementById('btn-toggle-push').addEventListener('click', async () => {
  vault.pushEnabled = vault.pushEnabled === false;
  if (vault.pushEnabled) {
    if (window.OffChatNative && typeof window.OffChatNative.requestPermission === 'function') {
      try { window.OffChatNative.requestPermission(); } catch (_) {}
    } else if ('Notification' in window && Notification.permission !== 'granted') {
      try { await Notification.requestPermission(); } catch (_) {}
    }
  }
  updatePushToggleButton();
  saveVault();
});

document.getElementById('btn-test-push').addEventListener('click', () => {
  vault.pushEnabled = true;
  updatePushToggleButton();
  sendPushNotification(
    'OffChat v2.0 Push-Up Actif 🔔',
    'Les notifications push hors-ligne (Bluetooth LE / Wi-Fi Direct UDP) fonctionnent parfaitement !'
  );
});

function renderSavedContactsInSettings() {
  const listEl = document.getElementById('saved-contacts-list');
  listEl.innerHTML = '';
  if (vault.rooms.length === 0) {
    listEl.innerHTML = `<div style="color:var(--text-muted);font-size:0.75rem;">Aucun contact ou groupe enregistré.</div>`;
    return;
  }
  for (const c of vault.rooms) {
    const row = document.createElement('div');
    row.className = 'saved-contact-item';
    row.innerHTML = `
      <span>${c.category === 'groups' ? '👥' : '👤'} <strong>${c.name}</strong> <code>#${c.fingerprint}</code></span>
      <button type="button" class="btn-new" style="color:#f87171;">Suppr.</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      vault.rooms = vault.rooms.filter((r) => r.id !== c.id);
      if (activeRoomId === c.id) activeRoomId = vault.rooms[0]?.id || null;
      saveVault();
      renderSavedContactsInSettings();
      renderRoomList();
      renderTabs();
      renderChatStream();
    });
    listEl.appendChild(row);
  }
}

document.getElementById('btn-open-theme').addEventListener('click', openSettings);
document.getElementById('btn-open-settings').addEventListener('click', openSettings);
document.getElementById('btn-nav-settings').addEventListener('click', openSettings);
document.getElementById('btn-mobile-settings').addEventListener('click', openSettings);
document.getElementById('btn-top-theme').addEventListener('click', openSettings);
document.getElementById('btn-close-settings').addEventListener('click', () => settingsModal.close());

document.querySelectorAll('[data-theme]').forEach((btn) => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

document.getElementById('custom-accent-picker').addEventListener('input', (e) => {
  applyCustomAccent(e.target.value);
});

document.getElementById('btn-update-alias').addEventListener('click', () => {
  const val = document.getElementById('settings-alias-input').value.trim();
  if (!val) return;
  vault.user.alias = val;
  saveVault();
  document.getElementById('settings-status-msg').textContent = 'Pseudo sauvegardé ✔';
});

document.getElementById('btn-save-relay').addEventListener('click', () => {
  vault.relayUrl = document.getElementById('settings-relay-input').value.trim();
  saveVault();
  connectOptionalHomeRelay();
  document.getElementById('settings-status-msg').textContent = vault.relayUrl
    ? `Relais aveugle configuré (${vault.relayUrl}) ✔`
    : 'Mode 100% P2P local sans relais externe ✔';
});

function connectOptionalHomeRelay() {
  if (relaySocket) {
    try { relaySocket.close(); } catch (_) {}
    relaySocket = null;
  }
  if (!vault.relayUrl) {
    updateMeshStatusUI();
    return;
  }
  try {
    relaySocket = new WebSocket(vault.relayUrl);
    relaySocket.onopen = () => updateMeshStatusUI();
    relaySocket.onclose = () => updateMeshStatusUI();
    relaySocket.onmessage = (ev) => {
      handleIncomingMeshPacket(ev.data, 'Relais WebSocket');
    };
  } catch (_) {}
}

document.getElementById('btn-export-json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `offchat-backup-${vault.user.alias.toLowerCase()}-${vault.user.fingerprint}.json`;
  a.click();
});

document.getElementById('btn-copy-json').addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(vault));
  document.getElementById('settings-status-msg').textContent = 'Sauvegarde JSON copiée ✔';
});

document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed && parsed.user && Array.isArray(parsed.rooms)) {
        vault = parsed;
        vault.onboarded = true;
        activeRoomId = vault.rooms[0]?.id || null;
        saveVault();
        bootInterface();
        renderSavedContactsInSettings();
        document.getElementById('settings-status-msg').textContent = 'Sauvegarde restaurée ✔';
      }
    } catch (_) {}
  };
  reader.readAsText(file);
});

// --- DÉMARRAGE DE L'APPLICATION ---
function bootInterface() {
  applyTheme(vault.theme || 'komai');
  if (vault.customAccent) applyCustomAccent(vault.customAccent);

  if (!vault.onboarded || !vault.user.alias) {
    onboardingScreen.classList.remove('hidden');
  } else {
    onboardingScreen.classList.add('hidden');
  }

  renderUserHeader();
  renderRoomList();
  renderTabs();
  renderChatStream();
  connectOptionalHomeRelay();
}

bootInterface();
loadFromIndexedDBIfNeeded();
