"""Package only the new directory, bridge entry point, manifest and UI assets."""
from pathlib import Path
from shutil import copyfileobj
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
stage = root / "directory-build"
assets = root.parent / "voice-session-fix-20261026"
output = stage / "directory-unsigned.apk"
with ZipFile(stage / "dex.apk") as dex, ZipFile(stage / "manifest.apk") as manifest:
    replacement = {
        "classes.dex": dex.read("classes.dex"),
        "AndroidManifest.xml": manifest.read("AndroidManifest.xml"),
        "assets/index.html": (assets / "assets/index.html").read_bytes(),
        "assets/js/app.js": (assets / "assets/js/app.js").read_bytes(),
    }

def signature(name):
    name = name.upper()
    return name.startswith("META-INF/") and name.endswith((".RSA", ".SF", ".DSA", ".EC", "MANIFEST.MF"))

with ZipFile(root / "TodayTodo-R8-contact-names.apk") as old, ZipFile(output, "w") as new:
    assert "classes3.dex" not in old.namelist()
    assert set(replacement) <= set(old.namelist())
    for entry in old.infolist():
        if signature(entry.filename):
            continue
        if entry.filename in replacement:
            new.writestr(entry, replacement[entry.filename])
            continue
        with old.open(entry) as source, new.open(entry, "w") as dest:
            copyfileobj(source, dest, 1024 * 1024)
    new.write(stage / "newdex/classes.dex", "classes3.dex")
with ZipFile(root / "TodayTodo-R8-contact-names.apk") as old, ZipFile(output) as final:
    assert final.testzip() is None
    assert set(final.namelist()) == {name for name in old.namelist() if not signature(name)} | {"classes3.dex"}
    assert {name for name in final.namelist() if name != "classes3.dex"
            and final.getinfo(name).CRC != old.getinfo(name).CRC} == set(replacement)
print("Verified expected APK entries")
