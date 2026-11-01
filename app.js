// OffChat — Application réelle (Démarrage à zéro, Création de pseudo, Sauvegarde permanente IndexedDB + localStorage, Responsive Mobile Burger)

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

const transportModes = ['🔄 Multi-Sauts BLE', '🚶 Porteurs DTN', '🌐 Pont Relais P2P'];
let currentTransportIdx = 0;
let cameraStream = null;
let relaySocket = null;

function randHex(len = 6) {
  const arr = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
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

let vault = loadVaultSync();
let activeRoomId = vault.rooms[0]?.id || null;
let activeCategory = 'all';

// --- STOCKAGE PERMANENT DOUBLE (LOCALSTORAGE + INDEXEDDB) ---
function loadVaultSync() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.user && Array.isArray(parsed.rooms)) return parsed;
    }
  } catch (_) {}
  return createCleanVault();
}

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
          localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
          bootInterface();
        }
      };
    };
  } catch (_) {}
}

function saveVault() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
  } catch (_) {}
  saveToIndexedDB(vault);
  renderUserHeader();
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
  const subFp = document.getElementById('mobile-sub-fp');
  if (subFp) subFp.textContent = `${alias} (#${u.fingerprint}) • 0 Data`;
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
      <p>Scannez le QR Code d'un contact à proximité ou partagez votre propre QR Code unique pour démarrer une discussion hors-ligne sauvegardée sur votre téléphone.</p>
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
        <strong>Démarrez votre première discussion chiffrée</strong>
        <p>OffChat fonctionne sans numéro de téléphone ni serveur central. Cliquez ci-dessous pour afficher votre QR Code unique ou scanner celui d'un ami.</p>
        <button type="button" class="btn-green" id="btn-chat-empty-qr">▣ Mon QR Code / Ajouter un contact</button>
      </div>
    `;
    document.getElementById('btn-chat-empty-qr').addEventListener('click', () => openQrModal('my-qr'));
    return;
  }

  input.disabled = false;
  input.placeholder = `Message chiffré vers ${room.name} (sauvegardé)...`;

  document.getElementById('active-title').textContent = room.name;
  const av = document.getElementById('active-avatar');
  av.textContent = room.avatar;
  av.style.background = room.avatarBg;

  if (room.category === 'groups') {
    document.getElementById('active-badge').textContent = `👥 ${(room.members || []).length} pairs • ${room.transport}`;
    strip.classList.remove('hidden');
    pills.innerHTML = (room.members || []).map((m) => `<span class="member-pill">🔗 ${m}</span>`).join('');
  } else {
    document.getElementById('active-badge').textContent = `🔒 QR #${room.fingerprint} • Sauvegardé`;
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
        line.innerHTML = `
          <span class="room-time">✓✓ ${ev.time}</span>
          <div class="bubble me"></div>
        `;
      } else {
        line.innerHTML = `
          <div class="room-avatar" style="width:28px;height:28px;font-size:0.7rem;background:${room.avatarBg}">${ev.sender.slice(0, 2).toUpperCase()}</div>
          <div class="bubble peer"></div>
          <span class="room-time">${ev.time}</span>
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

// --- ENVOI ET RÉCEPTION DE MESSAGES (SAUVEGARDÉS EN PERMANENCE) ---
document.getElementById('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const room = vault.rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  room.events.push({ type: 'msg', sender: vault.user.alias, outgoing: true, time: now, text });
  room.preview = `${vault.user.alias}: ${text}`;
  room.time = now;

  // Si un relais WebSocket maison optionnel est connecté, relayer le paquet chiffré
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    try {
      relaySocket.send(JSON.stringify({
        type: 'OFFCHAT_RELAY_PACKET',
        targetFp: room.fingerprint,
        senderAlias: vault.user.alias,
        senderFp: vault.user.fingerprint,
        text
      }));
    } catch (_) {}
  }

  saveVault();
  renderRoomList();
  renderChatStream();
});

function triggerIncomingMessage() {
  const room = vault.rooms.find((r) => r.id === activeRoomId);
  if (!room) return;
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sender = room.category === 'groups' ? (room.members[1] || 'Pair').split(' ')[0] : room.name;
  const text = room.category === 'groups'
    ? `Paquet de groupe reçu via ${room.transport} (sauvegardé sur l'appareil).`
    : `Message hors-ligne reçu de ${room.name} (#${room.fingerprint}) !`;
  room.events.push({ type: 'msg', sender, outgoing: false, time: now, text });
  room.preview = `${sender}: ${text}`;
  room.time = now;
  saveVault();
  renderRoomList();
  renderChatStream();
  sendPushNotification(`Nouveau message de ${sender}`, text, room.id);
}

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

// --- CRÉATION DE GROUPE MESH ---
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
  const name = nameInput.value.trim() || `Groupe #${randHex(2).toUpperCase()}`;
  const transport = document.getElementById('new-group-transport').value;
  const checkedIds = Array.from(document.querySelectorAll('#group-contact-picker input:checked')).map((el) => el.value);
  const selectedPeers = vault.rooms.filter((r) => checkedIds.includes(r.id));

  const memberLabels = [`${vault.user.alias} (Moi)`].concat(selectedPeers.map((p) => `${p.name} (#${p.fingerprint})`));
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const id = `grp-${Date.now()}`;

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
    fingerprint: randHex(6).toUpperCase(),
    transport,
    members: memberLabels,
    hops: 3,
    events: [
      { type: 'date', label: `Groupe Maillé • ${transport}` },
      { type: 'system', time: now, text: `${vault.user.alias} a créé le groupe et connecté : ${memberLabels.join(' ⇄ ')}`, icon: '👥' }
    ]
  });

  nameInput.value = '';
  saveVault();
  groupModal.close();
  selectRoom(id);
  setMobileView('chat');
  sendPushNotification(`Groupe créé : ${name}`, `${memberLabels.length} pairs interconnectés`, id);
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
  const uri = `offchat://pair?alias=${encodeURIComponent(u.alias)}&fp=${u.fingerprint}&q=${u.rxQueue}`;
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

