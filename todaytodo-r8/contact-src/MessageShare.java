package com.todaytodo.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.UUID;

public final class MessageShare {
    private static final String WAV = "data:audio/wav;base64,";
    private static final int MAX_BYTES = 512 * 1024;

    public static boolean open(Activity activity, String platform, String text, String dataUrl) {
        String target;
        if ("qq".equals(platform)) target = "com.tencent.mobileqq";
        else if ("wechat".equals(platform)) target = "com.tencent.mm";
        else return false;
        if (text == null || text.length() > 4000 || dataUrl == null) return false;
        if (dataUrl.isEmpty() && text.trim().isEmpty()) return false;
        if (!dataUrl.isEmpty() && (!dataUrl.startsWith(WAV) || dataUrl.length() > MAX_BYTES * 4 / 3 + 100)) {
            return false;
        }
        if (activity.isFinishing() || activity.isDestroyed()) return false;
        new Thread(() -> {
            Intent intent = new Intent(Intent.ACTION_SEND).setPackage(target).setType("text/plain");
            if (!text.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text);
            if (!dataUrl.isEmpty()) {
                try {
                    byte[] wav = Base64.decode(dataUrl.substring(WAV.length()), Base64.DEFAULT);
                    if (wav.length < 44 || wav.length > MAX_BYTES || wav[0] != 'R' || wav[1] != 'I'
                        || wav[2] != 'F' || wav[3] != 'F' || wav[8] != 'W' || wav[9] != 'A'
                        || wav[10] != 'V' || wav[11] != 'E') throw new IOException("Not WAV");
                    File directory = new File(activity.getCacheDir(), "prepared-message-audio");
                    if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory())
                        throw new IOException("Cannot make share cache");
                    File[] files = directory.listFiles();
                    long cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
                    if (files != null) for (File file : files) {
                        if (MessageAudioProvider.validName(file.getName()) && file.lastModified() < cutoff) file.delete();
                    }
                    File file = new File(directory, UUID.randomUUID().toString() + ".wav");
                    try (FileOutputStream output = new FileOutputStream(file)) { output.write(wav); }
                    Uri uri = new Uri.Builder().scheme("content").authority(activity.getPackageName() + ".messageaudio")
                        .appendPath(file.getName()).build();
                    intent.setType("audio/wav").putExtra(Intent.EXTRA_STREAM, uri);
                    intent.setClipData(ClipData.newRawUri("消息录音", uri));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (IOException | RuntimeException error) {
                    notify(activity, "录音文件无法分享，请重新录制");
                    return;
                }
            }
            activity.runOnUiThread(() -> {
                if (activity.isFinishing() || activity.isDestroyed()) return;
                try { activity.startActivity(intent); }
                catch (RuntimeException error) {
                    Toast.makeText(activity, "客户端未安装或不支持本次分享", Toast.LENGTH_LONG).show();
                }
            });
        }, "message-share").start();
        return true;
    }

    private static void notify(Activity activity, String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }
}
