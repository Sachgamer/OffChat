// OffChat — Thèmes personnalisables + Mesh Longue Distance 100 % Smartphone (0 LoRa) + Groupes & Backup

const STORAGE_KEY = 'offchat_vault_v1';

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

const transportModes = ['🔄 Multi-Sauts BLE', '🚶 Porteurs DTN', '🌐 Pont Wi-Fi P2P'];
let currentTransportIdx = 0;

function randHex(len = 6) {
  const arr = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

const defaultVault = {
  theme: 'komai',
  customAccent: null,
  user: {
    alias: 'Bob',
    fingerprint: '8F9A2C',
    pubKey: `x25519_${randHex(16)}`,
    rxQueue: `q_rx_${randHex(6)}`
  },
  rooms: [
    {
      id: 'group-nomade',
      name: 'Escouade Nomade',
      avatar: 'EN',
      avatarBg: '#7c3aed',
      category: 'groups',
      unread: 1,
      time: '19:24',
      preview: 'Charlie_BLE: Relais Multi-Sauts 100% smartphone (sans LoRa) !',
      verifiedQr: true,
      fingerprint: 'GRP77A',
      transport: 'Multi-Sauts BLE + Wi-Fi Direct (0 boîtier externe)',
      members: ['Bob (Moi)', 'Alice (#A4F19B)', 'Charlie_BLE (#C82E11)'],
      hops: 4,
      events: [
        { type: 'date', label: 'Groupe Maillé Sans Matériel Externe' },
        { type: 'system', time: '19:20', text: 'Bob cross-connected Alice (#A4F19B) ⇄ Charlie_BLE (#C82E11)', icon: '👥' },
        { type: 'system', time: '19:21', text: 'Mode sans LoRa actif : rebonds automatiques BLE + Wi-Fi Direct + Porteurs DTN', icon: '🔄' },
        { type: 'msg', sender: 'Alice', outgoing: false, time: '19:22', text: 'Pas besoin d’antenne externe : nos téléphones suffisent pour faire sauter les messages de poche en poche !' },
        { type: 'msg', sender: 'Charlie_BLE', outgoing: false, time: '19:24', text: 'Et si l’un d’entre nous passe près d’un Wi-Fi, son téléphone fait pont chiffré pour tout le groupe.' }
      ]
    },
    {
      id: 'alice-qr',
      name: 'Alice',
      avatar: 'AL',
      avatarBg: '#b45309',
      category: 'people',
      unread: 0,
      time: '1:12',
      preview: 'Alice: Oh, what a nice surprise!...',
      verifiedQr: true,
      fingerprint: 'A4F19B',
      rxQueue: 'q_rx_alice01',
      hops: 1,
      events: [
        { type: 'date', label: 'Mon, Apr 27' },
        { type: 'system', time: '1:10', text: 'Alice (#A4F19B) added via unique QR code & saved in contacts', icon: '👤+' },
        { type: 'msg', sender: 'Bob', outgoing: true, time: '1:12', text: 'Hey, Alice!' },
        { type: 'msg', sender: 'Alice', outgoing: false, time: '1:12', text: 'Oh, what a nice surprise! Hello to you too!' }
      ]
    },
    {
      id: 'charlie-qr',
      name: 'Charlie_BLE',
      avatar: 'CH',
      avatarBg: '#0d9488',
      category: 'people',
      unread: 0,
      time: '18:40',
      preview: 'Charlie_BLE: Prêt pour le relais multi-sauts',
      verifiedQr: true,
      fingerprint: 'C82E11',
      rxQueue: 'q_rx_charlie',
      hops: 2,
      events: [
        { type: 'date', label: 'Today' },
        { type: 'system', time: '18:39', text: 'Charlie_BLE (#C82E11) added via QR scan', icon: '▣' },
        { type: 'msg', sender: 'Charlie_BLE', outgoing: false, time: '18:40', text: 'Prêt pour le relais multi-sauts !' }
      ]
    }
  ]
};

function loadVault() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return defaultVault;
}

let vault = loadVault();
let activeRoomId = vault.rooms[0].id;
let activeCategory = 'all';

function saveVault() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
  } catch (_) {}
  renderUserHeader();
}

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

function renderUserHeader() {
  const u = vault.user;
  document.getElementById('my-avatar-box').textContent = u.alias.slice(0, 2).toUpperCase();
  document.getElementById('my-handle-label').textContent = `@${u.alias.toLowerCase()}:${u.fingerprint.toLowerCase()}`;
  document.getElementById('my-name-label').textContent = u.alias;
  document.getElementById('my-fp-short').textContent = `#${u.fingerprint}`;
}

