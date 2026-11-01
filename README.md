# OffChat (v1.0.0)

Messagerie **100 % hors-ligne** combinant le réseau maillé sans données mobiles de **BitChat**, le couplage par QR Code sans identifiant global de **SimpleX**, et l'interface 3 colonnes personnalisable de **Komai / Discord**.

## Fonctionnalités v1.0.0
* **Sans Données Mobiles & Sans Boîtier LoRa** : Relais multi-sauts de téléphone en téléphone via Bluetooth LE + Wi-Fi Direct + Porteurs Mobiles DTN (*Store-Carry-Forward*) + Pont Wi-Fi P2P.
* **QR Code Unique par Utilisateur** : Génération locale d'une empreinte cryptographique (`#8F9A2C`) et d'une file de réception (`q_rx_...`) sous le schéma `offchat://pair?...`.
* **Groupes Maillés (Mesh Groups)** : Interconnexion automatique de vos contacts QR entre eux.
* **Personnalisation des Couleurs & Sauvegarde** : 5 thèmes complets (Komai, Discord, SimpleX, Amber, Crimson), sélecteur de couleur sur mesure, et export/import `.json` de votre carnet de contacts.

## Télécharger l'APK Android (`OffChat-v1.0.0.apk`)
Le workflow [`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml) compile automatiquement l'APK Android signé et le publie dans l'onglet **Releases** (`v1.0.0`) ainsi que dans les **Artifacts** de GitHub Actions.
