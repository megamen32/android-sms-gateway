package com.userio.smsagent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.telephony.SmsManager;
import android.telephony.SmsMessage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Foreground agent: polls the gateway for tasks, sends SMS through
 * SmsManager and relays incoming SMS back. No ADB, no Termux.
 */
public class AgentService extends Service {
    static final String CHANNEL_ID = "sms_agent";
    private static final int NOTIFICATION_ID = 42;
    private static final long DEFAULT_POLL_MS = 15_000L;

    private HandlerThread workerThread;
    private Handler worker;
    private BroadcastReceiver smsReceiver;
    private String lastInboundKey = "";
    private long pollMs = DEFAULT_POLL_MS;
    private String lastStatus = "starting";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("cfg", MODE_PRIVATE);
    }

    static boolean configured(Context context) {
        SharedPreferences prefs = prefs(context);
        return !prefs.getString("url", "").isEmpty() && !prefs.getString("token", "").isEmpty();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "SMS Agent", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Задача-агент SMS-шлюза");
        manager.createNotificationChannel(channel);
        startForegroundInternal();
        workerThread = new HandlerThread("agent-poll");
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
        smsReceiver = new InboundRelay();
        IntentFilter filter = new IntentFilter("android.provider.Telephony.SMS_RECEIVED");
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(smsReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(smsReceiver, filter);
        }
        worker.post(this::helloThenLoop);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (smsReceiver != null) unregisterReceiver(smsReceiver);
        workerThread.quitSafely();
        super.onDestroy();
    }

    private void startForegroundInternal() {
        Notification notification = buildNotification("SMS Agent: запуск");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(String text) {
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle("SMS Agent")
                .setContentText(text)
                .setOngoing(true)
                .build();
    }

    private void updateStatus(String status) {
        lastStatus = status;
        prefs(this).edit().putString("last_status", status).apply();
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, buildNotification(status));
    }

    private String deviceId() {
        return prefs(this).getString("device_id", "android-unknown");
    }

    private void helloThenLoop() {
        try {
            Http.Response hello = Http.request(
                    "POST", prefs(this).getString("url", "") + "/agent/hello",
                    prefs(this).getString("token", ""),
                    new JSONObject()
                            .put("device_id", deviceId())
                            .put("model", Build.MODEL)
                            .toString());
            if (hello.status == 200) {
                long serverPoll = new JSONObject(hello.body).optLong("poll_ms", DEFAULT_POLL_MS);
                if (serverPoll >= 3000) pollMs = serverPoll;
                updateStatus("подключён, опрос каждые " + (pollMs / 1000) + " с");
            } else {
                updateStatus("hello отклонён: HTTP " + hello.status);
            }
        } catch (Exception error) {
            updateStatus("нет связи: " + error.getMessage());
        }
        pollOnce();
    }

    private void pollOnce() {
        String base = prefs(this).getString("url", "");
        String token = prefs(this).getString("token", "");
        if (base.isEmpty() || token.isEmpty()) {
            updateStatus("не настроен: откройте приложение");
            worker.postDelayed(this::pollOnce, 30_000);
            return;
        }
        try {
            Http.Response response = Http.request(
                    "GET", base + "/agent/tasks?device_id=" + deviceId(), token, null);
            if (response.status == 200) {
                JSONArray tasks = new JSONObject(response.body).optJSONArray("tasks");
                int executed = 0;
                if (tasks != null) {
                    for (int i = 0; i < tasks.length(); i++) {
                        JSONObject task = tasks.optJSONObject(i);
                        if (task == null) continue;
                        executeTask(task);
                        executed++;
                    }
                }
                if (executed == 0) {
                    updateStatus("подключён · последний опрос "
                            + java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT, Locale.getDefault())
                                    .format(new java.util.Date()));
                }
            } else {
                updateStatus("опрос отклонён: HTTP " + response.status);
            }
        } catch (Exception error) {
            updateStatus("ошибка опроса: " + error.getMessage());
        }
        worker.postDelayed(this::pollOnce, pollMs);
    }

    private void executeTask(JSONObject task) {
        String id = task.optString("id", "");
        String type = task.optString("type", "");
        try {
            if ("ping".equals(type)) {
                report(id, "ok", null);
            } else if ("send_sms".equals(type)) {
                sendSms(task.optString("to", ""), task.optString("body", ""));
                report(id, "sent", null);
            } else {
                report(id, "failed", "unknown task type: " + type);
            }
        } catch (Exception error) {
            report(id, "failed", String.valueOf(error.getMessage()));
        }
    }

    @SuppressWarnings("deprecation")
    private void sendSms(String to, String body) throws Exception {
        if (to.isEmpty() || body.isEmpty()) throw new Exception("to and body are required");
        SmsManager manager = Build.VERSION.SDK_INT >= 31
                ? getSystemService(SmsManager.class)
                : SmsManager.getDefault();
        java.util.ArrayList<String> parts = manager.divideMessage(body);
        if (parts.size() == 1) {
            manager.sendTextMessage(to, null, body, null, null);
        } else {
            manager.sendMultipartTextMessage(to, null, parts, null, null);
        }
    }

    private void report(String taskId, String status, String error) {
        try {
            JSONObject payload = new JSONObject()
                    .put("task_id", taskId)
                    .put("device_id", deviceId())
                    .put("status", status);
            if (error != null) payload.put("error", error);
            Http.request("POST", prefs(this).getString("url", "") + "/agent/results",
                    prefs(this).getString("token", ""), payload.toString());
        } catch (Exception ignored) {
            // Result reporting is best-effort; the next poll keeps the loop alive.
        }
    }

    /** Pushes every incoming SMS to the gateway so UserIO can read it. */
    private class InboundRelay extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            SmsMessage[] messages = android.provider.Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (messages == null || messages.length == 0) return;
            StringBuilder body = new StringBuilder();
            String from = "";
            long timestamp = System.currentTimeMillis();
            for (SmsMessage message : messages) {
                if (message == null) continue;
                from = message.getOriginatingAddress() == null ? from : message.getOriginatingAddress();
                body.append(message.getDisplayMessageBody() == null ? "" : message.getDisplayMessageBody());
                if (message.getTimestampMillis() > 0) timestamp = message.getTimestampMillis();
            }
            if (from.isEmpty() || body.length() == 0) return;
            String key = from + ":" + timestamp + ":" + body;
            if (key.equals(lastInboundKey)) return;
            lastInboundKey = key;
            final String payload;
            try {
                if (!from.startsWith("+")) from = normalize(from);
                payload = new JSONObject()
                        .put("device_id", deviceId())
                        .put("from", from)
                        .put("body", body.toString())
                        .put("received_at", timestamp)
                        .toString();
            } catch (Exception ignored) {
                return;
            }
            new Thread(() -> {
                try {
                    Http.request("POST", prefs(AgentService.this).getString("url", "") + "/agent/inbound",
                            prefs(AgentService.this).getString("token", ""), payload);
                } catch (Exception ignored) {
                    // Inbound relay is best-effort.
                }
            }).start();
        }

        private String normalize(String address) {
            String digits = address.replaceAll("[^0-9]", "");
            return digits.isEmpty() ? address : "+" + digits;
        }
    }
}
