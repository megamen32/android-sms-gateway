package com.userio.smsagent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts the agent after reboot once it has been configured. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!AgentService.configured(context)) return;
        context.startForegroundService(new Intent(context, AgentService.class));
    }
}
