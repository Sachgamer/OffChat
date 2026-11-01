#!/usr/bin/env bash
set -euo pipefail

JDK_BIN="/home/sachgamer/.gemini/antigravity/scratch/android-toolchain/jdk/bin"
BUILD_TOOLS="/home/sachgamer/.gemini/antigravity/scratch/android-toolchain/sdk/build-tools/34.0.0"
ANDROID_JAR="/home/sachgamer/.gemini/antigravity/scratch/android-toolchain/sdk/platforms/android-34/android.jar"

export JAVA_HOME="/home/sachgamer/.gemini/antigravity/scratch/android-toolchain/jdk"
export PATH="$JDK_BIN:$BUILD_TOOLS:$PATH"

PROJECT_DIR="/home/sachgamer/.gemini/antigravity/scratch/OffChat"
BUILD_DIR="$PROJECT_DIR/build-apk"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$BUILD_DIR/assets/www"

# 1. Copier les fichiers Web de l'application dans les assets Android
cp "$PROJECT_DIR/index.html" "$PROJECT_DIR/style.css" "$PROJECT_DIR/app.js" "$BUILD_DIR/assets/www/"

# 2. Compiler MainActivity.java en bytecode Java 11 compatible d8
"$JDK_BIN/javac" --release 11 \
  -cp "$ANDROID_JAR" \
  -d "$BUILD_DIR/classes" \
  "$PROJECT_DIR/android/app/src/main/java/org/offchat/mesh/MainActivity.java"

# 3. Convertir les classes Java en Dalvik Executable (classes.dex) avec d8
"$BUILD_TOOLS/d8" \
  --lib "$ANDROID_JAR" \
  --min-api 24 \
  --output "$BUILD_DIR/dex" \
  "$BUILD_DIR/classes/org/offchat/mesh/MainActivity.class" \
  "$BUILD_DIR/classes/org/offchat/mesh/MainActivity\$1.class"

# 4. Packager le manifeste et les assets avec aapt2
"$BUILD_TOOLS/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$PROJECT_DIR/android/app/src/main/AndroidManifest.xml" \
  -A "$BUILD_DIR/assets" \
  -o "$BUILD_DIR/unaligned.apk"

# 5. Ajouter classes.dex à la racine de l'APK
(cd "$BUILD_DIR/dex" && zip -q "$BUILD_DIR/unaligned.apk" classes.dex)

# 6. Aligner l'APK sur 4 octets avec zipalign
"$BUILD_TOOLS/zipalign" -f -p 4 "$BUILD_DIR/unaligned.apk" "$BUILD_DIR/aligned.apk"

# 7. Générer une clé de signature Android v1/v2/v3 et signer l'APK
"$JDK_BIN/keytool" -genkeypair \
  -keystore "$BUILD_DIR/release.keystore" \
  -storepass offchat123 \
  -keypass offchat123 \
  -alias offchat \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=OffChat Mesh, O=OffChat, C=FR"

"$BUILD_TOOLS/apksigner" sign \
  --ks "$BUILD_DIR/release.keystore" \
  --ks-pass pass:offchat123 \
  --key-pass pass:offchat123 \
  --out "$PROJECT_DIR/OffChat-v1.0.0.apk" \
  "$BUILD_DIR/aligned.apk"

"$BUILD_TOOLS/apksigner" verify --verbose "$PROJECT_DIR/OffChat-v1.0.0.apk"
rm -rf "$BUILD_DIR"
ls -lh "$PROJECT_DIR/OffChat-v1.0.0.apk"