function renderRoomList() {
  const container = document.getElementById('room-list');
  container.innerHTML = '';

  const filtered = vault.rooms.filter((r) => activeCategory === 'all' || r.category === activeCategory);
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
    row.addEventListener('click', () => selectRoom(room.id));
    container.appendChild(row);
  }

  document.getElementById('badge-people').textContent = vault.rooms.filter((r) => r.category === 'people').length;
  document.getElementById('badge-groups').textContent = vault.rooms.filter((r) => r.category === 'groups').length;
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
      <span>×</span>
    `;
    tab.addEventListener('click', () => selectRoom(room.id));
    bar.appendChild(tab);
  }
}

function renderChatStream() {
  const room = vault.rooms.find((r) => r.id === activeRoomId) || vault.rooms[0];
  if (!room) return;

  document.getElementById('active-title').textContent = room.name;
  const av = document.getElementById('active-avatar');
  av.textContent = room.avatar;
  av.style.background = room.avatarBg;

  const strip = document.getElementById('group-members-strip');
  const pills = document.getElementById('group-members-pills');

  if (room.category === 'groups') {
    document.getElementById('active-badge').textContent = `👥 ${(room.members || []).length} pairs • ${room.transport}`;
    strip.style.display = 'flex';
    pills.innerHTML = (room.members || []).map((m) => `<span class="member-pill">🔗 ${m}</span>`).join('');
  } else {
    document.getElementById('active-badge').textContent = `🔒 QR Unique #${room.fingerprint} • ${room.hops} saut(s)`;
    strip.style.display = 'none';
  }

  const stream = document.getElementById('chat-stream');
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
        <span class="room-time">${ev.time} ▤</span>
        <div class="sys-pill"><span>${ev.text}</span> <strong>${ev.icon}</strong></div>
      `;
      stream.appendChild(row);
    } else if (ev.type === 'msg') {
      const line = document.createElement('div');
      line.className = `msg-line ${ev.outgoing ? 'me' : 'peer'}`;
      if (ev.outgoing) {
        line.innerHTML = `
          <span class="room-time">▤ ✓✓ ${ev.time}</span>
          <div class="bubble me"></div>
          <div class="room-avatar" style="width:30px;height:30px;">${vault.user.alias.slice(0, 2).toUpperCase()}</div>
        `;
      } else {
        line.innerHTML = `
          <div class="room-avatar" style="width:30px;height:30px;background:${room.avatarBg}">${ev.sender.slice(0, 2).toUpperCase()}</div>
          <div class="bubble peer"></div>
          <span class="room-time">${ev.time} ▤</span>
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

document.getElementById('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const room = vault.rooms.find((r) => r.id === activeRoomId);
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  room.events.push({ type: 'msg', sender: vault.user.alias, outgoing: true, time: now, text });
  room.preview = `${vault.user.alias}: ${text}`;
  room.time = now;
  saveVault();
  renderRoomList();
  renderChatStream();
});

document.getElementById('btn-sim-hop').addEventListener('click', () => {
  const room = vault.rooms.find((r) => r.id === activeRoomId);
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sender = room.category === 'groups' ? 'Alice' : room.name;
  const text = room.category === 'groups'
    ? `Paquet relayé de téléphone en téléphone sur 4 sauts (${room.transport}) sans aucun boîtier LoRa !`
    : `Paquet direct reçu de ${room.name} (#${room.fingerprint}) via Bluetooth LE / Wi-Fi Direct !`;
  room.events.push({ type: 'msg', sender, outgoing: false, time: now, text });
  room.preview = `${sender}: ${text}`;
  room.time = now;
  saveVault();
  renderRoomList();
  renderChatStream();
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
  });
});

// --- MODAL CRÉATION DE GROUPE MESH (SANS MODULE LORA) ---
const groupModal = document.getElementById('group-modal');

function openGroupModal() {
  const picker = document.getElementById('group-contact-picker');
  picker.innerHTML = '';
  const people = vault.rooms.filter((r) => r.category === 'people');
  for (const p of people) {
    const row = document.createElement('label');
    row.className = 'saved-contact-item';
    row.innerHTML = `
      <span><input type="checkbox" value="${p.id}" checked /> <strong>${p.name}</strong></span>
      <code>#${p.fingerprint}</code>
    `;
    picker.appendChild(row);
  }
  groupModal.showModal();
}

document.getElementById('btn-nav-newgroup').addEventListener('click', openGroupModal);
document.getElementById('btn-sidebar-group').addEventListener('click', openGroupModal);
document.getElementById('btn-new-group-col2').addEventListener('click', openGroupModal);
document.getElementById('btn-top-group').addEventListener('click', openGroupModal);
document.getElementById('btn-add-peer-to-group').addEventListener('click', openGroupModal);
document.getElementById('btn-close-group').addEventListener('click', () => groupModal.close());

