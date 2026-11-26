package com.todaytodo.app;

import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class DesktopRelay {
    private DesktopRelay() {}

    public static int enqueue(String code, String request) {
        if (code == null || !code.matches("[0-9a-fA-F]{32}") || request == null) return 400;
        byte[] bytes = request.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 750000) return 413;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:38471/jobs").openConnection(Proxy.NO_PROXY);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(2500);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Authorization", "Bearer " + code.toLowerCase(java.util.Locale.ROOT));
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (java.io.OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
            return connection.getResponseCode();
        } catch (java.io.IOException e) {
            return 0;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
