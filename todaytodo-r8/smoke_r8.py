"""Decode the existing Mandarin fixture with the exported INT8 weights."""
from pathlib import Path
import sys
import time
import wave

import numpy as np
import onnxruntime as ort
import whisper
from whisper.tokenizer import get_tokenizer

root = Path(__file__).resolve().parent
input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / "sensevoice-local/fixtures/zh.wav"
with wave.open(str(input_path)) as audio:
    assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (16000, 1, 2)
    samples = np.frombuffer(audio.readframes(160000), dtype="<i2").astype(np.float32) / 32768

opts = ort.SessionOptions()
opts.intra_op_num_threads = 4
encoder, decoder = [
    ort.InferenceSession(str(root / "onnx" / f"small-{part}.int8.onnx"),
                         opts, providers=["CPUExecutionProvider"])
    for part in ("encoder", "decoder")
]
tokenizer = get_tokenizer(True, language="zh", task="transcribe")
mel = whisper.log_mel_spectrogram(whisper.pad_or_trim(samples), n_mels=80)
start = time.monotonic()
cross_k, cross_v = encoder.run(None, {"mel": mel.numpy()[None]})
self_k = np.zeros((12, 1, 448, 768), dtype=np.float32)
self_v = np.zeros_like(self_k)
prompt = list(tokenizer.sot_sequence_including_notimestamps)
tokens, offset, result = prompt, 0, []
for _ in range(96):
    logits, self_k, self_v = decoder.run(None, dict(
        zip((item.name for item in decoder.get_inputs()),
            (np.array([tokens], dtype=np.int64), self_k, self_v,
             cross_k, cross_v, np.array([offset], dtype=np.int64)))
    ))
    scores = logits[0, -1]
    scores[tokenizer.eot+1:] = -np.inf
    if not result:
        scores[tokenizer.eot] = scores[220] = -np.inf
    predicted = int(scores.argmax())
    if predicted == tokenizer.eot:
        break
    result.append(predicted)
    offset += len(tokens)
    tokens = [predicted]
text = tokenizer.decode(result).strip()
assert text, "No decoded fixture text"
print(f"{len(samples)/16000:.2f}s input; {time.monotonic()-start:.2f}s decode")
print(text)
