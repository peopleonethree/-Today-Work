package com.todaytodo.app;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

final class PhoneImportRules {
    enum Reason {
        PERSONAL("普通号码"), CARRIER("运营商服务或营销号"), SERVICE("400 / 800 企业服务号"),
        SERVICE_10("10 开头服务类号码"),
        TAGGED("通讯录已标注诈骗或骚扰"), PUBLIC("反诈预警或公共服务号"), UNKNOWN("号码需核对");
        final String label;
        Reason(String label) { this.label = label; }
    }

    private static final Set<String> CARRIER_NUMBERS = new HashSet<>(Arrays.asList(
        "10000", "10001", "10010", "10016", "10085", "10086", "10088", "10099", "96766"));
    private static final Set<String> PUBLIC_NUMBERS = new HashSet<>(Arrays.asList(
        "110", "119", "120", "122", "96110", "12381"));
    private static final Pattern RISK = Pattern.compile(
        "(?:^|[\\s(（\\[【·:：-])(?:疑似)?(?:(?:电信)?诈骗(?:电话|号码)?|电诈(?:电话|号码)?|骚扰(?:电话|号码)?)(?=$|[\\s)）\\]】·:：-]|[0-9])");

    static String canonical(String raw) {
        if (raw == null) return "";
        String number = Normalizer.normalize(raw, Normalizer.Form.NFKC)
            .replaceAll("[\\s\\p{Z}()\\-‐‑–—]+", "");
        if (number.startsWith("+86")) return number.substring(3);
        if (number.startsWith("0086")) return number.substring(4);
        return number;
    }

    static boolean hasRiskTag(String name) {
        return name != null && RISK.matcher(name).find();
    }

    static Reason classify(String number, boolean tagged) {
        if (tagged) return Reason.TAGGED;
        if (CARRIER_NUMBERS.contains(number)) return Reason.CARRIER;
        if (number.startsWith("400") || number.startsWith("800")) return Reason.SERVICE;
        if (number.matches("10[0-9]*")) return Reason.SERVICE_10;
        if (PUBLIC_NUMBERS.contains(number)) return Reason.PUBLIC;
        if (number.matches("1[3-9][0-9]{9}|0[1-9][0-9]{8,10}|[2-9][0-9]{6,7}")) return Reason.PERSONAL;
        return Reason.UNKNOWN;
    }
}
