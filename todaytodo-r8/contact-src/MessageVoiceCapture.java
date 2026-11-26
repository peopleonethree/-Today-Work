package com.todaytodo.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

final class MessageVoiceCapture {
    private static final int RATE = 16000;
    private static final int LIMIT = RATE * 2 * 15;
    private static Capture current;

    private MessageVoiceCapture() {}

    static synchronized boolean start(Activity owner) {
        if (current != null || owner.isFinishing() || owner.isDestroyed()
                || owner.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        int format = AudioFormat.ENCODING_PCM_16BIT;
        int channels = AudioFormat.CHANNEL_IN_MONO;
        int minimum = AudioRecord.getMinBufferSize(RATE, channels, format);
        if (minimum <= 0) return false;
        AudioRecord microphone = null;
        try {
            microphone = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE, channels, format, minimum * 2);
            if (microphone.getState() != AudioRecord.STATE_INITIALIZED) {
                microphone.release();
                return false;
            }
            microphone.startRecording();
            Capture capture = new Capture(owner, microphone);
            capture.thread.start();
            current = capture;
            return true;
        } catch (RuntimeException error) {
            if (microphone != null) microphone.release();
            return false;
        }
    }

    static synchronized String stop(Activity owner) {
        if (current == null || current.owner != owner) return "";
        Capture capture = current;
        current = null;
        capture.end();
        try {
            capture.thread.join(1200);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return "";
        }
        if (capture.thread.isAlive()) return "";
        byte[] pcm = capture.output.toByteArray();
        if (pcm.length == 0) return "";
        ByteBuffer wav = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length)
                .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16)
                .putShort((short) 1).putShort((short) 1).putInt(RATE).putInt(RATE * 2)
                .putShort((short) 2).putShort((short) 16)
                .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length).put(pcm);
        return "data:audio/wav;base64," + Base64.encodeToString(wav.array(), Base64.NO_WRAP);
    }

    static synchronized void cancel(Activity owner) {
        if (current != null && current.owner == owner) {
            current.end();
            current = null;
        }
    }

    private static final class Capture implements Runnable {
        final Activity owner;
        final AudioRecord microphone;
        final Thread thread;
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        volatile boolean active = true;

        Capture(Activity owner, AudioRecord microphone) {
            this.owner = owner;
            this.microphone = microphone;
            thread = new Thread(this, "TodayTodoMessageWav");
        }

        synchronized void end() {
            if (!active) return;
            active = false;
            try { microphone.stop(); } catch (IllegalStateException ignored) {}
        }

        @Override public void run() {
            byte[] buffer = new byte[3200];
            try {
                while (active && output.size() < LIMIT) {
                    int count = microphone.read(buffer, 0, Math.min(buffer.length, LIMIT - output.size()));
                    if (count <= 0) break;
                    output.write(buffer, 0, count & ~1);
                }
            } finally {
                end();
                microphone.release();
            }
        }
    }
}
