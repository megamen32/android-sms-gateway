package com.userio.smsagent;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.UUID;

/** Configuration screen: server URL, device token, permissions, start/stop. */
public class MainActivity extends Activity {
    private static final int PERMISSION_REQUEST = 4711;

    private EditText urlField;
    private EditText tokenField;
    private TextView statusView;
    private TextView deviceIdView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SharedPreferences prefs = AgentService.prefs(this);
        if (prefs.getString("device_id", "").isEmpty()) {
            prefs.edit().putString("device_id", "android-" + UUID.randomUUID().toString().substring(0, 8)).apply();
        }
        setContentView(buildUi());
        applyIntentExtras(prefs);
        requestSmsPermissions();
        if (AgentService.configured(this)) startService(true);
        refreshStatus();
    }

    private LinearLayout buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        SharedPreferences prefs = AgentService.prefs(this);

        root.addView(label("Сервер (URL шлюза)"));
        urlField = new EditText(this);
        urlField.setHint("http://192.168.2.100:8788");
        urlField.setText(prefs.getString("url", ""));
        urlField.setSingleLine();
        root.addView(urlField);

        root.addView(label("Токен устройства"));
        tokenField = new EditText(this);
        tokenField.setHint("sms_dev_...");
        tokenField.setText(prefs.getString("token", ""));
        root.addView(tokenField);

        deviceIdView = new TextView(this);
        deviceIdView.setPadding(0, pad, 0, 0);
        root.addView(deviceView());

        Button save = new Button(this);
        save.setText("Сохранить и запустить");
        save.setOnClickListener(view -> {
            String url = urlField.getText().toString().trim().replaceAll("/+$", "");
            String token = tokenField.getText().toString().trim();
            if (url.isEmpty() || token.isEmpty()) {
                toast("Укажите URL и токен");
                return;
            }
            AgentService.prefs(this).edit()
                    .putString("url", url)
                    .putString("token", token)
                    .apply();
            startService(false);
            toast("Сохранено, агент запущен");
        });
        root.addView(save);

        Button permissions = new Button(this);
        permissions.setText("Разрешения SMS");
        permissions.setOnClickListener(view -> requestSmsPermissions());
        root.addView(permissions);

        Button battery = new Button(this);
        battery.setText("Отключить оптимизацию батареи");
        battery.setOnClickListener(view -> {
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception error) {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            }
        });
        root.addView(battery);

        statusView = new TextView(this);
        statusView.setPadding(0, pad, 0, 0);
        statusView.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(statusView);
        return root;
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setPadding(0, 24, 0, 4);
        return view;
    }

    private TextView deviceView() {
        deviceIdView.setText("ID устройства: " + AgentService.prefs(this).getString("device_id", ""));
        return deviceIdView;
    }

    /** adb-friendly setup: am start ... --es server_url ... --es token ... */
    private void applyIntentExtras(SharedPreferences prefs) {
        String url = getIntent().getStringExtra("server_url");
        String token = getIntent().getStringExtra("token");
        if (url != null && !url.trim().isEmpty() && token != null && !token.trim().isEmpty()) {
            prefs.edit()
                    .putString("url", url.trim().replaceAll("/+$", ""))
                    .putString("token", token.trim())
                    .apply();
            urlField.setText(url.trim().replaceAll("/+$", ""));
            tokenField.setText(token.trim());
        }
    }

    private void startService(boolean silent) {
        try {
            startForegroundService(new Intent(this, AgentService.class));
        } catch (Exception error) {
            toast("Не удалось запустить: " + error.getMessage());
        }
    }

    private void requestSmsPermissions() {
        if (Build.VERSION.SDK_INT >= 23 && (checkSelfPermission(Manifest.permission.SEND_SMS)
                != PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.RECEIVE_SMS)
                != PackageManager.PERMISSION_GRANTED)) {
            requestPermissions(new String[]{
                    Manifest.permission.SEND_SMS,
                    Manifest.permission.RECEIVE_SMS,
                    Manifest.permission.READ_SMS,
                    Manifest.permission.POST_NOTIFICATIONS,
            }, PERMISSION_REQUEST);
        }
    }

    private void refreshStatus() {
        statusView.setText(AgentService.prefs(this).getString("last_status", "статус неизвестен"));
        statusView.postDelayed(this::refreshStatus, 3000);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
