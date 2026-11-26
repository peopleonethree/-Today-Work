package com.todaytodo.app;
import android.app.*;
import android.content.*;
import android.media.*;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;

/** Stable notification identity; the foreground service owns app-selected audio. */
public final class AppRingtoneChannel {
    public static final String DUE = "todo_due_app_playback";
    static final String PREFS = "today_todo_settings";
    public static String dueChannelId(Context c) { ensureChannels(c); return DUE; }
    public static synchronized void ensureChannels(Context c) {
        NotificationManager m=c.getSystemService(NotificationManager.class);
        if(m==null) return;
        if(m.getNotificationChannel("todo_reminder")==null) {
            NotificationChannel early=new NotificationChannel("todo_reminder","待办提醒",4);
            early.enableVibration(true); early.setVibrationPattern(new long[]{0,120,90,120});
            early.setSound(Settings.System.DEFAULT_NOTIFICATION_URI,new AudioAttributes.Builder().setUsage(5).setContentType(4).build());
            m.createNotificationChannel(early);
        }
        if(m.getNotificationChannel(DUE)==null) {
            SharedPreferences prefs=c.getSharedPreferences(PREFS,0);
            NotificationChannel old=m.getNotificationChannel(prefs.getString("app_sound_channel","todo_due_v"+prefs.getInt("due_channel_gen",1)));
            NotificationChannel channel=new NotificationChannel(DUE,"到点提醒",old==null?4:old.getImportance());
            channel.setDescription("到点通知；提醒音频由应用内铃声和响铃开关控制");
            channel.setSound(null,null);
            channel.enableVibration(old==null || old.shouldVibrate());
            channel.setVibrationPattern(new long[]{0,300,180,300});
            m.createNotificationChannel(channel);
        }
        // Create replacement first; never remove unrelated notification categories.
        for(NotificationChannel old:m.getNotificationChannels()) {
            String id=old.getId();
            if(id.startsWith("todo_due_v") || id.startsWith("todo_app_sound_")) {
                m.deleteNotificationChannel(id);
                Log.i("AppRingtoneChannel","Removed legacy channel="+id);
            }
        }
        c.getSharedPreferences(PREFS,0).edit().putString("app_sound_channel",DUE).apply();
    }
    public static void setEnabled(Context c,boolean enabled) {
        c.getSharedPreferences(PREFS,0).edit().putBoolean("ring_enabled",enabled).apply();
        if(!enabled) stop(c);
    }
    public static void stop(Context c) { c.stopService(new Intent(c,AlarmRingtoneService.class)); }
    static Uri selected(Context c) {
        String value=c.getSharedPreferences(PREFS,0).getString("ring_uri","");
        return value==null || value.isEmpty()?defaultSound(c):Uri.parse(value);
    }
    static Uri defaultSound(Context c) {
        for(int type:new int[]{4,1,2}) {
            Uri uri=RingtoneManager.getActualDefaultRingtoneUri(c,type);
            if(uri!=null) return uri;
        }
        return Settings.System.DEFAULT_ALARM_ALERT_URI;
    }
    /** Existing receiver already removed the alarm from its plan and checked foreground. */
    public static boolean handleDue(Context c,Intent intent) {
        if(intent==null || intent.getIntExtra("offset",0)>0) return false;
        int rc=intent.getIntExtra("rc",-1);
        if(rc<0) return true;
        ensureChannels(c);
        NotificationManager m=c.getSystemService(NotificationManager.class);
        NotificationChannel channel=m.getNotificationChannel(DUE);
        if(!m.areNotificationsEnabled() || channel==null || channel.getImportance()==0) {
            Log.i("AlarmRingtone","Suppressed: notifications disabled rc="+rc); return true;
        }
        m.notify(rc,AlarmRingtoneService.notification(c,intent,false));
        boolean enabled=c.getSharedPreferences(PREFS,0).getBoolean("ring_enabled",true);
        if(!enabled || !allowsAlarm(m)) {
            Log.i("AlarmRingtone","Notification only: ringEnabled="+enabled+" rc="+rc); return true;
        }
        try {
            c.startForegroundService(new Intent(c,AlarmRingtoneService.class).putExtras(intent));
            Log.i("AlarmRingtone","Service requested rc="+rc);
        } catch(RuntimeException error) { Log.e("AlarmRingtone","Cannot start playback rc="+rc,error); }
        return true;
    }
    static boolean allowsAlarm(NotificationManager m) {
        int filter=m.getCurrentInterruptionFilter();
        if(filter==NotificationManager.INTERRUPTION_FILTER_NONE) return false;
        if(filter==NotificationManager.INTERRUPTION_FILTER_PRIORITY) {
            try { return (m.getNotificationPolicy().priorityCategories & NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS)!=0; }
            catch(SecurityException e) { return false; }
        }
        return true;
    }
}
