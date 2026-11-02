/**
 * OffChat v2.0 — Relais WebSocket Aveugle (Zero-Storage / Sans Base de Données)
 *
 * Philosophie SimpleX / BitChat :
 * - AUCUNE base de données, AUCUN fichier écrit sur le disque, AUCUN compte utilisateur.
 * - Ce relais ne sert que de "pont radio virtuel" en mémoire vive (RAM) pour connecter deux
 *   smartphones OffChat très éloignés (hors de portée Bluetooth LE / Wi-Fi Direct).
 * - Les paquets qui transitent sont chiffrés de bout en bout (AES-GCM 256 bits) avec la clé
 *   issue du QR Code échangé entre les deux utilisateurs.
 *
 * Lancement :
 *   npm install ws
 *   node relay-server.js
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// Buffer éphémère en RAM uniquement (max 100 derniers paquets chiffrés pour le Store-and-Forward court)
const ephemeralRamBuffer = [];
const MAX_RAM_PACKETS = 100;

wss.on('connection', (ws) => {
  // À la connexion d'un pair, lui délivrer les paquets chiffrés récents en attente en RAM
  for (const rawPacket of ephemeralRamBuffer) {
    if (ws.readyState === 1) {
      ws.send(rawPacket);
    }
  }

  ws.on('message', (data) => {
    const rawPacket = data.toString();

    // Garder uniquement en RAM éphémère (0 écriture disque, 0 base de données)
    ephemeralRamBuffer.push(rawPacket);
    if (ephemeralRamBuffer.length > MAX_RAM_PACKETS) {
      ephemeralRamBuffer.shift();
    }

    // Relayer immédiatement à tous les autres pairs connectés
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(rawPacket);
      }
    }
  });
});

console.log(`[OffChat Blind Relay v2.0] Actif sur ws://0.0.0.0:${PORT} (0 Base de données • 100% RAM éphémère)`);
