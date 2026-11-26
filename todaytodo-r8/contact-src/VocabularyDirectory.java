package com.todaytodo.app;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Device-local copies of selected phone contacts and launch events. */
public final class VocabularyDirectory {
    private VocabularyDirectory() {}

    private static AtomicFile file(Context context, String key) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "directory-" + key + ".json"));
    }

    static synchronized JSONArray read(Context context, String key) throws IOException, JSONException {
        try {
            return new JSONArray(new String(file(context, key).readFully(), StandardCharsets.UTF_8));
        } catch (FileNotFoundException missing) {
            return new JSONArray();
        }
    }

    static synchronized void write(Context context, String key, JSONArray entries) throws IOException {
        AtomicFile file = file(context, key);
        FileOutputStream output = file.startWrite();
        try {
            output.write(entries.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (IOException | RuntimeException failure) {
            file.failWrite(output);
            throw failure;
        }
    }

    static synchronized void logLaunch(Context context, String name, String channel, String number)
            throws IOException, JSONException {
        JSONArray previous = read(context, "launches");
        JSONArray next = new JSONArray().put(new JSONObject()
            .put("name", name).put("channel", channel).put("number", number)
            .put("when", System.currentTimeMillis()).put("origin", "launch")
            .put("result", "手机".equals(channel) ? "已打开拨号盘" : "已打开客户端"));
        for (int i = 0; i < Math.min(previous.length(), 499); i++) next.put(previous.get(i));
        write(context, "launches", next);
    }
}
