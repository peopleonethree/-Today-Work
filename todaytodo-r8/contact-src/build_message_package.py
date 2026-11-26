"""Stage and assemble the Android message feature on the verified contact-filter APK."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from shutil import copyfileobj
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
stage = root / "message-build"
project = root.parent / "voice-session-fix-20261026"
base = root / "TodayTodo-R8-contact-filter-v2.apk"
command = sys.argv[1]
if command == "extract":
    with ZipFile(base) as apk:
        (stage / "base.dex").write_bytes(apk.read("classes.dex"))
        (stage / "dexedit/AndroidManifest.xml").write_bytes(apk.read("AndroidManifest.xml"))
elif command == "patch":
    bridge = stage / "dexedit/smali/com/todaytodo/app/NativeBridge.smali"
    body = bridge.read_text(encoding="utf-8")
    if "openMessageShare(" not in body:
        body += """
.method public openMessageShare(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0, p1, p2, p3}, Lcom/todaytodo/app/MessageShare;->open(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z
    move-result v0
    return v0
.end method
"""
        bridge.write_text(body, encoding="utf-8")
    manifest = stage / "manifestedit/AndroidManifest.xml"
    ns = "http://schemas.android.com/apk/res/android"
    ET.register_namespace("android", ns)
    tree = ET.parse(manifest)
    android = lambda name: f"{{{ns}}}{name}"
    app = tree.getroot().find("application")
    if not any(p.get(android("name")) == ".MessageAudioProvider" for p in app.findall("provider")):
        ET.SubElement(app, "provider", {
            android("name"): ".MessageAudioProvider",
            android("authorities"): "com.todaytodo.app.messageaudio",
            android("exported"): "false",
            android("grantUriPermissions"): "true",
        })
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
elif command == "package":
    with ZipFile(stage / "dex.apk") as dex, ZipFile(stage / "manifest.apk") as manifest:
        replacements = {
            "classes.dex": dex.read("classes.dex"),
            "AndroidManifest.xml": manifest.read("AndroidManifest.xml"),
            "assets/index.html": (project / "assets/index.html").read_bytes(),
            "assets/js/app.js": (project / "assets/js/app.js").read_bytes(),
        }
    additions = {
        "classes4.dex": stage / "newdex/classes.dex",
        "assets/js/message-workbench.js": project / "assets/js/message-workbench.js",
        "assets/message-workbench.css": project / "assets/message-workbench.css",
    }
    def old_signature(name):
        name = name.upper()
        return name.startswith("META-INF/") and name.endswith((".RSA", ".SF", ".DSA", ".EC", "MANIFEST.MF"))
    destination = stage / "messages-unsigned.apk"
    with ZipFile(base) as old, ZipFile(destination, "w") as new:
        assert not (set(additions) & set(old.namelist()))
        for info in old.infolist():
            if old_signature(info.filename):
                continue
            if info.filename in replacements:
                new.writestr(info, replacements[info.filename])
            else:
                with old.open(info) as source, new.open(info, "w") as target:
                    copyfileobj(source, target, 1024 * 1024)
        for name, path in additions.items():
            new.write(path, name, compress_type=ZIP_DEFLATED)
    with ZipFile(base) as old, ZipFile(destination) as new:
        assert new.testzip() is None
        assert set(new.namelist()) == {n for n in old.namelist() if not old_signature(n)} | set(additions)
        assert {n for n in new.namelist() if n not in additions and
                old.getinfo(n).CRC != new.getinfo(n).CRC} == set(replacements)
    print("APK verified against contact-filter base")
