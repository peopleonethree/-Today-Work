.class public Lcom/todaytodo/app/NativeBridge;
.super Ljava/lang/Object;
.source "NativeBridge.java"


# static fields
.field private static final ALERT_MAX_MS:J = 0x2710L

.field public static final NAME:Ljava/lang/String; = "AndroidHost"

.field private static final PREVIEW_MS:J = 0xdacL

.field public static final UA_TAG:Ljava/lang/String; = "TodayTodoApp/1.0"


# instance fields
.field private final activity:Lcom/todaytodo/app/MainActivity;

.field private final alertHandler:Landroid/os/Handler;

.field private alertPlayer:Landroid/media/MediaPlayer;

.field private final alertStop:Ljava/lang/Runnable;

.field private final web:Landroid/webkit/WebView;


# direct methods
.method constructor <init>(Lcom/todaytodo/app/MainActivity;Landroid/webkit/WebView;)V
    .locals 2

    .line 27
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    .line 179
    new-instance v0, Landroid/os/Handler;

    .line 180
    invoke-static {}, Landroid/os/Looper;->getMainLooper()Landroid/os/Looper;

    move-result-object v1

    invoke-direct {v0, v1}, Landroid/os/Handler;-><init>(Landroid/os/Looper;)V

    iput-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertHandler:Landroid/os/Handler;

    .line 181
    new-instance v0, Lcom/todaytodo/app/NativeBridge$1;

    invoke-direct {v0, p0}, Lcom/todaytodo/app/NativeBridge$1;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    iput-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertStop:Ljava/lang/Runnable;

    .line 28
    iput-object p1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    .line 29
    iput-object p2, p0, Lcom/todaytodo/app/NativeBridge;->web:Landroid/webkit/WebView;

    return-void
.end method

.method static synthetic access$000(Lcom/todaytodo/app/NativeBridge;)Landroid/media/MediaPlayer;
    .locals 0

    .line 18
    iget-object p0, p0, Lcom/todaytodo/app/NativeBridge;->alertPlayer:Landroid/media/MediaPlayer;

    return-object p0
.end method

.method static synthetic access$100(Lcom/todaytodo/app/NativeBridge;)V
    .locals 0

    .line 18
    invoke-direct {p0}, Lcom/todaytodo/app/NativeBridge;->fallbackTone()V

    return-void
.end method

.method private fallbackTone()V
    .locals 3

    .line 288
    :try_start_0
    new-instance v0, Landroid/media/ToneGenerator;

    const/4 v1, 0x4

    const/16 v2, 0x5a

    invoke-direct {v0, v1, v2}, Landroid/media/ToneGenerator;-><init>(II)V

    const/16 v1, 0x5d

    const/16 v2, 0x4b0

    .line 289
    invoke-virtual {v0, v1, v2}, Landroid/media/ToneGenerator;->startTone(II)Z
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method private playUri(Landroid/net/Uri;J)V
    .locals 3

    .line 231
    invoke-virtual {p0}, Lcom/todaytodo/app/NativeBridge;->stopAlertInternal()V

    .line 233
    :try_start_0
    new-instance v0, Landroid/media/MediaPlayer;

    invoke-direct {v0}, Landroid/media/MediaPlayer;-><init>()V

    .line 234
    new-instance v1, Landroid/media/AudioAttributes$Builder;

    invoke-direct {v1}, Landroid/media/AudioAttributes$Builder;-><init>()V

    const/4 v2, 0x4

    .line 235
    invoke-virtual {v1, v2}, Landroid/media/AudioAttributes$Builder;->setUsage(I)Landroid/media/AudioAttributes$Builder;

    move-result-object v1

    .line 236
    invoke-virtual {v1, v2}, Landroid/media/AudioAttributes$Builder;->setContentType(I)Landroid/media/AudioAttributes$Builder;

    move-result-object v1

    .line 237
    invoke-virtual {v1}, Landroid/media/AudioAttributes$Builder;->build()Landroid/media/AudioAttributes;

    move-result-object v1

    .line 234
    invoke-virtual {v0, v1}, Landroid/media/MediaPlayer;->setAudioAttributes(Landroid/media/AudioAttributes;)V

    .line 238
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, v1, p1}, Landroid/media/MediaPlayer;->setDataSource(Landroid/content/Context;Landroid/net/Uri;)V

    const/4 p1, 0x1

    .line 239
    invoke-virtual {v0, p1}, Landroid/media/MediaPlayer;->setLooping(Z)V

    .line 240
    new-instance p1, Lcom/todaytodo/app/NativeBridge$2;

    invoke-direct {p1, p0}, Lcom/todaytodo/app/NativeBridge$2;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, p1}, Landroid/media/MediaPlayer;->setOnPreparedListener(Landroid/media/MediaPlayer$OnPreparedListener;)V

    .line 251
    new-instance p1, Lcom/todaytodo/app/NativeBridge$3;

    invoke-direct {p1, p0}, Lcom/todaytodo/app/NativeBridge$3;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, p1}, Landroid/media/MediaPlayer;->setOnErrorListener(Landroid/media/MediaPlayer$OnErrorListener;)V

    .line 259
    iput-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertPlayer:Landroid/media/MediaPlayer;

    .line 260
    invoke-virtual {v0}, Landroid/media/MediaPlayer;->prepareAsync()V

    .line 261
    iget-object p1, p0, Lcom/todaytodo/app/NativeBridge;->alertHandler:Landroid/os/Handler;

    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertStop:Ljava/lang/Runnable;

    invoke-virtual {p1, v0}, Landroid/os/Handler;->removeCallbacks(Ljava/lang/Runnable;)V

    .line 262
    iget-object p1, p0, Lcom/todaytodo/app/NativeBridge;->alertHandler:Landroid/os/Handler;

    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertStop:Ljava/lang/Runnable;

    invoke-virtual {p1, v0, p2, p3}, Landroid/os/Handler;->postDelayed(Ljava/lang/Runnable;J)Z
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    goto :goto_0

    .line 264
    :catch_0
    invoke-virtual {p0}, Lcom/todaytodo/app/NativeBridge;->stopAlertInternal()V

    .line 265
    invoke-direct {p0}, Lcom/todaytodo/app/NativeBridge;->fallbackTone()V

    :goto_0
    return-void