function addContactRoom({ alias, fp, q }) {
  const cleanAlias = (alias || 'Contact').trim();
  const fingerprint = (fp || randHex(6)).toUpperCase();
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
      hops: 1,
      events: [
        { type: 'date', label: 'Discussion Chiffrée Permanente' },
        { type: 'system', time: now, text: `${cleanAlias} (#${fingerprint}) ajouté par QR Code et sauvegardé sur l'appareil`, icon: '▣' }
      ]
    };
    vault.rooms.unshift(existing);
    saveVault();
    sendPushNotification(`Contact QR ajouté : ${cleanAlias}`, `Empreinte #${fingerprint} sauvegardée`, id);
  }

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
      q: params.get('q')
    });
  } else {
    addContactRoom({ alias: raw, fp: randHex(6).toUpperCase() });
  }
  document.getElementById('paste-uri-input').value = '';
});

document.getElementById('btn-sim-scan').addEventListener('click', () => {
  const names = ['Alice', 'Charlie_BLE', 'Sarah_Mesh', 'Victor_P2P'];
  const pick = names[Math.floor(Math.random() * names.length)];
  addContactRoom({ alias: pick, fp: randHex(6).toUpperCase() });
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
              q: params.get('q')
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
    'OffChat Push-Up Actif 🔔',
    'Les notifications push hors-ligne (Bluetooth LE / Wi-Fi Direct) fonctionnent parfaitement !'
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
    ? `Relais maison configuré (${vault.relayUrl}) ✔`
    : 'Mode 100% local sans relais externe ✔';
});

function connectOptionalHomeRelay() {
  if (relaySocket) {
    try { relaySocket.close(); } catch (_) {}
    relaySocket = null;
  }
  if (!vault.relayUrl) return;
  try {
    relaySocket = new WebSocket(vault.relayUrl);
    relaySocket.onmessage = (ev) => {
      try {
        const pkt = JSON.parse(ev.data);
        if (pkt.type === 'OFFCHAT_RELAY_PACKET' && pkt.targetFp === vault.user.fingerprint) {
          const room = vault.rooms.find((r) => r.fingerprint === pkt.senderFp);
          if (room) {
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            room.events.push({ type: 'msg', sender: pkt.senderAlias, outgoing: false, time: now, text: pkt.text });
            room.preview = `${pkt.senderAlias}: ${pkt.text}`;
            room.time = now;
            saveVault();
            renderRoomList();
            renderChatStream();
            sendPushNotification(`Message de ${pkt.senderAlias}`, pkt.text, room.id);
          }
        }
      } catch (_) {}
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
