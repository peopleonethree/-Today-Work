"""Package only the native ringtone change into the verified installed baseline."""
from pathlib import Path
import zipfile, hashlib, json
root=Path(__file__).resolve().parents[1]
base=root/'evidence/installed-20261029.apk'
rebuilt=root/'native/build/rebuilt.apk'
out=root/'dist/TodayTodo-20261029-app-ringtone-unsigned.apk'
def signature(n):
    return n.upper().startswith('META-INF/') and n.upper().endswith(('.RSA','.SF','.DSA','.EC','MANIFEST.MF'))
with zipfile.ZipFile(base) as old, zipfile.ZipFile(rebuilt) as changed, zipfile.ZipFile(out,'w') as new:
    for info in old.infolist():
        if not signature(info.filename):
            new.writestr(info,changed.read('classes.dex') if info.filename=='classes.dex' else old.read(info))
with zipfile.ZipFile(base) as old, zipfile.ZipFile(out) as new:
    assert new.testzip() is None
    changed=[n for n in new.namelist() if new.read(n)!=old.read(n)]
    assert changed==['classes.dex'],changed
report={'changed':changed,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'signed':False,'deviceTested':False}
(root/'evidence/app-ringtone-package-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