.end method


# virtual methods
.method public canRecognizeSpeech()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 397
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0}, Lcom/todaytodo/app/MainActivity;->canRecognizeSpeech()Z

    move-result v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return v0

    :catch_0
    const/4 v0, 0x0

    return v0
.end method

.method public canScheduleExactAlarms()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 80
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->canScheduleExact(Landroid/content/Context;)Z

    move-result v0

    return v0
.end method

.method public cancelDictation()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 473
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda17;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda17;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public cancelVoiceListening()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 449
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda8;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda8;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public cleanupDictation()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 489
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda3;

    invoke-direct {v1, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda3;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public cleanupScan(Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 750
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda22;

    invoke-direct {v1, p0, p1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda22;-><init>(Lcom/todaytodo/app/NativeBridge;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public clearReminders()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 62
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->cancelAll(Landroid/content/Context;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public dbExec(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 640
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0, p1, p2}, Lcom/todaytodo/app/DbStore;->exec(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;

    move-result-object p1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return-object p1

    :catch_0
    const-string p1, "{\"error\":\"db bridge failed\"}"

    return-object p1
.end method

.method public dbQuery(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 650
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0, p1, p2}, Lcom/todaytodo/app/DbStore;->query(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;

    move-result-object p1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return-object p1

    :catch_0
    const-string p1, "{\"error\":\"db bridge failed\"}"

    return-object p1
.end method

.method public dbReady()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 627
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/DbStore;->ready(Landroid/content/Context;)Z

    move-result v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return v0

    :catch_0
    const/4 v0, 0x0

    return v0
.end method

.method public deviceAuthAvailable()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 379
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0}, Lcom/todaytodo/app/MainActivity;->deviceAuthAvailable()Z

    move-result v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return v0

    :catch_0
    const/4 v0, 0x0

    return v0
.end method

.method public dictationSegmentBase64(I)Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 480
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1}, Lcom/todaytodo/app/MainActivity;->dictationSegmentBase64(I)Ljava/lang/String;

    move-result-object p1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return-object p1

    :catch_0
    const-string p1, ""

    return-object p1
.end method

.method public exitApp()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 730
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda27;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda27;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public getPlatform()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const-string v0, "android"

    return-object v0
.end method

.method public getRingtone()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 354
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->chosenRingtone(Landroid/content/Context;)Ljava/lang/String;

    move-result-object v0

    return-object v0
.end method

.method public getRingtoneName()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 359
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->chosenRingtoneName(Landroid/content/Context;)Ljava/lang/String;

    move-result-object v0

    return-object v0
.end method

.method public getVersion()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const-string v0, "1.0.67"

    return-object v0
.end method

.method public hasNotificationPermission()Z
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 70
    sget v0, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v1, 0x21

    if-lt v0, v1, :cond_0

    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v1, "android.permission.POST_NOTIFICATIONS"

    .line 71
    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->checkSelfPermission(Ljava/lang/String;)I

    move-result v0

    if-eqz v0, :cond_0

    const/4 v0, 0x0

    return v0

    .line 75
    :cond_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/NotificationManagerCompatShim;->areNotificationsEnabled(Landroid/content/Context;)Z

    move-result v0

    return v0
.end method

.method public isIgnoringBatteryOptimizations()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 662
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/DeviceCompat;->isIgnoringBatteryOptimizations(Landroid/content/Context;)Z

    move-result v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return v0

    :catch_0
    const/4 v0, 0x1

    return v0
.end method

.method public isNative()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const/4 v0, 0x1

    return v0
.end method

.method synthetic lambda$cleanupDictation$6$com-todaytodo-app-NativeBridge()V
    .locals 1

    .line 489
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/Dictaphone;->cleanup(Landroid/content/Context;)V

    return-void
.end method

.method synthetic lambda$cleanupScan$14$com-todaytodo-app-NativeBridge(Ljava/lang/String;)V
    .locals 1

    .line 750
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1}, Lcom/todaytodo/app/MainActivity;->cleanupScan(Ljava/lang/String;)V

    return-void
.end method

.method synthetic lambda$minimize$12$com-todaytodo-app-NativeBridge()V
    .locals 2

    .line 725
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->moveTaskToBack(Z)Z

    return-void
.end method

.method synthetic lambda$notifyNow$0$com-todaytodo-app-NativeBridge()V
    .locals 3

    .line 127
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v1, "\u901a\u77e5\u6743\u9650\u6ca1\u5f00\uff0c\u6d4b\u8bd5\u901a\u77e5\u53d1\u4e0d\u51fa\u53bb"

    const/4 v2, 0x1

    invoke-static {v0, v1, v2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    .line 128
    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    return-void
.end method

.method synthetic lambda$notifyNow$1$com-todaytodo-app-NativeBridge(Ljava/lang/String;Ljava/lang/String;)V
    .locals 8

    .line 135
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->ensureChannel(Landroid/content/Context;)V

    .line 136
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v1, "notification"

    .line 137
    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v0

    check-cast v0, Landroid/app/NotificationManager;

    if-nez v0, :cond_0

    return-void

    .line 139
    :cond_0
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v2, Landroid/content/Intent;

    iget-object v3, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-class v4, Lcom/todaytodo/app/MainActivity;

    invoke-direct {v2, v3, v4}, Landroid/content/Intent;-><init>(Landroid/content/Context;Ljava/lang/Class;)V

    const/high16 v3, 0x20000000

    .line 141
    invoke-virtual {v2, v3}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;

    move-result-object v2

    const/high16 v3, 0xc000000

    const/4 v4, 0x0

    .line 139
    invoke-static {v1, v4, v2, v3}, Landroid/app/PendingIntent;->getActivity(Landroid/content/Context;ILandroid/content/Intent;I)Landroid/app/PendingIntent;

    move-result-object v1

    .line 144
    new-instance v2, Landroid/app/Notification$Builder;

    iget-object v3, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v5, "todo_reminder"

    invoke-direct {v2, v3, v5}, Landroid/app/Notification$Builder;-><init>(Landroid/content/Context;Ljava/lang/String;)V

    const/high16 v3, 0x7f020000

    .line 146
    invoke-virtual {v2, v3}, Landroid/app/Notification$Builder;->setSmallIcon(I)Landroid/app/Notification$Builder;

    move-result-object v2

    const v3, -0xaa4dd

    .line 147
    invoke-virtual {v2, v3}, Landroid/app/Notification$Builder;->setColor(I)Landroid/app/Notification$Builder;

    move-result-object v2

    const-string v3, "\u4eca\u65e5\u5f85\u529e"

    if-nez p1, :cond_1

    move-object v5, v3

    goto :goto_0

    :cond_1
    move-object v5, p1

    .line 148
    :goto_0
    invoke-virtual {v2, v5}, Landroid/app/Notification$Builder;->setContentTitle(Ljava/lang/CharSequence;)Landroid/app/Notification$Builder;

    move-result-object v2

    const-string v5, ""

    if-nez p2, :cond_2

    move-object v6, v5

    goto :goto_1

    :cond_2
    move-object v6, p2

    .line 149
    :goto_1
    invoke-virtual {v2, v6}, Landroid/app/Notification$Builder;->setContentText(Ljava/lang/CharSequence;)Landroid/app/Notification$Builder;

    move-result-object v2

    new-instance v6, Landroid/app/Notification$BigTextStyle;

    invoke-direct {v6}, Landroid/app/Notification$BigTextStyle;-><init>()V

    new-instance v7, Ljava/lang/StringBuilder;

    invoke-direct {v7}, Ljava/lang/StringBuilder;-><init>()V

    if-nez p1, :cond_3

    move-object p1, v3

    .line 151
    :cond_3
    invoke-virtual {v7, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string p1, "\n"

    invoke-virtual {v7, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    if-nez p2, :cond_4

    move-object p2, v5

    .line 152
    :cond_4
    invoke-virtual {v7, p2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v7}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object p1

    .line 151
    invoke-virtual {v6, p1}, Landroid/app/Notification$BigTextStyle;->bigText(Ljava/lang/CharSequence;)Landroid/app/Notification$BigTextStyle;

    move-result-object p1

    .line 150
    invoke-virtual {v2, p1}, Landroid/app/Notification$Builder;->setStyle(Landroid/app/Notification$Style;)Landroid/app/Notification$Builder;

    move-result-object p1

    .line 153
    invoke-virtual {p1, v1}, Landroid/app/Notification$Builder;->setContentIntent(Landroid/app/PendingIntent;)Landroid/app/Notification$Builder;

    move-result-object p1

    const/4 p2, 0x1

    .line 154
    invoke-virtual {p1, p2}, Landroid/app/Notification$Builder;->setAutoCancel(Z)Landroid/app/Notification$Builder;

    move-result-object p1

    const-string v1, "reminder"

    .line 155
    invoke-virtual {p1, v1}, Landroid/app/Notification$Builder;->setCategory(Ljava/lang/String;)Landroid/app/Notification$Builder;

    move-result-object p1

    .line 156
    invoke-virtual {p1, v4}, Landroid/app/Notification$Builder;->setVisibility(I)Landroid/app/Notification$Builder;

    move-result-object p1

    .line 157
    invoke-virtual {p1, p2}, Landroid/app/Notification$Builder;->setShowWhen(Z)Landroid/app/Notification$Builder;

    move-result-object p1

    .line 158
    invoke-virtual {p1}, Landroid/app/Notification$Builder;->build()Landroid/app/Notification;

    move-result-object p1

    const/16 v1, 0x2329

    .line 160
    :try_start_0
    invoke-virtual {v0, v1, p1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V

    .line 161
    iget-object p1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v0, "\u5df2\u53d1\u9001\u4e00\u6761\u6d4b\u8bd5\u901a\u77e5\uff0c\u4e0b\u62c9\u901a\u77e5\u680f\u5c31\u80fd\u770b\u5230"

    invoke-static {p1, v0, p2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object p1

    .line 162
    invoke-virtual {p1}, Landroid/widget/Toast;->show()V
    :try_end_0
    .catch Ljava/lang/SecurityException; {:try_start_0 .. :try_end_0} :catch_0

    goto :goto_2

    .line 164
    :catch_0
    iget-object p1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v0, "\u901a\u77e5\u88ab\u7cfb\u7edf\u62e6\u4f4f\u4e86\uff0c\u8bf7\u5230\u7cfb\u7edf\u8bbe\u7f6e\u91cc\u653e\u884c"

    invoke-static {p1, v0, p2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object p1

    .line 165
    invoke-virtual {p1}, Landroid/widget/Toast;->show()V

    :goto_2
    return-void
.end method

.method synthetic lambda$openAutoStartSettings$8$com-todaytodo-app-NativeBridge()V
    .locals 3

    .line 683
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/DeviceCompat;->openAutoStartSettings(Landroid/content/Context;)Z

    move-result v0

    if-nez v0, :cond_0

    .line 685
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v1, "\u8bf7\u5728\u7cfb\u7edf\u8bbe\u7f6e\u91cc\u627e\u5230\u672c\u5e94\u7528\uff0c\u624b\u52a8\u5f00\u542f\u81ea\u542f\u52a8"

    const/4 v2, 0x1

    invoke-static {v0, v1, v2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    :cond_0
    return-void
.end method

.method synthetic lambda$openBatteryOptimizationSettings$7$com-todaytodo-app-NativeBridge()V
    .locals 3

    .line 672
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/DeviceCompat;->openBatteryOptimizationSettings(Landroid/content/Context;)Z

    move-result v0

    if-nez v0, :cond_0

    .line 674
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v1, "\u8fd9\u53f0\u624b\u673a\u6ca1\u6709\u8fd9\u4e2a\u8bbe\u7f6e\u9875\uff0c\u8bf7\u5728\u7cfb\u7edf\u8bbe\u7f6e\u91cc\u641c\u7d22\u300c\u7535\u6c60\u300d"

    const/4 v2, 0x1

    invoke-static {v0, v1, v2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    :cond_0
    return-void
.end method

.method synthetic lambda$pickAttachment$3$com-todaytodo-app-NativeBridge(Ljava/lang/String;)V
    .locals 1

    .line 306
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1}, Lcom/todaytodo/app/MainActivity;->pickAttachment(Ljava/lang/String;)V

    return-void
.end method

.method synthetic lambda$previewRingtone$2$com-todaytodo-app-NativeBridge(Landroid/net/Uri;)V
    .locals 2

    .line 0
    const-wide/16 v0, 0xdac

    .line 223
    invoke-direct {p0, p1, v0, v1}, Lcom/todaytodo/app/NativeBridge;->playUri(Landroid/net/Uri;J)V

    return-void
.end method

.method synthetic lambda$processScan$13$com-todaytodo-app-NativeBridge(Ljava/lang/String;Ljava/lang/String;)V
    .locals 1

    .line 744
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1, p2}, Lcom/todaytodo/app/MainActivity;->processScan(Ljava/lang/String;Ljava/lang/String;)V

    return-void
.end method

.method synthetic lambda$requestDeviceAuth$4$com-todaytodo-app-NativeBridge(Ljava/lang/String;Ljava/lang/String;)V
    .locals 1

    .line 388
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1, p2}, Lcom/todaytodo/app/MainActivity;->requestDeviceAuth(Ljava/lang/String;Ljava/lang/String;)V

    return-void
.end method

.method synthetic lambda$setTheme$11$com-todaytodo-app-NativeBridge(Ljava/lang/String;)V
    .locals 1

    .line 720
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1}, Lcom/todaytodo/app/MainActivity;->applyExternalTheme(Ljava/lang/String;)V

    return-void
.end method

.method synthetic lambda$startVoiceInput$5$com-todaytodo-app-NativeBridge()V
    .locals 3

    .line 407
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    .line 408
    invoke-static {}, Lcom/todaytodo/app/DeviceCompat;->isHuawei()Z

    move-result v1

    if-eqz v1, :cond_0

    const-string v1, "\u534e\u4e3a\u6ca1\u5f00\u653e\u8bed\u97f3\u8bc6\u522b\u63a5\u53e3\uff08\u5c0f\u827a\u4e0d\u5bf9\u5916\uff09\uff0c\u8bf7\u7528\u8f93\u5165\u6cd5\u952e\u76d8\u4e0a\u7684\u8bed\u97f3\u952e"

    goto :goto_0

    :cond_0
    const-string v1, "\u8fd9\u53f0\u624b\u673a\u6ca1\u6709\u8bed\u97f3\u8bc6\u522b\uff0c\u53ef\u4ee5\u7528\u952e\u76d8\u4e0a\u7684\u8bed\u97f3\u952e"

    :goto_0
    const/4 v2, 0x1

    .line 407
    invoke-static {v0, v1, v2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    .line 411
    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    return-void
.end method

.method synthetic lambda$toast$10$com-todaytodo-app-NativeBridge(Ljava/lang/String;)V
    .locals 2

    .line 714
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const/4 v1, 0x0

    invoke-static {v0, p1, v1}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object p1

    invoke-virtual {p1}, Landroid/widget/Toast;->show()V

    return-void
.end method

.method synthetic lambda$vibrate$9$com-todaytodo-app-NativeBridge(I)V
    .locals 3

    .line 696
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    const-string v1, "vibrator"

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v0

    check-cast v0, Landroid/os/Vibrator;

    if-eqz v0, :cond_1

    .line 698
    invoke-virtual {v0}, Landroid/os/Vibrator;->hasVibrator()Z

    move-result v1

    if-nez v1, :cond_0

    goto :goto_0

    :cond_0
    int-to-long v1, p1

    const/4 p1, -0x1

    .line 700
    invoke-static {v1, v2, p1}, Landroid/os/VibrationEffect;->createOneShot(JI)Landroid/os/VibrationEffect;

    move-result-object p1

    invoke-virtual {v0, p1}, Landroid/os/Vibrator;->vibrate(Landroid/os/VibrationEffect;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    nop

    :catch_0
    :cond_1
    :goto_0
    return-void
.end method

.method public listRingtones()Ljava/lang/String;
    .locals 11
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 312
    new-instance v0, Lorg/json/JSONArray;

    invoke-direct {v0}, Lorg/json/JSONArray;-><init>()V

    const/4 v1, 0x4

    const/4 v2, 0x1

    .line 313
    filled-new-array {v1, v2}, [I

    move-result-object v1

    const-string v3, "\u95f9\u949f\u94c3\u58f0"

    const-string v4, "\u6765\u7535\u94c3\u58f0"

    .line 317
    filled-new-array {v3, v4}, [Ljava/lang/String;

    move-result-object v3

    const/4 v4, 0x0

    :goto_0
    const/4 v5, 0x2

    if-ge v4, v5, :cond_5

    const/4 v5, 0x0

    .line 322
    :try_start_0
    new-instance v6, Landroid/media/RingtoneManager;

    iget-object v7, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v7}, Landroid/content/Context;->getApplicationContext()Landroid/content/Context;

    move-result-object v7

    invoke-direct {v6, v7}, Landroid/media/RingtoneManager;-><init>(Landroid/content/Context;)V

    .line 323
    aget v7, v1, v4

    invoke-virtual {v6, v7}, Landroid/media/RingtoneManager;->setType(I)V

    .line 324
    invoke-virtual {v6}, Landroid/media/RingtoneManager;->getCursor()Landroid/database/Cursor;

    move-result-object v5
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_1
    .catchall {:try_start_0 .. :try_end_0} :catchall_0

    if-nez v5, :cond_0

    if-eqz v5, :cond_4

    .line 341
    :goto_1
    :try_start_1
    invoke-interface {v5}, Landroid/database/Cursor;->close()V
    :try_end_1
    .catch Ljava/lang/Exception; {:try_start_1 .. :try_end_1} :catch_2

    goto :goto_3

    .line 326
    :cond_0
    :goto_2
    :try_start_2
    invoke-interface {v5}, Landroid/database/Cursor;->moveToNext()Z

    move-result v7

    if-eqz v7, :cond_2

    .line 327
    invoke-interface {v5, v2}, Landroid/database/Cursor;->getString(I)Ljava/lang/String;

    move-result-object v7

    .line 328
    invoke-interface {v5}, Landroid/database/Cursor;->getPosition()I

    move-result v8

    invoke-virtual {v6, v8}, Landroid/media/RingtoneManager;->getRingtoneUri(I)Landroid/net/Uri;

    move-result-object v8

    if-eqz v7, :cond_0

    if-nez v8, :cond_1

    goto :goto_2

    .line 330
    :cond_1
    new-instance v9, Lorg/json/JSONObject;

    invoke-direct {v9}, Lorg/json/JSONObject;-><init>()V

    const-string v10, "name"

    .line 331
    invoke-virtual {v9, v10, v7}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;

    const-string v7, "uri"

    .line 332
    invoke-virtual {v8}, Landroid/net/Uri;->toString()Ljava/lang/String;

    move-result-object v8

    invoke-virtual {v9, v7, v8}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;

    const-string v7, "type"

    .line 333
    aget-object v8, v3, v4

    invoke-virtual {v9, v7, v8}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;

    .line 334
    invoke-virtual {v0, v9}, Lorg/json/JSONArray;->put(Ljava/lang/Object;)Lorg/json/JSONArray;
    :try_end_2
    .catch Ljava/lang/Exception; {:try_start_2 .. :try_end_2} :catch_1
    .catchall {:try_start_2 .. :try_end_2} :catchall_0

    goto :goto_2

    :cond_2
    if-eqz v5, :cond_4

    goto :goto_1

    :catchall_0
    move-exception v0

    if-eqz v5, :cond_3

    .line 341
    :try_start_3
    invoke-interface {v5}, Landroid/database/Cursor;->close()V
    :try_end_3
    .catch Ljava/lang/Exception; {:try_start_3 .. :try_end_3} :catch_0

    .line 346
    :catch_0
    :cond_3
    throw v0

    :catch_1
    if-eqz v5, :cond_4

    goto :goto_1

    :catch_2
    :cond_4
    :goto_3
    add-int/lit8 v4, v4, 0x1

    goto :goto_0

    .line 348
    :cond_5
    invoke-virtual {v0}, Lorg/json/JSONArray;->toString()Ljava/lang/String;

    move-result-object v0

    return-object v0
.end method

.method public llmHttp(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;I)V
    .locals 8
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const-string v0, "window.LlmNet&&window.LlmNet.error(\'"

    .line 566
    :try_start_0
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    move-object v2, p1

    move-object v3, p2

    move-object v4, p3

    move-object v5, p4

    move-object v6, p5

    move v7, p6

    invoke-virtual/range {v1 .. v7}, Lcom/todaytodo/app/MainActivity;->llmHttp(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;I)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    goto :goto_0

    .line 569
    :catch_0
    :try_start_1
    iget-object p2, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance p3, Ljava/lang/StringBuilder;

    invoke-direct {p3, v0}, Ljava/lang/StringBuilder;-><init>(Ljava/lang/String;)V

    invoke-virtual {p3, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string p1, "\',\'\u5927\u6a21\u578b\u7f51\u7edc\u6865\u8c03\u7528\u5931\u8d25\')"

    invoke-virtual {p3, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {p3}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object p1

    invoke-virtual {p2, p1}, Lcom/todaytodo/app/MainActivity;->evaluate(Ljava/lang/String;)V
    :try_end_1
    .catch Ljava/lang/Exception; {:try_start_1 .. :try_end_1} :catch_1

    :catch_1
    :goto_0
    return-void
.end method

.method public llmParseTime(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    .locals 7
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const-string v0, "window.LlmHost&&window.LlmHost.error(\'"

    .line 547
    :try_start_0
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    move-object v2, p1

    move-object v3, p2

    move-object v4, p3

    move-object v5, p4

    move-object v6, p5

    invoke-virtual/range {v1 .. v6}, Lcom/todaytodo/app/MainActivity;->llmParseTime(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    goto :goto_0

    .line 550
    :catch_0
    :try_start_1
    iget-object p2, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance p3, Ljava/lang/StringBuilder;

    invoke-direct {p3, v0}, Ljava/lang/StringBuilder;-><init>(Ljava/lang/String;)V

    invoke-virtual {p3, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string p1, "\',\'\u79bb\u7ebf\u5927\u6a21\u578b\u6865\u8c03\u7528\u5931\u8d25\')"

    invoke-virtual {p3, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {p3}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object p1

    invoke-virtual {p2, p1}, Lcom/todaytodo/app/MainActivity;->evaluate(Ljava/lang/String;)V
    :try_end_1
    .catch Ljava/lang/Exception; {:try_start_1 .. :try_end_1} :catch_1

    :catch_1
    :goto_0
    return-void
.end method

.method public llmUploadAudio(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;)Z
    .locals 6
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 531
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    move-object v1, p1

    move-object v2, p2

    move-object v3, p3

    move v4, p4

    move-object v5, p5

    invoke-virtual/range {v0 .. v5}, Lcom/todaytodo/app/MainActivity;->llmUploadAudio(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    const/4 p1, 0x1

    return p1

    :catch_0
    const/4 p1, 0x0

    return p1
.end method

.method public markReminderTested()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 112
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->markTested(Landroid/content/Context;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public minimize()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 725
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda4;

    invoke-direct {v1, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda4;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public notifyNow(Ljava/lang/String;Ljava/lang/String;)Z
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 126
    invoke-virtual {p0}, Lcom/todaytodo/app/NativeBridge;->hasNotificationPermission()Z

    move-result v0

    if-nez v0, :cond_0

    .line 127
    iget-object p1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance p2, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda29;

    invoke-direct {p2, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda29;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {p1, p2}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    const/4 p1, 0x0

    return p1

    .line 132
    :cond_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->markTested(Landroid/content/Context;)V

    .line 134
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda30;

    invoke-direct {v1, p0, p1, p2}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda30;-><init>(Lcom/todaytodo/app/NativeBridge;Ljava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    const/4 p1, 0x1

    return p1
.end method

.method public ocrScan()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 756
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda10;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda10;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public openAutoStartSettings()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 682
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda2;

    invoke-direct {v1, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda2;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public openBatteryOptimizationSettings()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 671
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda14;

    invoke-direct {v1, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda14;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public openExactAlarmSettings()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 95
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda23;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda23;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public openNotificationSettings()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 90
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda24;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda24;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public pickAttachment(Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 306
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda25;

    invoke-direct {v1, p0, p1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda25;-><init>(Lcom/todaytodo/app/NativeBridge;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public pickAvatar()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 300
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda15;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda15;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public playAlert()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 194
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda6;

    invoke-direct {v1, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda6;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public previewRingtone(Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    if-eqz p1, :cond_1

    .line 216
    invoke-virtual {p1}, Ljava/lang/String;->isEmpty()Z

    move-result v0

    if-eqz v0, :cond_0

    goto :goto_0

    .line 219
    :cond_0
    :try_start_0
    invoke-static {p1}, Landroid/net/Uri;->parse(Ljava/lang/String;)Landroid/net/Uri;

    move-result-object p1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    .line 223
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda11;

    invoke-direct {v1, p0, p1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda11;-><init>(Lcom/todaytodo/app/NativeBridge;Landroid/net/Uri;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    :catch_0
    :cond_1
    :goto_0
    return-void
.end method

.method public processScan(Ljava/lang/String;Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 744
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda21;

    invoke-direct {v1, p0, p1, p2}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda21;-><init>(Lcom/todaytodo/app/NativeBridge;Ljava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public reminderTested()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 102
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->hasTested(Landroid/content/Context;)Z

    move-result v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return v0

    :catch_0
    const/4 v0, 0x0

    return v0
.end method

.method public requestDeviceAuth(Ljava/lang/String;Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 388
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda28;

    invoke-direct {v1, p0, p1, p2}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda28;-><init>(Lcom/todaytodo/app/NativeBridge;Ljava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public requestNotificationPermission()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 85
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda18;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda18;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public setRingtone(Ljava/lang/String;Ljava/lang/String;)V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 366
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0, p1, p2}, Lcom/todaytodo/app/ReminderScheduler;->setChosenRingtone(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V

    .line 367
    iget-object p1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {p1}, Lcom/todaytodo/app/ReminderScheduler;->rotateDueChannel(Landroid/content/Context;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public setTheme(Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 720
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda19;

    invoke-direct {v1, p0, p1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda19;-><init>(Lcom/todaytodo/app/NativeBridge;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method startAlertInternal()V
    .locals 3

    .line 204
    invoke-virtual {p0}, Lcom/todaytodo/app/NativeBridge;->stopAlertInternal()V

    .line 205
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/ReminderScheduler;->alertUri(Landroid/content/Context;)Landroid/net/Uri;

    move-result-object v0

    if-nez v0, :cond_0

    .line 207
    invoke-direct {p0}, Lcom/todaytodo/app/NativeBridge;->fallbackTone()V

    return-void

    :cond_0
    const-wide/16 v1, 0x2710

    .line 210
    invoke-direct {p0, v0, v1, v2}, Lcom/todaytodo/app/NativeBridge;->playUri(Landroid/net/Uri;J)V

    return-void
.end method

.method public startDictation()Z
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 459
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda1;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda1;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    const/4 v0, 0x1

    return v0

    :catch_0
    const/4 v0, 0x0

    return v0
.end method

.method public startScan()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 738
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda20;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda20;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public startVoiceInput()Z
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const/4 v0, 0x0

    .line 406
    :try_start_0
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v1}, Lcom/todaytodo/app/MainActivity;->canRecognizeSpeech()Z

    move-result v1

    if-nez v1, :cond_0

    .line 407
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v2, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda12;

    invoke-direct {v2, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda12;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v1, v2}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return v0

    .line 414
    :cond_0
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v1}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v2, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda13;

    invoke-direct {v2, v1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda13;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v1, v2}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    const/4 v0, 0x1

    :catch_0
    return v0
.end method

.method public startVoiceListening()Z
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const/4 v0, 0x0

    .line 426
    :try_start_0
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v1}, Lcom/todaytodo/app/MainActivity;->canUseInlineSpeech()Z

    move-result v1

    if-nez v1, :cond_0

    return v0

    .line 428
    :cond_0
    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v1}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v2, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda9;

    invoke-direct {v2, v1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda9;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v1, v2}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    const/4 v0, 0x1

    :catch_0
    return v0
.end method

.method public stopAlert()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 200
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda0;

    invoke-direct {v1, p0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda0;-><init>(Lcom/todaytodo/app/NativeBridge;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method stopAlertInternal()V
    .locals 2

    .line 270
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertHandler:Landroid/os/Handler;

    iget-object v1, p0, Lcom/todaytodo/app/NativeBridge;->alertStop:Ljava/lang/Runnable;

    invoke-virtual {v0, v1}, Landroid/os/Handler;->removeCallbacks(Ljava/lang/Runnable;)V

    .line 271
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertPlayer:Landroid/media/MediaPlayer;

    if-nez v0, :cond_0

    return-void

    .line 273
    :cond_0
    :try_start_0
    invoke-virtual {v0}, Landroid/media/MediaPlayer;->isPlaying()Z

    move-result v0

    if-eqz v0, :cond_1

    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertPlayer:Landroid/media/MediaPlayer;

    invoke-virtual {v0}, Landroid/media/MediaPlayer;->stop()V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    .line 278
    :catch_0
    :cond_1
    :try_start_1
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertPlayer:Landroid/media/MediaPlayer;

    invoke-virtual {v0}, Landroid/media/MediaPlayer;->release()V
    :try_end_1
    .catch Ljava/lang/Exception; {:try_start_1 .. :try_end_1} :catch_1

    :catch_1
    const/4 v0, 0x0

    .line 282
    iput-object v0, p0, Lcom/todaytodo/app/NativeBridge;->alertPlayer:Landroid/media/MediaPlayer;

    return-void
.end method

.method public stopDictation()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 468
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda26;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda26;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public stopVoiceListening()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 439
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Ljava/util/Objects;->requireNonNull(Ljava/lang/Object;)Ljava/lang/Object;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda5;

    invoke-direct {v1, v0}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda5;-><init>(Lcom/todaytodo/app/MainActivity;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public syncReminders(Ljava/lang/String;)V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 52
    :try_start_0
    new-instance v0, Lorg/json/JSONArray;

    if-nez p1, :cond_0

    const-string p1, "[]"

    :cond_0
    invoke-direct {v0, p1}, Lorg/json/JSONArray;-><init>(Ljava/lang/String;)V

    .line 53
    iget-object p1, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {p1, v0}, Lcom/todaytodo/app/ReminderScheduler;->sync(Landroid/content/Context;Lorg/json/JSONArray;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public toast(Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    if-nez p1, :cond_0

    return-void

    .line 713
    :cond_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda7;

    invoke-direct {v1, p0, p1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda7;-><init>(Lcom/todaytodo/app/NativeBridge;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public transcribeSegmentLocal(Ljava/lang/String;I)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 519
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1, p2}, Lcom/todaytodo/app/MainActivity;->transcribeSegmentLocal(Ljava/lang/String;I)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    const/4 p1, 0x1

    return p1

    :catch_0
    const/4 p1, 0x0

    return p1
.end method

.method public vaultGet(Ljava/lang/String;)Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 606
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0, p1}, Lcom/todaytodo/app/KeyVault;->get(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;

    move-result-object p1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return-object p1

    :catch_0
    const-string p1, ""

    return-object p1
.end method

.method public vaultPut(Ljava/lang/String;Ljava/lang/String;)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 596
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0, p1, p2}, Lcom/todaytodo/app/KeyVault;->put(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Z

    move-result p1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return p1

    :catch_0
    const/4 p1, 0x0

    return p1
.end method

.method public vaultReady()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 586
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0}, Lcom/todaytodo/app/KeyVault;->ready(Landroid/content/Context;)Z

    move-result v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return v0

    :catch_0
    const/4 v0, 0x0

    return v0
.end method

.method public vaultRemove(Ljava/lang/String;)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 615
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-static {v0, p1}, Lcom/todaytodo/app/KeyVault;->remove(Landroid/content/Context;Ljava/lang/String;)Z

    move-result p1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return p1

    :catch_0
    const/4 p1, 0x0

    return p1
.end method

.method public vibrate(I)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    if-gtz p1, :cond_0

    const/16 p1, 0x78

    goto :goto_0

    :cond_0
    const/16 v0, 0x3e8

    .line 693
    invoke-static {p1, v0}, Ljava/lang/Math;->min(II)I

    move-result p1

    .line 694
    :goto_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    new-instance v1, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda16;

    invoke-direct {v1, p0, p1}, Lcom/todaytodo/app/NativeBridge$$ExternalSyntheticLambda16;-><init>(Lcom/todaytodo/app/NativeBridge;I)V

    invoke-virtual {v0, v1}, Lcom/todaytodo/app/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public whisperAvailable()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 509
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0}, Lcom/todaytodo/app/MainActivity;->whisperAvailable()Z

    move-result v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    return v0

    :catch_0
    const/4 v0, 0x0

    return v0
.end method

.method public whisperTranscribeWav(Ljava/lang/String;Ljava/lang/String;)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 498
    :try_start_0
    iget-object v0, p0, Lcom/todaytodo/app/NativeBridge;->activity:Lcom/todaytodo/app/MainActivity;

    invoke-virtual {v0, p1, p2}, Lcom/todaytodo/app/MainActivity;->whisperTranscribeWav(Ljava/lang/String;Ljava/lang/String;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    const/4 p1, 0x1

    return p1

    :catch_0
    const/4 p1, 0x0

    return p1
.end method