document.getElementById('btn-create-group-confirm').addEventListener('click', () => {
  const nameInput = document.getElementById('new-group-name');
  const name = nameInput.value.trim() || `Groupe Mesh #${randHex(2).toUpperCase()}`;
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
    preview: `${memberLabels.length} membres interconnectés (0 LoRa)`,
    verifiedQr: true,
    fingerprint: randHex(6).toUpperCase(),
    transport,
    members: memberLabels,
    hops: 4,
    events: [
      { type: 'date', label: `Groupe Maillé • ${transport}` },
      { type: 'system', time: now, text: `${vault.user.alias} a connecté ${memberLabels.join(' ⇄ ')} (100% smartphone)`, icon: '👥' }
    ]
  });

  nameInput.value = '';
  saveVault();
  groupModal.close();
  selectRoom(id);
});

// --- MODAL QR CODE UNIQUE ---
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

function openQrModal(tab = 'my-qr') {
  const u = vault.user;
  const uri = `offchat://pair?alias=${u.alias}&fp=${u.fingerprint}&q=${u.rxQueue}`;
  document.getElementById('my-uri-input').value = uri;
  document.getElementById('qr-user-name').textContent = u.alias;
  document.getElementById('qr-user-fp').textContent = `#${u.fingerprint}`;
  drawQr(uri);
  document.querySelectorAll('.modal-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('pane-my-qr').classList.toggle('active', tab === 'my-qr');
  document.getElementById('pane-scan-qr').classList.toggle('active', tab === 'scan-qr');
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
document.getElementById('btn-new-room').addEventListener('click', () => openQrModal('scan-qr'));
document.getElementById('btn-attach-qr').addEventListener('click', () => openQrModal('my-qr'));
document.getElementById('btn-close-modal').addEventListener('click', () => qrModal.close());

document.getElementById('btn-sim-scan').addEventListener('click', () => {
  const list = ['Sarah_Mesh', 'Victor_DTN', 'Elena_BLE'];
  const alias = list[Math.floor(Math.random() * list.length)];
  const fp = randHex(6).toUpperCase();
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const id = `peer-${fp}`;

  vault.rooms.unshift({
    id,
    name: alias,
    avatar: alias.slice(0, 2).toUpperCase(),
    avatarBg: '#2563eb',
    category: 'people',
    unread: 0,
    time: now,
    preview: `${alias} (#${fp}) sauvegardé`,
    verifiedQr: true,
    fingerprint: fp,
    rxQueue: `q_rx_${randHex(4)}`,
    hops: 1,
    events: [
      { type: 'date', label: 'Nouveau Contact QR' },
      { type: 'system', time: now, text: `${alias} (#${fp}) ajouté par QR & sauvegardé`, icon: '▣' }
    ]
  });
  saveVault();
  qrModal.close();
  selectRoom(id);
});

// --- MODAL PARAMÈTRES : COULEURS & SAUVEGARDE ---
const settingsModal = document.getElementById('settings-modal');

function openSettings() {
  document.getElementById('settings-alias-input').value = vault.user.alias;
  const listEl = document.getElementById('saved-contacts-list');
  listEl.innerHTML = '';
  for (const c of vault.rooms) {
    const row = document.createElement('div');
    row.className = 'saved-contact-item';
    row.innerHTML = `<span>${c.category === 'groups' ? '👥' : '👤'} <strong>${c.name}</strong> <code>#${c.fingerprint}</code></span>`;
    listEl.appendChild(row);
  }
  settingsModal.showModal();
}

document.getElementById('btn-open-theme').addEventListener('click', openSettings);
document.getElementById('btn-open-settings').addEventListener('click', openSettings);
document.getElementById('btn-nav-settings').addEventListener('click', openSettings);
document.getElementById('btn-top-theme').addEventListener('click', openSettings);
document.getElementById('btn-header-settings').addEventListener('click', openSettings);
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
  settingsModal.close();
});

document.getElementById('btn-export-json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `offchat-backup-${vault.user.fingerprint}.json`;
  a.click();
});

document.getElementById('btn-copy-json').addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(vault));
  document.getElementById('settings-status-msg').textContent = 'Sauvegarde JSON copiée ✔';
});

applyTheme(vault.theme || 'komai');
if (vault.customAccent) applyCustomAccent(vault.customAccent);
renderUserHeader();
renderRoomList();
renderTabs();
renderChatStream();
