package org.offchat.mesh;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String CHANNEL_ID = "offchat_mesh_push_channel";
    private WebView webView;
    private int notifCounter = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        requestNotificationPermissionIfNeeded();

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
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
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

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 101);
            }
        }
    }

    public class OffChatNativeBridge {
        private final Context context;

        OffChatNativeBridge(Context ctx) {
            this.context = ctx;
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
            runOnUiThread(() -> requestNotificationPermissionIfNeeded());
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
}
