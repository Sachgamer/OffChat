# ⚡ OffChat (`v2.0.0` Production)

**OffChat** est une application de messagerie **P2P hors-ligne** inspirée de **BitChat** (maillage radio local sans données mobiles) et **SimpleX** (zéro identifiant global, appairage par QR Code unique, zéro base de données centrale).

---

## 📲 Télécharger l'APK Android directement (`v2.0.0 Production`)

👉 **[TÉLÉCHARGER OffChat-v2.0.0.apk (Lien direct depuis n'importe quel téléphone Android)](https://github.com/Sachgamer/OffChat/releases/download/v2.0.0/OffChat-v2.0.0.apk)**

*(Lien miroir depuis la branche principale : [OffChat-v2.0.0.apk](https://github.com/Sachgamer/OffChat/raw/main/OffChat-v2.0.0.apk))*

1. Ouvrez le lien ci-dessus depuis le navigateur de votre smartphone Android.
2. Appuyez sur le fichier **`OffChat-v2.0.0.apk`** téléchargé pour l'installer (*autorisez l'installation depuis votre navigateur si demandé*).
3. Au premier lancement, choisissez votre **pseudo** et votre **thème de couleur** : votre clé et votre **QR Code unique** sont générés sur votre appareil.

---

## 🚀 Nouveautés de la Version Production `v2.0.0`

- 📡 **Moteur P2P Matériel Double (Wi-Fi Direct / Hotspot UDP `:45888` + Bluetooth Low Energy GATT)** :
  - **UDP Broadcast Local (`:45888` avec `MulticastLock`)** : Deux ou plusieurs téléphones connectés au même Wi-Fi ou à un partage de connexion (même avec **0 Internet / 0 forfait mobile**) se découvrent et s'envoient des messages instantanément.
  - **Bluetooth Low Energy (BLE GATT Server + Advertiser + Scanner `0000fd70-...`)** : Échange de paquets directement en Bluetooth LE sans routeur Wi-Fi.
  - **Store-and-Forward Multi-Sauts (`TTL`)** : Chaque téléphone intermédiaire relaie automatiquement les paquets chiffrés destinés aux autres pairs.
- 🔗 **Appairage QR Code Bilatéral Automatique (`OFFCHAT_PAIR_HELLO` / `OFFCHAT_PAIR_ACK`)** :
  - Lorsqu'un téléphone scanne le QR Code d'un ami à proximité, les deux téléphones s'ajoutent mutuellement et automatiquement dans leurs contacts sans que la deuxième personne ait besoin de scanner en retour.
- 👥 **Groupes Maillés (Mesh Groups) Synchronisés en P2P (`OFFCHAT_GROUP_INVITE`)** :
  - Créez un groupe en cochant vos contacts QR : l'invitation est diffusée en P2P et le salon de groupe apparaît automatiquement sur le téléphone de chaque membre avec tous les pairs interconnectés (`Pair A ⇄ Pair B`).
- 🔐 **Chiffrement Bout-en-Bout Web Crypto API (`AES-GCM 256 bits`)** :
  - Tous les messages envoyés sur les ondes sont chiffrés en `AES-GCM` avec une clé dérivée (`SHA-256`) du secret partagé lors de l'échange du QR Code.
- 💾 **Triple Stockage Permanent Sans Base de Données Serveur** :
  - Vos contacts et l'intégralité de vos conversations sont sauvegardés simultanément dans :
    1. Le **système de fichiers interne natif Android** (`context.getFilesDir()/offchat_prod_vault.json`, insensible au nettoyage du cache WebView).
    2. La base locale **`IndexedDB`** (`OffChatPermanentDB`).
    3. Le **`localStorage`** + Export/Import `.json` en un clic dans les paramètres.
- 🔔 **Notifications Push-Up (Heads-Up)** :
  - Canal natif Android haute priorité (`IMPORTANCE_HIGH`) + bannière déroulante interactive + alerte sonore et vibration.

---

## 🌐 Faut-il un serveur de stockage des données ? (Architecture Zéro-Stockage)

**Non, vous ne devez surtout PAS stocker les conversations ou les contacts sur un serveur.**
- Comme sur **SimpleX** et **BitChat**, toute la base de données (contacts, clés, historique des messages) réside **à 100 % dans la mémoire interne de chaque téléphone** (`offchat_prod_vault.json`).
- **Avantages** : confidentialité totale (aucune métadonnée ni message stocké en ligne), zéro coût d'hébergement de base de données, aucune panne serveur possible en usage local, et zéro responsabilité RGPD.
- **Et pour discuter à très longue distance (hors portée Bluetooth/Wi-Fi) ?** Si vous souhaitez relier des téléphones situés dans des villes différentes via Internet, vous pouvez lancer le script optionnel **`relay-server.js`** inclus dans ce dépôt sur un VPS ou un Raspberry Pi : c'est un **relais WebSocket aveugle (stateless)** qui transfère uniquement les paquets chiffrés en mémoire vive (RAM) sans jamais écrire sur le disque ni utiliser de base de données.
