package com.todaytodo.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public final class MessageAudioProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    static boolean validName(String name) {
        return name != null && name.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.wav");
    }
    private File file(Uri uri) {
        if (uri.getPathSegments().size() != 1 || !validName(uri.getLastPathSegment())) return null;
        return new File(new File(getContext().getCacheDir(), "prepared-message-audio"), uri.getLastPathSegment());
    }
    @Override public String getType(Uri uri) { return file(uri) == null ? null : "audio/wav"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = file(uri);
        if (!"r".equals(mode) || file == null || !file.isFile()) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        if (projection == null) projection = new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(projection);
        File file = file(uri);
        if (file == null || !file.isFile()) return cursor;
        Object[] values = new Object[projection.length];
        for (int i = 0; i < projection.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(projection[i])) values[i] = "TodayTodo-voice.wav";
            else if (OpenableColumns.SIZE.equals(projection[i])) values[i] = file.length();
        }
        cursor.addRow(values);
        return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
