"""Build the vocabulary and contact changes on the installed keyboard-fix APK."""
import os
from pathlib import Path
from shutil import copyfile, copyfileobj, copytree
from subprocess import run
from zipfile import ZipFile


source = Path(__file__).resolve().parent
root = source.parent
project = root.parent / "voice-session-fix-20261026"
stage = root / "vocabulary-build"
stage.mkdir(exist_ok=True)
tools = Path.home() / "android-tools"
sdk = Path.home() / "android-sdk"
jdk = tools / "jdk-17.0.20.1+1"
java = jdk / "bin"
android = sdk / "platforms/android-34/android.jar"
env = {**os.environ, "JAVA_HOME": str(jdk)}


def invoke(*args):
    run([str(arg) for arg in args], check=True, env=env)


dest = stage / "dexedit"
original = root / "message-build/dexedit"
copytree(original / "smali", dest / "smali", dirs_exist_ok=True)
for name in ("apktool.yml", "AndroidManifest.xml"):
    copyfile(original / name, dest / name)
bridge = dest / "smali/com/todaytodo/app/NativeBridge.smali"
body = bridge.read_text(encoding="utf-8")
assert "openMessageShare(" in body and "readVocabularyDirectory(" not in body
bridge.write_text(body + """
.method public readVocabularyDirectory()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0}, Lcom/todaytodo/app/ContactsActivity;->vocabularySnapshot(Landroid/app/Activity;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public enqueueDesktopMessage(Ljava/lang/String;Ljava/lang/String;)I
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    invoke-static {p1, p2}, Lcom/todaytodo/app/DesktopRelay;->enqueue(Ljava/lang/String;Ljava/lang/String;)I
    move-result v0
    return v0
.end method

.method public startMessageVoice()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0}, Lcom/todaytodo/app/MessageVoiceCapture;->start(Landroid/app/Activity;)Z
    move-result v0
    return v0
.end method

.method public stopMessageVoice()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0}, Lcom/todaytodo/app/MessageVoiceCapture;->stop(Landroid/app/Activity;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method
""", encoding="utf-8")
activity = bridge.with_name("MainActivity.smali")
body = activity.read_text(encoding="utf-8")
result_call = "    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onActivityResult(IILandroid/content/Intent;)V"
assert body.count(result_call) == 1
body = body.replace(result_call, result_call + """

    invoke-static {p0, p1, p2, p3}, Lcom/todaytodo/app/WebFileChooser;->deliver(Landroid/app/Activity;IILandroid/content/Intent;)Z
    move-result v0
    if-eqz v0, :original_activity_result
    return-void
    :original_activity_result""")
destroy = "    invoke-super {p0}, Landroid/app/Activity;->onDestroy()V"
assert body.count(destroy) == 1
activity.write_text(body.replace(destroy,
    "    invoke-static {p0}, Lcom/todaytodo/app/WebFileChooser;->cancel(Landroid/app/Activity;)V\n"
    "    invoke-static {p0}, Lcom/todaytodo/app/MessageVoiceCapture;->cancel(Landroid/app/Activity;)V\n\n" + destroy),
    encoding="utf-8")
chrome_client = bridge.with_name("MainActivity$1.smali")
body = chrome_client.read_text(encoding="utf-8")
assert "onShowFileChooser(" not in body and "this$0:Lcom/todaytodo/app/MainActivity;" in body
chrome_client.write_text(body + """
.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .locals 1
    iget-object v0, p0, Lcom/todaytodo/app/MainActivity$1;->this$0:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0, p2, p3}, Lcom/todaytodo/app/WebFileChooser;->open(Landroid/app/Activity;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    move-result v0
    return v0
.end method

""", encoding="utf-8")
invoke(java / "java.exe", "-jar", tools / "apktool.jar", "b", "-f", "-o", stage / "bridge.apk", dest)

classes = stage / "classes"
new_dex = stage / "contacts-dex"
classes.mkdir(exist_ok=True)
new_dex.mkdir(exist_ok=True)
invoke(java / "javac.exe", "-encoding", "UTF-8", "--release", "8", "-classpath", android, "-d", classes,
       *(source / (name + ".java") for name in ("PhoneImportRules", "VocabularyDirectory", "ContactsActivity", "WebFileChooser", "DesktopRelay", "MessageVoiceCapture")))
invoke(java / "jar.exe", "cf", stage / "contacts.jar", "-C", classes, ".")
invoke(sdk / "build-tools/34.0.0/d8.bat", "--lib", android, "--min-api", "23", "--output", new_dex,
       stage / "contacts.jar")

base = root / "TodayTodo-R8-voice-viewport.apk"
unsigned = stage / "vocabulary-unsigned.apk"
with ZipFile(stage / "bridge.apk") as bridge_archive:
    replacement = {"classes.dex": bridge_archive.read("classes.dex"),
                   "classes3.dex": (new_dex / "classes.dex").read_bytes()}
for name in ("index.html", "message-workbench.css", "js/app.js", "js/message-workbench.js"):
    replacement["assets/" + name] = (project / "assets" / name).read_bytes()


def signature(name):
    return name.upper().startswith("META-INF/") and name.upper().endswith(
        (".RSA", ".SF", ".DSA", ".EC", "MANIFEST.MF"))


with ZipFile(base) as old, ZipFile(unsigned, "w") as new:
    assert set(replacement) <= set(old.namelist())
    for entry in old.infolist():
        if signature(entry.filename):
            continue
        if entry.filename in replacement:
            new.writestr(entry, replacement[entry.filename])
        else:
            with old.open(entry) as src, new.open(entry, "w") as dst:
                copyfileobj(src, dst, 1024 * 1024)
with ZipFile(base) as old, ZipFile(unsigned) as new:
    assert new.testzip() is None
    assert set(new.namelist()) == {name for name in old.namelist() if not signature(name)}
    assert {name for name in new.namelist() if new.getinfo(name).CRC != old.getinfo(name).CRC} == set(replacement)
print("Verified six planned APK changes.")
