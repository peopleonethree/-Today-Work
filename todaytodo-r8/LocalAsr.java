package com.todaytodo.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Looper;
import android.util.Log;
import com.k2fsa.sherpa.onnx.*;
import java.io.*;
import java.util.Arrays;

/** Whisper Small R8 INT8. Only worker threads may initialize or decode. */
public final class LocalAsr {
    private static final Object LOCK=new Object();
    private static OfflineRecognizer recognizer;
    private static BoundedVad vad;
    private static final String ENCODER="whisper-r8/encoder.int8.onnx"; 
    private static final String DECODER="whisper-r8/decoder.int8.onnx";
    private static final String TOKENS="whisper-r8/tokens.txt";
    private static final String VAD="sensevoice/silero_vad.onnx";

    private LocalAsr() {}

    /** Capability check performs no model copy, native load or inference. */
    public static boolean isAvailable(Context context) {
        try {
            for(String path:new String[]{ENCODER,DECODER,TOKENS,VAD}) {
                try(InputStream in=context.getAssets().open(path)) { if(in.read()<0) return false; }
            }
            return android.os.Build.SUPPORTED_ABIS.length>0 && "arm64-v8a".equals(android.os.Build.SUPPORTED_ABIS[0]);
        } catch(IOException e) { return false; }
    }
    private static void requireWorker() {
        if(Looper.myLooper()==Looper.getMainLooper()) throw new IllegalStateException("语音识别需要后台线程");
    }
    private static void ensureVad(AssetManager assets) {
        if(vad!=null) return;
        vad=new BoundedVad(assets);
    }
    private static void ensureRecognizer(AssetManager assets) {
        if(recognizer!=null) return;
        long started=System.nanoTime();
        OfflineWhisperModelConfig whisper=new OfflineWhisperModelConfig(ENCODER,DECODER,"zh","transcribe",1000,false,false);
        OfflineModelConfig model=new OfflineModelConfig();
        model.setWhisper(whisper); model.setTokens(TOKENS); model.setNumThreads(2);
        model.setProvider("cpu"); model.setModelType("whisper");
        OfflineRecognizerConfig config=new OfflineRecognizerConfig(); config.setModelConfig(model);
        recognizer=new OfflineRecognizer(assets,config);
        Log.i("TodayTodo","[local-asr] Whisper Small R8 INT8 ready "+((System.nanoTime()-started)/1000000)+"ms");
    }
    /** Small VAD only: app launch does not allocate the speech model. */
    public static void prewarm(Context context) {
        requireWorker();
        synchronized(LOCK) { ensureVad(context.getAssets()); }
    }
    public static void prewarmModel(Context context) { prewarm(context); }
    public static String transcribe(Context context,String wavPath) throws IOException {
        requireWorker();
        long started=System.nanoTime();
        synchronized(LOCK) {
            try(PcmWavReader reader=new PcmWavReader(new File(wavPath))) {
                if(reader.sampleCount()==0) return "";
                ensureVad(context.getAssets()); vad.reset();
                StringBuilder text=new StringBuilder(); final int[] segments={0};
                BoundedVad.SpeechConsumer consumer=samples -> { decode(context.getAssets(),samples,text); segments[0]++; };
                try {
                    while(true) {
                        float[] chunk=reader.read(512); if(chunk.length==0) break;
                        if(chunk.length<512) chunk=Arrays.copyOf(chunk,512);
                        vad.accept(chunk,consumer);
                    }
                    vad.finish(consumer);
                    Log.i("TodayTodo","[local-asr] samples="+reader.sampleCount()+" segments="+segments[0]
                            +" elapsedMs="+((System.nanoTime()-started)/1000000)+" chars="+text.length());
                    return text.toString().trim();
                } finally { vad.reset(); }
            }
        }
    }
    private static void decode(AssetManager assets,float[] samples,StringBuilder text) {
        ensureRecognizer(assets);
        OfflineStream stream=recognizer.createStream();
        try {
            stream.acceptWaveform(samples,16000); recognizer.decode(stream);
            String part=recognizer.getResult(stream).getText().trim();
            if(!part.isEmpty()) { if(text.length()>0) text.append('\n'); text.append(part); }
        } finally { stream.release(); }
    }
}

