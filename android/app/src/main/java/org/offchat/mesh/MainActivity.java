package org.offchat.mesh;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelUuid;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String CHANNEL_ID = "offchat_mesh_push_channel";
    private static final String VAULT_FILENAME = "offchat_prod_vault.json";
    private static final int UDP_MESH_PORT = 45888;
    private static final UUID SERVICE_UUID = UUID.fromString("0000fd70-0000-1000-8000-00805f9b34fb");
    private static final UUID CHAR_PACKET_UUID = UUID.fromString("0000fd71-0000-1000-8000-00805f9b34fb");

    private WebView webView;
    private int notifCounter = 1001;
    private volatile boolean meshRunning = false;
    private DatagramSocket udpSocket;
    private WifiManager.MulticastLock multicastLock;

    private BluetoothManager btManager;
    private BluetoothAdapter btAdapter;
    private BluetoothLeAdvertiser bleAdvertiser;
    private BluetoothLeScanner bleScanner;
    private BluetoothGattServer gattServer;
    private BluetoothGattCharacteristic packetCharacteristic;

    private final Set<String> discoveredBleAddresses = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Set<String> seenPacketIds = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final ExecutorService ioPool = Executors.newCachedThreadPool();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        requestAllMeshPermissions();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new OffChatNativeBridge(this), "OffChatNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                startMeshTransports();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void requestAllMeshPermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            perms.add("android.permission.POST_NOTIFICATIONS");
            perms.add("android.permission.NEARBY_WIFI_DEVICES");
        }
        if (Build.VERSION.SDK_INT >= 31) {
            perms.add("android.permission.BLUETOOTH_SCAN");
            perms.add("android.permission.BLUETOOTH_ADVERTISE");
            perms.add("android.permission.BLUETOOTH_CONNECT");
        } else {
            perms.add("android.permission.ACCESS_FINE_LOCATION");
        }
        perms.add("android.permission.CAMERA");

        List<String> needed = new ArrayList<>();
        for (String p : perms) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                needed.add(p);
            }
        }
        if (!needed.isEmpty()) {
            requestPermissions(needed.toArray(new String[0]), 200);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        startMeshTransports();
    }

    private synchronized void startMeshTransports() {
        if (!meshRunning) {
            meshRunning = true;
            startUdpBroadcastEngine();
        }
        startBleGattMeshEngine();
    }

    // --- 1. MOTEUR RADIO UDP WI-FI LOCAL / HOTSPOT P2P (SANS INTERNET) ---
    private void startUdpBroadcastEngine() {
        ioPool.execute(() -> {
            try {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    multicastLock = wifi.createMulticastLock("offchat_udp_lock");
                    multicastLock.setReferenceCounted(true);
                    multicastLock.acquire();
                }
                udpSocket = new DatagramSocket(UDP_MESH_PORT);
                udpSocket.setBroadcast(true);
                byte[] buf = new byte[8192];
                while (meshRunning) {
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    udpSocket.receive(packet);
                    String json = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                    deliverPacketToJs(json, "WIFI_UDP");
                }
            } catch (Exception ignored) {
            }
        });
    }

    private void broadcastUdpPacket(String jsonPayload) {
        ioPool.execute(() -> {
            try {
                byte[] data = jsonPayload.getBytes(StandardCharsets.UTF_8);
                DatagramSocket sender = (udpSocket != null && !udpSocket.isClosed()) ? udpSocket : new DatagramSocket();
                sender.setBroadcast(true);
                InetAddress broadcastAddr = InetAddress.getByName("255.255.255.255");
                DatagramPacket pkt = new DatagramPacket(data, data.length, broadcastAddr, UDP_MESH_PORT);
                sender.send(pkt);
            } catch (Exception ignored) {
            }
        });
    }

    // --- 2. MOTEUR BLUETOOTH LOW ENERGY (BLE MESH GATT SERVER + SCANNER) ---
    private void startBleGattMeshEngine() {
        try {
            btManager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            if (btManager == null) return;
            btAdapter = btManager.getAdapter();
            if (btAdapter == null || !btAdapter.isEnabled()) return;

            if (gattServer == null) {
                gattServer = btManager.openGattServer(this, new BluetoothGattServerCallback() {
                    @Override
                    public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
                                                             BluetoothGattCharacteristic characteristic,
                                                             boolean preparedWrite, boolean responseNeeded,
                                                             int offset, byte[] value) {
                        if (responseNeeded && gattServer != null) {
                            gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
                        }
                        if (value != null && value.length > 0) {
                            String json = new String(value, StandardCharsets.UTF_8);
                            deliverPacketToJs(json, "BLE_MESH");
                        }
                    }
                });

                if (gattServer != null) {
                    BluetoothGattService service = new BluetoothGattService(
                        SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY
                    );
                    packetCharacteristic = new BluetoothGattCharacteristic(
                        CHAR_PACKET_UUID,
                        BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE | BluetoothGattCharacteristic.PROPERTY_READ,
                        BluetoothGattCharacteristic.PERMISSION_WRITE | BluetoothGattCharacteristic.PERMISSION_READ
                    );
                    service.addCharacteristic(packetCharacteristic);
                    gattServer.addService(service);
                }
            }

            // Advertising BLE
            bleAdvertiser = btAdapter.getBluetoothLeAdvertiser();
            if (bleAdvertiser != null) {
                AdvertiseSettings settings = new AdvertiseSettings.Builder()
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setConnectable(true)
                    .setTimeout(0)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                    .build();
                AdvertiseData data = new AdvertiseData.Builder()
                    .setIncludeDeviceName(false)
                    .addServiceUuid(new ParcelUuid(SERVICE_UUID))
                    .build();
                bleAdvertiser.startAdvertising(settings, data, new AdvertiseCallback() {});
            }

            // Scanning BLE
            bleScanner = btAdapter.getBluetoothLeScanner();
            if (bleScanner != null) {
                ScanFilter filter = new ScanFilter.Builder()
                    .setServiceUuid(new ParcelUuid(SERVICE_UUID))
                    .build();
                ScanSettings scanSettings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .build();
                bleScanner.startScan(Collections.singletonList(filter), scanSettings, new ScanCallback() {
                    @Override
                    public void onScanResult(int callbackType, ScanResult result) {
                        if (result != null && result.getDevice() != null) {
                            String addr = result.getDevice().getAddress();
                            if (addr != null && discoveredBleAddresses.add(addr)) {
                                notifyPeerCountToJs();
                            }
                        }
                    }
                });
            }
        } catch (SecurityException ignored) {
        } catch (Exception ignored) {
        }
    }

    private void forwardBlePacketToDiscoveredPeers(String jsonPayload) {
        if (btAdapter == null || discoveredBleAddresses.isEmpty()) return;
        byte[] bytes = jsonPayload.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 500) return;

        for (String address : discoveredBleAddresses) {
            ioPool.execute(() -> {
                try {
                    BluetoothDevice device = btAdapter.getRemoteDevice(address);
                    device.connectGatt(MainActivity.this, false, new BluetoothGattCallback() {
                        @Override
                        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                            if (newState == BluetoothGatt.STATE_CONNECTED) {
                                gatt.requestMtu(512);
                            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                                gatt.close();
                            }
                        }

                        @Override
                        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                            gatt.discoverServices();
                        }

                        @Override
                        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                            BluetoothGattService svc = gatt.getService(SERVICE_UUID);
                            if (svc != null) {
                                BluetoothGattCharacteristic ch = svc.getCharacteristic(CHAR_PACKET_UUID);
                                if (ch != null) {
                                    ch.setValue(bytes);
                                    gatt.writeCharacteristic(ch);
                                }
                            }
                        }

                        @Override
                        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                            gatt.disconnect();
                        }
                    });
                } catch (Exception ignored) {
                }
            });
        }
    }

    private void notifyPeerCountToJs() {
        final int count = discoveredBleAddresses.size();
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("window.onNativePeerCount && window.onNativePeerCount(" + count + ");", null);
            }
        });
    }

    private void deliverPacketToJs(String jsonPayload, String transport) {
        String b64 = Base64.encodeToString(jsonPayload.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                    "window.onNativeMeshPacket && window.onNativeMeshPacket('" + b64 + "', '" + transport + "');",
                    null
                );
            }
        });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "OffChat Messages & Relais Mesh",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifications push-up locales pour les messages hors-ligne et ajouts QR");
            channel.enableVibration(true);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    // --- PONT JAVASCRIPT NATIF (RADIO MESH + STOCKAGE FICHIER PERMANENT + PUSH-UP) ---
    public class OffChatNativeBridge {
        private final Context context;

        OffChatNativeBridge(Context ctx) {
            this.context = ctx;
        }

        @JavascriptInterface
        public void broadcastMeshPacket(String jsonPayload) {
            broadcastUdpPacket(jsonPayload);
            forwardBlePacketToDiscoveredPeers(jsonPayload);
        }

        @JavascriptInterface
        public int getDiscoveredBleCount() {
            return discoveredBleAddresses.size();
        }

        @JavascriptInterface
        public void saveVaultToFile(String jsonContent) {
            try {
                File file = new File(context.getFilesDir(), VAULT_FILENAME);
                try (FileOutputStream fos = new FileOutputStream(file, false)) {
                    fos.write(jsonContent.getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String loadVaultFromFile() {
            try {
                File file = new File(context.getFilesDir(), VAULT_FILENAME);
                if (!file.exists()) return "";
                byte[] bytes = new byte[(int) file.length()];
                try (FileInputStream fis = new FileInputStream(file)) {
                    int read = fis.read(bytes);
                    if (read > 0) {
                        return new String(bytes, 0, read, StandardCharsets.UTF_8);
                    }
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        @JavascriptInterface
        public void showPushNotification(String title, String message) {
            try {
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager == null) return;

                Intent intent = new Intent(context, MainActivity.class);
                intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
                PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);

                Notification.Builder builder;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    builder = new Notification.Builder(context, CHANNEL_ID);
                } else {
                    builder = new Notification.Builder(context);
                    builder.setPriority(Notification.PRIORITY_HIGH);
                }

                builder.setSmallIcon(android.R.drawable.stat_notify_chat)
                       .setContentTitle(title)
                       .setContentText(message)
                       .setAutoCancel(true)
                       .setContentIntent(pendingIntent);

                manager.notify(notifCounter++, builder.build());
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(() -> requestAllMeshPermissions());
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        meshRunning = false;
        if (udpSocket != null) udpSocket.close();
        if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        super.onDestroy();
    }
}
