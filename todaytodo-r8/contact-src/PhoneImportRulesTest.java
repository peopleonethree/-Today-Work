package com.todaytodo.app;

import static com.todaytodo.app.PhoneImportRules.Reason.*;

public final class PhoneImportRulesTest {
    private static void check(String raw, String label, PhoneImportRules.Reason expected) {
        PhoneImportRules.Reason got = PhoneImportRules.classify(
            PhoneImportRules.canonical(raw), PhoneImportRules.hasRiskTag(label));
        if (got != expected) throw new AssertionError(raw + " expected " + expected + ", got " + got);
    }

    public static void main(String[] args) {
        check("１００８６", "客服", CARRIER);
        check("10016", "营销", CARRIER);
        check("10 123", "服务台", SERVICE_10);
        check("+86（１０）2345", "服务台", SERVICE_10);
        check("+86 10001", "客服电话", CARRIER);
        check("0086 (400) 123-4567", "售后", SERVICE);
        check("800-555-1234", "售后", SERVICE);
        check("+8613800000000", "号码【疑似诈骗】", TAGGED);
        check("13800000000", "骚扰电话", TAGGED);
        check("13800000000", "电信诈骗号码", TAGGED);
        check("13800000000", "张三", PERSONAL);
        check("13900000000", "中国移动张工", PERSONAL);
        check("0530-1234567", "市区办公室", PERSONAL);
        check("96110", "反诈中心", PUBLIC);
        check("12381", "预警", PUBLIC);
        check("+44 20 1234 5678", "英国号码", UNKNOWN);
        check("95555", "其他热线", UNKNOWN);
        check("13900000000#12", "含分机符号", UNKNOWN);
        System.out.println("18 phone-number classification cases passed");
    }
}
