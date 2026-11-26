package com.todaytodo.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;

import java.util.ArrayList;
import java.util.WeakHashMap;

/** Delivers user-selected documents to the WebView file input that requested them. */
public final class WebFileChooser {
    private static final int REQUEST = 2444;
    private static final WeakHashMap<Activity, ValueCallback<Uri[]>> PENDING = new WeakHashMap<>();

    private WebFileChooser() {}

    public static boolean open(Activity activity, ValueCallback<Uri[]> callback,
                               WebChromeClient.FileChooserParams params) {
        if (PENDING.containsKey(activity)) {
            callback.onReceiveValue(null);
            return true;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        PENDING.put(activity, callback);
        try {
            activity.startActivityForResult(intent, REQUEST);
        } catch (RuntimeException unavailable) {
            cancel(activity);
            android.widget.Toast.makeText(activity, "无法打开系统文件选择器", android.widget.Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    public static boolean deliver(Activity activity, int request, int result, Intent data) {
        if (request != REQUEST) return false;
        ValueCallback<Uri[]> callback = PENDING.remove(activity);
        if (callback == null) return true;
        ArrayList<Uri> selected = new ArrayList<>();
        if (result == Activity.RESULT_OK && data != null) {
            select(activity, data.getData(), selected);
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < Math.min(clip.getItemCount(), 100); ++i) {
                    select(activity, clip.getItemAt(i).getUri(), selected);
                }
            }
        }
        callback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
        return true;
    }

    private static void select(Activity activity, Uri uri, ArrayList<Uri> selected) {
        if (uri == null || !"content".equals(uri.getScheme())) return;
        String authority = uri.getAuthority();
        if (authority == null || authority.equals(activity.getPackageName())
                || authority.startsWith(activity.getPackageName() + ".")) return;
        if (!selected.contains(uri)) selected.add(uri);
    }

    public static void cancel(Activity activity) {
        ValueCallback<Uri[]> callback = PENDING.remove(activity);
        if (callback != null) callback.onReceiveValue(null);
    }
}
