"""Integrate the R8 batch transcriber into the signed ringtone baseline."""
from pathlib import Path
from shutil import copyfileobj
from zipfile import ZipFile

root = Path(__file__).resolve().parent
base = root.parent / "voice-session-fix-20261026/dist/TodayTodo-20261124-app-ringtone-service.apk"
additions = {
    "assets/whisper-r8/encoder.int8.onnx": "small-encoder.int8.onnx",
    "assets/whisper-r8/decoder.int8.onnx": "small-decoder.int8.onnx",
    "assets/whisper-r8/tokens.txt": "small-tokens.txt",
}

def signature(name):
    name = name.upper()
    return name.startswith("META-INF/") and name.endswith((".RSA", ".SF", ".DSA", ".EC", "MANIFEST.MF"))

output = root / "TodayTodo-Whisper-R8-unsigned.apk"
with ZipFile(base) as old, ZipFile(root / "assembled.apk") as assembly, ZipFile(output, "w") as new:
    bytecode = assembly.read("classes.dex")
    for entry in old.infolist():
        if signature(entry.filename):
            continue
        if entry.filename == "classes2.dex":
            new.writestr(entry, bytecode)
            continue
        with old.open(entry) as source, new.open(entry, "w") as destination:
            copyfileobj(source, destination, 1024 * 1024)
    for entry, artifact in additions.items():
        new.write(root / "onnx" / artifact, arcname=entry)

with ZipFile(base) as old, ZipFile(output) as new:
    assert new.testzip() is None
    assert set(new.namelist()) == {n for n in old.namelist() if not signature(n)} | set(additions)
    assert {n for n in new.namelist() if n not in additions and
            new.getinfo(n).CRC != old.getinfo(n).CRC} == {"classes2.dex"}
print(f"Verified APK layout ({output.stat().st_size} bytes)")
