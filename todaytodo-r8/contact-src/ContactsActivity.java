package com.todaytodo.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.Contacts;
import android.provider.Settings;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class ContactsActivity extends Activity {
    private static final int PERMISSION = 41, QQ_FILE = 42, WX_FILE = 43, AUDIO = 44;
    private static final String[] PLATFORM = {"QQ", "微信"};
    private static final String[] PACKAGE = {"com.tencent.mobileqq", "com.tencent.mm"};
    private final List<Person> people = new ArrayList<>();
    private final List<Person> visible = new ArrayList<>();
    private ArrayAdapter<String> adapter;
    private TextView status;
    private EditText filter;
    private int audioTarget = -1;
    private int phoneRequest;

    private static final class Person {
        final String name;
        final int source;
        final Set<String> numbers = new LinkedHashSet<>();
        Person(String name, int source) { this.name = name; this.source = source; }
    }

    public static void open(Activity from) {
        from.runOnUiThread(() -> {
            if (!from.isFinishing()) from.startActivity(new Intent(from, ContactsActivity.class));
        });
    }

    public static String vocabularySnapshot(Activity from) {
        try {
            JSONArray contacts = from.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
                ? VocabularyDirectory.read(from, "phone") : new JSONArray();
            for (int source = 0; source < PLATFORM.length; source++) {
                File file = new File(from.getNoBackupFilesDir(), "contact-source-" + source + ".txt");
                try (InputStream input = new android.util.AtomicFile(file).openRead()) {
                    for (String name : readNames(input)) {
                        contacts.put(new JSONObject().put("name", name).put("channel", PLATFORM[source]));
                    }
                } catch (FileNotFoundException ignored) {}
            }
            return new JSONObject().put("contacts", contacts)
                .put("calls", VocabularyDirectory.read(from, "launches")).toString();
        } catch (IOException | JSONException | RuntimeException failure) {
            return "";
        }
    }

    private void loadSelectedPhone() {
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return;
        try {
            JSONArray contacts = VocabularyDirectory.read(this, "phone");
            for (int i = 0; i < contacts.length(); i++) {
                JSONObject item = contacts.getJSONObject(i);
                Person person = new Person(item.getString("name"), -1);
                JSONArray numbers = item.getJSONArray("numbers");
                for (int j = 0; j < numbers.length(); j++) person.numbers.add(numbers.getString(j));
                people.add(person);
            }
        } catch (IOException | JSONException failure) { message("已选手机联系人读取失败"); }
    }

    private void saveSelectedPhone(List<Person> contacts) throws IOException, JSONException {
        JSONArray entries = new JSONArray();
        for (Person person : contacts) {
            entries.put(new JSONObject().put("name", displayName(person)).put("channel", "手机")
                .put("numbers", new JSONArray(person.numbers)));
        }
        VocabularyDirectory.write(this, "phone", entries);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) audioTarget = state.getInt("audioTarget", -1);
        setTitle("联系人");
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(16 * getResources().getDisplayMetrics().density);
        screen.setPadding(padding, padding, padding, padding);
        setContentView(screen);
        button(screen, "返回今日待办", this::finish);
        button(screen, "筛选并导入手机通讯录", this::requestPhone);
        button(screen, "导入 QQ / 微信好友名单", () -> new AlertDialog.Builder(this)
            .setTitle("选择好友名单来源")
            .setItems(PLATFORM, (d, which) -> choose("text/plain", QQ_FILE + which)).show());
        button(screen, "清除已导入名单", this::clearDirectory);
        filter = new EditText(this);
        filter.setSingleLine();
        filter.setHint("搜索姓名或电话");
        screen.addView(filter);
        status = new TextView(this);
        screen.addView(status);
        ListView list = new ListView(this);
        adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1);
        list.setAdapter(adapter);
        screen.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        list.setOnItemClickListener((parent, view, position, id) -> showActions(visible.get(position)));
        filter.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int f) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) { redraw(); }
            public void afterTextChanged(Editable text) {}
        });
        loadSelectedPhone();
        for (int i = 0; i < PLATFORM.length; i++) {
            try (InputStream in = new FileInputStream(friendFile(i))) { replaceFriends(i, readNames(in)); }
            catch (FileNotFoundException ignored) {}
            catch (IOException ignored) { message(PLATFORM[i] + "名单读取失败，可重新导入"); }
        }
        redraw();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("audioTarget", audioTarget);
    }

    @Override protected void onResume() {
        super.onResume();
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED
            && people.removeIf(person -> person.source < 0)) redraw();
    }

    private void button(LinearLayout parent, String text, Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setOnClickListener(v -> action.run());
        parent.addView(button);
    }

    private void requestPhone() {
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            loadPhone();
            return;
        }
        new AlertDialog.Builder(this).setTitle("读取手机通讯录")
            .setMessage("读取本机通讯录姓名和号码，先筛掉服务号和已标注的风险号码，再由你核对导入。可在系统设置撤回权限。")
            .setNegativeButton("取消", null).setPositiveButton("继续授权", (d, w) ->
                requestPermissions(new String[]{Manifest.permission.READ_CONTACTS}, PERMISSION)).show();
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request != PERMISSION || grants.length == 0) return;
        if (grants[0] == PackageManager.PERMISSION_GRANTED) loadPhone();
        else new AlertDialog.Builder(this).setTitle("通讯录权限未开启")
            .setMessage("可以继续使用 QQ 和微信名单，或到系统设置开放通讯录权限。")
            .setNegativeButton("返回", null).setPositiveButton("系统设置", (d,w) ->
                launch(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null)), "无法打开系统设置")).show();
    }

    private void loadPhone() {
        final int request = ++phoneRequest;
        status.setText("正在读取系统通讯录…");
        new Thread(() -> {
            try {
                Map<Long,Person> contacts = new LinkedHashMap<>();
                try (Cursor c = getContentResolver().query(Contacts.CONTENT_URI,
                    new String[]{Contacts._ID, Contacts.DISPLAY_NAME_PRIMARY}, null, null,
                    Contacts.DISPLAY_NAME_PRIMARY + " COLLATE LOCALIZED ASC")) {
                    if (c == null) throw new IOException("contacts unavailable");
                    while (c.moveToNext()) contacts.put(c.getLong(0), new Person(c.getString(1), -1));
                }
                try (Cursor c = getContentResolver().query(Phone.CONTENT_URI,
                    new String[]{Phone.CONTACT_ID, Phone.NUMBER}, null, null, null)) {
                    if (c == null) throw new IOException("phone numbers unavailable");
                    while (c.moveToNext()) {
                        Person person = contacts.get(c.getLong(0));
                        String number = c.getString(1);
                        if (person != null && number != null && !number.trim().isEmpty()) person.numbers.add(number.trim());
                    }
                }
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || request != phoneRequest) return;
                    if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
                        redraw(); message("通讯录权限已撤回"); return;
                    }
                    redraw();
                    reviewPhoneImport(contacts.values());
                });
            } catch (RuntimeException | IOException error) {
                runOnUiThread(() -> {
                    if (request == phoneRequest && !isFinishing()) {
                        redraw(); message("无法读取通讯录，请检查授权后重试");
                    }
                });
            }
        }, "contact-import").start();
    }

    private void reviewPhoneImport(Collection<Person> contacts) {
        if (contacts.isEmpty()) { message("系统通讯录为空"); return; }
        Set<String> tagged = new HashSet<>();
        for (Person contact : contacts) {
            if (PhoneImportRules.hasRiskTag(contact.name)) {
                for (String number : contact.numbers) tagged.add(PhoneImportRules.canonical(number));
            }
        }
        List<Person> accepted = new ArrayList<>();
        List<String> excluded = new ArrayList<>();
        int withoutNumber = 0;
        for (Person contact : contacts) {
            if (contact.numbers.isEmpty()) { withoutNumber++; continue; }
            Person copy = new Person(contact.name, -1);
            Set<String> seen = new HashSet<>();
            for (String raw : contact.numbers) {
                String number = PhoneImportRules.canonical(raw);
                if (!seen.add(number)) continue;
                PhoneImportRules.Reason reason = PhoneImportRules.classify(number, tagged.contains(number));
                if (reason == PhoneImportRules.Reason.PERSONAL) copy.numbers.add(raw);
                else excluded.add(displayName(contact) + " · " + raw + " · " + reason.label);
            }
            if (!copy.numbers.isEmpty()) accepted.add(copy);
        }
        boolean[] selected = new boolean[accepted.size()];
        Arrays.fill(selected, true);
        String[] options = new String[accepted.size()];
        for (int i = 0; i < accepted.size(); i++) {
            Person contact = accepted.get(i);
            options[i] = displayName(contact) + "\n" + String.join("、", contact.numbers);
        }
        AlertDialog.Builder preview = new AlertDialog.Builder(this)
            .setTitle("待核对 " + accepted.size() + " 位 · 已过滤 " + excluded.size() + " 个号码"
                + (withoutNumber == 0 ? "" : " · " + withoutNumber + " 位无号码"))
            .setNegativeButton("取消", null);
        if (!excluded.isEmpty()) preview.setNeutralButton("查看过滤详情", null);
        if (accepted.isEmpty()) preview.setMessage("没有可默认导入的普通号码。");
        else preview.setMultiChoiceItems(options, selected, (dialog,i,checked) -> selected[i] = checked)
            .setPositiveButton("导入已选", (d,w) -> {
                if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
                    message("通讯录权限已撤回"); return;
                }
                List<Person> imported = new ArrayList<>();
                for (int i = 0; i < accepted.size(); i++) if (selected[i]) imported.add(accepted.get(i));
                if (imported.size() > 3000) { message("一次最多保存 3000 位联系人"); return; }
                try { saveSelectedPhone(imported); }
                catch (IOException | JSONException failure) { message("保存失败，原名单保留"); return; }
                people.removeIf(p -> p.source < 0);
                people.addAll(0, imported);
                redraw();
                message("已导入 " + imported.size() + " 位联系人");
            });
        AlertDialog dialog = preview.show();
        if (!excluded.isEmpty()) dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v ->
            new AlertDialog.Builder(this).setTitle("本次未导入的号码")
                .setItems(excluded.toArray(new String[0]), (d,w) -> {})
                .setPositiveButton("关闭", null).show());
    }

    private static String displayName(Person person) {
        return person.name == null || person.name.trim().isEmpty() ? "未命名联系人" : person.name;
    }

    private void redraw() {
        String query = filter.getText().toString().trim().toLowerCase(Locale.ROOT);
        visible.clear();
        adapter.clear();
        for (Person person : people) {
            String name = displayName(person);
            String numbers = String.join("、", person.numbers);
            if (!(name.toLowerCase(Locale.ROOT).contains(query) || numbers.contains(query))) continue;
            visible.add(person);
            adapter.add(name + " · " + (person.source < 0 ? "手机" : PLATFORM[person.source])
                + (numbers.isEmpty() ? "" : "\n" + numbers));
        }
        status.setText("显示 " + visible.size() + " / " + people.size() + " 条");
    }

    private void showActions(Person person) {
        ArrayList<String> labels = new ArrayList<>();
        ArrayList<Runnable> actions = new ArrayList<>();
        for (String number : person.numbers) {
            labels.add("打开拨号盘 · " + number);
            actions.add(() -> launchForCall(person, "手机", number,
                new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)), "没有可用的拨号应用"));
        }
        for (int i = 0; i < PLATFORM.length; i++) {
            if (person.source >= 0 && person.source != i) continue;
            final int platform = i;
            labels.add("打开" + PLATFORM[i] + " · 在好友页发起语音或视频");
            actions.add(() -> openClient(person, platform));
            labels.add("分享到" + PLATFORM[i] + " · 选择预设录音");
            actions.add(() -> {
                audioTarget = platform;
                choose("audio/*", AUDIO);
            });
        }
        new AlertDialog.Builder(this).setTitle(person.name)
            .setItems(labels.toArray(new String[0]), (dialog, which) -> actions.get(which).run())
            .setNegativeButton("取消", null).show();
    }

    private void openClient(Person person, int platform) {
        Intent intent = getPackageManager().getLaunchIntentForPackage(PACKAGE[platform]);
        if (intent == null) message("未找到" + PLATFORM[platform] + "客户端");
        else launchForCall(person, PLATFORM[platform], "", intent, "无法打开" + PLATFORM[platform]);
    }

    private void launchForCall(Person person, String channel, String number, Intent intent, String failure) {
        if (!launch(intent, failure)) return;
        try { VocabularyDirectory.logLaunch(this, displayName(person), channel, number); }
        catch (IOException | JSONException error) { message("已打开应用，通话入口记录保存失败"); }
    }

    private void choose(String mime, int request) {
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType(mime);
        try { startActivityForResult(pick, request); }
        catch (RuntimeException error) { message("没有可用的系统文件选择器"); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (request == AUDIO && audioTarget >= 0 && audioTarget < PLATFORM.length) {
            shareAudio(audioTarget, uri);
            return;
        }
        if (request != QQ_FILE && request != WX_FILE) return;
        int source = request - QQ_FILE;
        Set<String> names;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            names = readNames(in);
        } catch (IOException | RuntimeException error) {
            message("文件读取失败，请选 UTF-8 文本，每行一个姓名或备注");
            return;
        }
        if (names.isEmpty()) { message("文件中没有可用的姓名或备注"); return; }
        new AlertDialog.Builder(this).setTitle("导入" + PLATFORM[source] + "好友")
            .setMessage("读取到 " + names.size() + " 条姓名或备注。保存时合并当前名单中的不同条目。")
            .setNegativeButton("取消", null).setPositiveButton("导入", (d,w) -> {
                Set<String> merged = new LinkedHashSet<>();
                for (Person person : people) if (person.source == source) merged.add(person.name);
                merged.addAll(names);
                if (merged.size() > 2000) { message("该平台名单最多保存 2000 条"); return; }
                android.util.AtomicFile file = new android.util.AtomicFile(friendFile(source));
                FileOutputStream out = null;
                try {
                    out = file.startWrite();
                    out.write(String.join("\n", merged).getBytes(StandardCharsets.UTF_8));
                    file.finishWrite(out);
                    replaceFriends(source, merged);
                    redraw();
                    message("名单已导入");
                } catch (IOException error) {
                    if (out != null) file.failWrite(out);
                    message("保存失败，原名单保留");
                }
            }).show();
    }

    private void shareAudio(int platform, Uri uri) {
        String mime;
        try { mime = getContentResolver().getType(uri); }
        catch (RuntimeException error) { message("录音不可读取，请重新选择"); return; }
        if (mime == null || !mime.startsWith("audio/")) { message("请选择音频文件"); return; }
        Intent share = new Intent(Intent.ACTION_SEND).setType(mime).setPackage(PACKAGE[platform]);
        share.putExtra(Intent.EXTRA_STREAM, uri);
        share.setClipData(ClipData.newRawUri("录音", uri));
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        new AlertDialog.Builder(this).setTitle("将录音交给" + PLATFORM[platform])
            .setMessage("录音会作为音频文件打开。请在客户端核对好友并确认发送。")
            .setNegativeButton("取消", null).setPositiveButton("打开分享", (d,w) ->
                launch(share, PLATFORM[platform] + "未安装或当前版本不接收这种音频。可在好友聊天中用「文件」选择录音。")).show();
    }

    private File friendFile(int source) {
        return new File(getNoBackupFilesDir(), "contact-source-" + source + ".txt");
    }

    private static Set<String> readNames(InputStream stream) throws IOException {
        if (stream == null) throw new IOException("no file");
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int count;
        while ((count = stream.read(buffer)) != -1) {
            if (data.size() + count > 65536) throw new IOException("file too large");
            data.write(buffer, 0, count);
        }
        Set<String> names = new LinkedHashSet<>();
        for (String line : new String(data.toByteArray(), StandardCharsets.UTF_8).split("\\R")) {
            String name = line.replace("\uFEFF", "").trim();
            if (!name.isEmpty() && name.length() <= 40 && !name.matches(".*\\p{Cntrl}.*")
                && !name.matches(".*[0-9]{5,}.*") && !name.contains("\uFFFD")) names.add(name);
            if (names.size() > 2000) throw new IOException("too many names");
        }
        return names;
    }

    private void replaceFriends(int source, Set<String> names) {
        people.removeIf(p -> p.source == source);
        for (String name : names) people.add(new Person(name, source));
    }

    private void clearDirectory() {
        new AlertDialog.Builder(this).setTitle("清除本应用显示的联系人？")
            .setMessage("会清除本页的名单，系统通讯录和 QQ、微信好友不受影响。")
            .setNegativeButton("取消", null).setPositiveButton("清除", (d,w) -> {
                ++phoneRequest;
                try { VocabularyDirectory.write(this, "phone", new JSONArray()); }
                catch (IOException error) { message("清除失败，原名单保留"); return; }
                for (int i = 0; i < PLATFORM.length; i++) new android.util.AtomicFile(friendFile(i)).delete();
                people.clear();
                redraw();
            }).show();
    }

    private boolean launch(Intent intent, String failure) {
        try { startActivity(intent); return true; }
        catch (RuntimeException error) { message(failure); return false; }
    }

    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
}
