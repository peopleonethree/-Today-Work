"""Stage the exact base APK, adding one WebView entry point and a native screen."""
from pathlib import Path
from zipfile import ZipFile
import sys
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
stage = root / "directory-build"
base = root / "TodayTodo-R8-contact-names.apk"
command = sys.argv[1]

if command == "extract":
    stage.mkdir(exist_ok=True)
    with ZipFile(base) as old:
        (stage / "base.dex").write_bytes(old.read("classes.dex"))
        (stage / "AndroidManifest.xml").write_bytes(old.read("AndroidManifest.xml"))
elif command == "patch":
    bridge = stage / "dexedit/smali/com/todaytodo/app/NativeBridge.smali"
    entry = """
.method public openContactDirectory()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0}, Lcom/todaytodo/app/ContactsActivity;->open(Landroid/app/Activity;)V
    return-void
.end method
"""
    original = bridge.read_text(encoding="utf-8")
    if "openContactDirectory()V" not in original:
        bridge.write_text(original + entry, encoding="utf-8")
    android = "http://schemas.android.com/apk/res/android"
    ET.register_namespace("android", android)
    manifest = stage / "manifestedit/AndroidManifest.xml"
    tree = ET.parse(manifest)
    document = tree.getroot()
    name = "{" + android + "}name"
    read_contacts = "android.permission.READ_CONTACTS"
    if not any(element.get(name) == read_contacts for element in document.findall("uses-permission")):
        document.insert(0, ET.Element("uses-permission", {name: read_contacts}))
    app = document.find("application")
    if not any(element.get(name) == ".ContactsActivity" for element in app.findall("activity")):
        ET.SubElement(app, "activity", {name: ".ContactsActivity", "{" + android + "}exported": "false"})
    queries = document.find("queries")
    if queries is None:
        queries = ET.Element("queries")
        document.insert(0, queries)
    for package in ("com.tencent.mm", "com.tencent.mobileqq"):
        if not any(element.get(name) == package for element in queries.findall("package")):
            ET.SubElement(queries, "package", {name: package})
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
