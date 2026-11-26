"""Apply narrow, repeatable integration patches; preserve all existing ASR/native classes."""
from pathlib import Path
import re, shutil, xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
smali=root/'native/build/decoded/smali/com/todaytodo/app'
backup=root/'native/build/pre-service-smali'
backup.mkdir(exist_ok=True)
for name in ['ReminderScheduler','ReminderReceiver','NativeBridge']:
    path=smali/(name+'.smali')
    if not (backup/path.name).exists(): shutil.copy2(path,backup/path.name)

def replace_method(text,signature,body):
    pattern=r'\.method '+re.escape(signature)+r'\n.*?\.end method'
    text,n=re.subn(pattern,lambda m:'.method '+signature+'\n'+body+'\n.end method',text,flags=re.S)
    assert n==1,(signature,n)
    return text

p=smali/'ReminderScheduler.smali'; s=(backup/p.name).read_text()
s=replace_method(s,'static dueChannelId(Landroid/content/Context;)Ljava/lang/String;', '''    .locals 1
    invoke-static {p0}, Lcom/todaytodo/app/AppRingtoneChannel;->dueChannelId(Landroid/content/Context;)Ljava/lang/String;
    move-result-object v0
    return-object v0''')
for signature in ['static ensureChannel(Landroid/content/Context;)V','static rotateDueChannel(Landroid/content/Context;)V']:
    s=replace_method(s,signature,'''    .locals 0
    invoke-static {p0}, Lcom/todaytodo/app/AppRingtoneChannel;->ensureChannels(Landroid/content/Context;)V
    return-void''')
p.write_text(s,encoding='utf-8')
p=smali/'ReminderReceiver.smali'; s=(backup/p.name).read_text()
marker='    :cond_2\n    const-string v0, "text"'
assert s.count(marker)==1
s=s.replace(marker,'''    :cond_2
    invoke-static {p1, p2}, Lcom/todaytodo/app/AppRingtoneChannel;->handleDue(Landroid/content/Context;Landroid/content/Intent;)Z
    move-result v0
    if-eqz v0, :legacy_offset
    return-void
    :legacy_offset
    const-string v0, "text"''')
p.write_text(s,encoding='utf-8')
p=smali/'NativeBridge.smali'; s=(backup/p.name).read_text()
s+='''
.method public setAlertEnabled(Z)V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0, p1}, Lcom/todaytodo/app/AppRingtoneChannel;->setEnabled(Landroid/content/Context;Z)V
    return-void
.end method
'''
# Existing JS stop action must also stop an alarm that started in the background.
key='.method public stopAlert()V\n    .locals '
a=s.index(key); b=s.index('\n',a+len(key))
s=s[:b+1]+'''    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;
    invoke-static {v0}, Lcom/todaytodo/app/AppRingtoneChannel;->stop(Landroid/content/Context;)V
'''+s[b+1:]
p.write_text(s,encoding='utf-8')

p=root/'native/build/manifest-edit/AndroidManifest.xml'; ET.register_namespace('android','http://schemas.android.com/apk/res/android')
tree=ET.parse(p); manifest=tree.getroot(); ns='{http://schemas.android.com/apk/res/android}'
for permission in ['android.permission.FOREGROUND_SERVICE','android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK']:
    if not any(e.get(ns+'name')==permission for e in manifest.findall('uses-permission')):
        ET.SubElement(manifest,'uses-permission',{ns+'name':permission})
app=manifest.find('application')
if not any(e.get(ns+'name')=='.AlarmRingtoneService' for e in app.findall('service')):
    ET.SubElement(app,'service',{ns+'name':'.AlarmRingtoneService',ns+'exported':'false',ns+'foregroundServiceType':'mediaPlayback',ns+'stopWithTask':'false'})
tree.write(p,encoding='utf-8',xml_declaration=True)
print('Patched receiver, scheduler, bridge and foreground-service manifest')
