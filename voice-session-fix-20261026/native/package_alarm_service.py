"""Preserve the installed baseline except the four reviewed service changes."""
from pathlib import Path
import zipfile, hashlib, json
root=Path(__file__).resolve().parents[1]
base=root/'dist/TodayTodo-20261029-app-ringtone.apk'
out=root/'dist/TodayTodo-20261124-app-ringtone-service-unsigned.apk'
with zipfile.ZipFile(root/'native/build/service-dex.apk') as dex, zipfile.ZipFile(root/'native/build/service-manifest.apk') as manifest:
    replacements={'classes.dex':dex.read('classes.dex'),'AndroidManifest.xml':manifest.read('AndroidManifest.xml')}
for name in ['assets/js/app.js','assets/js/native.js']:
    replacements[name]=(root/name).read_bytes()
def signature(name):
    return name.upper().startswith('META-INF/') and name.upper().endswith(('.RSA','.SF','.DSA','.EC','MANIFEST.MF'))
with zipfile.ZipFile(base) as old, zipfile.ZipFile(out,'w') as new:
    for info in old.infolist():
        if not signature(info.filename):
            new.writestr(info,replacements.get(info.filename,old.read(info)))
with zipfile.ZipFile(base) as old, zipfile.ZipFile(out) as new:
    assert new.testzip() is None
    changed=[n for n in new.namelist() if new.read(n)!=old.read(n)]
    assert set(changed)==set(replacements),changed
report={'changed':changed,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'signed':False,'deviceTested':False}
(root/'evidence/alarm-service-package-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
