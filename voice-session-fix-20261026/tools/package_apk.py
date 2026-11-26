"""Replace only the declared frontend files; preserve every native/resource payload."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANGED = ['assets/js/app.js', 'assets/index.html', 'assets/button-theme.css',
           'assets/guide-v2.css', 'assets/js/guide-v2.js', 'assets/js/domain/memo.js',
           'assets/js/domain/derived.js', 'assets/js/ai/tasks.js',
           'assets/js/storage.js', 'assets/js/auth.js']

def digest(data):
    return hashlib.sha256(data).hexdigest()

def signature(name):
    name = name.upper()
    return name.startswith('META-INF/') and (name.endswith(('.RSA','.DSA','.EC','.SF'))
                                            or name == 'META-INF/MANIFEST.MF')

def build(base, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    patches = {name: (ROOT/name).read_bytes() for name in CHANGED}
    baseline = (ROOT/'baseline/app.js').read_bytes()
    with zipfile.ZipFile(base) as old:
        if digest(old.read('assets/js/app.js')) != digest(baseline):
            raise RuntimeError('Base APK has changed; refusing to package against a different source')
        seen = set()
        with zipfile.ZipFile(output,'w') as new:
            for item in old.infolist():
                if signature(item.filename):
                    continue
                data = patches.get(item.filename)
                if data is None:
                    data = old.read(item)
                new.writestr(item, data)
                seen.add(item.filename)
            for name,data in patches.items():
                if name not in seen:
                    new.writestr(name,data,compress_type=zipfile.ZIP_DEFLATED)
    verify(base,output)

def verify(base,output):
    unchanged=0
    with zipfile.ZipFile(base) as old, zipfile.ZipFile(output) as new:
        old_names = {i.filename for i in old.infolist() if not signature(i.filename)}
        new_names = {i.filename for i in new.infolist() if not signature(i.filename)}
        if new_names - old_names != set(CHANGED) - old_names or old_names - new_names:
            raise RuntimeError('Unexpected APK entry changes')
        if new.testzip() is not None:
            raise RuntimeError('APK CRC verification failed')
        for name in old_names:
            if name not in CHANGED:
                if digest(old.read(name)) != digest(new.read(name)):
                    raise RuntimeError('Unexpected payload change: '+name)
                unchanged+=1
        for name in CHANGED:
            if new.read(name)!=(ROOT/name).read_bytes():
                raise RuntimeError('Patched source mismatch: '+name)
    report={'base':str(base),'output':str(output),'sha256':digest(output.read_bytes()),
            'changed':{name:digest((ROOT/name).read_bytes()) for name in CHANGED},
            'unchangedPayloadEntries':unchanged,'crcVerified':True}
    (ROOT/'evidence/apk-payload-verification.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--base',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--verify-only',action='store_true')
    args=parser.parse_args()
    (verify if args.verify_only else build)(args.base,args.output)
