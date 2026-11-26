package com.todaytodo.app;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.util.Log;

/** Bounded, user-visible playback survives a cold background alarm delivery. */
public final class AlarmRingtoneService extends Service {
    private static final String TAG="AlarmRingtone";
    private final Handler handler=new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private int currentId;
    private Intent currentIntent;
    private final Runnable timeout=()->finish("timeout");
    public IBinder onBind(Intent intent) { return null; }
    static Notification notification(Context c,Intent source,boolean playing) {
        int rc=source.getIntExtra("rc",1);
        Intent open=c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent content=PendingIntent.getActivity(c,rc,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        String text=source.getStringExtra("text");
        Notification.Builder b=new Notification.Builder(c,AppRingtoneChannel.DUE)
            .setSmallIcon(c.getResources().getIdentifier("ic_notify","drawable",c.getPackageName()))
            .setContentTitle("到点了"+(text==null||text.isEmpty()?"":"："+text))
            .setContentText(playing?"正在播放应用所选铃声 · 最长10秒":"今日待办 · 提醒时间已到")
            .setContentIntent(content).setCategory(Notification.CATEGORY_ALARM)
            .setAutoCancel(!playing).setOnlyAlertOnce(true).setShowWhen(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE);
        if(playing) {
            PendingIntent stop=PendingIntent.getService(c,rc,new Intent(c,AlarmRingtoneService.class).setAction("STOP"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            b.addAction(new Notification.Action.Builder(null,"停止响铃",stop).build());
        }
        return b.build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent==null) { stopSelf(); return START_NOT_STICKY; }
        if("STOP".equals(intent.getAction())) { finish("user stop"); return START_NOT_STICKY; }
        int id=intent.getIntExtra("rc",1);
        if(currentIntent!=null && id==currentId && player!=null) return START_NOT_STICKY;
        release();
        if(currentIntent!=null) getSystemService(NotificationManager.class).notify(currentId,notification(this,currentIntent,false));
        currentId=id; currentIntent=new Intent(intent);
        try {
            startForeground(currentId,notification(this,intent,true),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            NotificationManager m=getSystemService(NotificationManager.class);
            if(!getSharedPreferences(AppRingtoneChannel.PREFS,0).getBoolean("ring_enabled",true)
                || !m.areNotificationsEnabled() || !AppRingtoneChannel.allowsAlarm(m)) {
                finish("disabled"); return START_NOT_STICKY;
            }
            audio=getSystemService(AudioManager.class);
            AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(change->{if(change<0)finish("audio focus lost");},handler).build();
            if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { finish("audio focus denied"); return START_NOT_STICKY; }
            Uri uri=AppRingtoneChannel.selected(this);
            Log.i(TAG,"Preparing rc="+currentId+" uri="+uri+" alarmVolume="+audio.getStreamVolume(AudioManager.STREAM_ALARM));
            player=new MediaPlayer(); player.setAudioAttributes(attributes);
            player.setWakeMode(this,PowerManager.PARTIAL_WAKE_LOCK); player.setDataSource(this,uri);
            player.setOnPreparedListener(media->{if(media==player){media.start();Log.i(TAG,"Playback started rc="+currentId+" uri="+uri);}});
            player.setOnCompletionListener(media->finish("completed"));
            player.setOnErrorListener((media,what,extra)->{Log.e(TAG,"Playback error what="+what+" extra="+extra);finish("error");return true;});
            handler.postDelayed(timeout,10000); player.prepareAsync();
        } catch(Exception error) { Log.e(TAG,"Playback failed rc="+currentId,error); finish("exception"); }
        return START_NOT_STICKY;
    }
    private void finish(String reason) {
        Log.i(TAG,"Playback finished rc="+currentId+" reason="+reason);
        release(); stopForeground(STOP_FOREGROUND_DETACH);
        if(currentIntent!=null) {
            try { getSystemService(NotificationManager.class).notify(currentId,notification(this,currentIntent,false)); }
            catch(RuntimeException e) { Log.w(TAG,"Could not retain reminder",e); }
        }
        currentIntent=null; stopSelf();
    }
    private void release() {
        handler.removeCallbacks(timeout);
        if(player!=null){MediaPlayer old=player;player=null;old.release();}
        if(audio!=null&&focus!=null) audio.abandonAudioFocusRequest(focus);
        focus=null;
    }
    @Override public void onDestroy() {
        release(); stopForeground(STOP_FOREGROUND_DETACH);
        if(currentIntent!=null) {
            try { getSystemService(NotificationManager.class).notify(currentId,notification(this,currentIntent,false)); }
            catch(RuntimeException ignored) { }
        }
        super.onDestroy();
    }
}
