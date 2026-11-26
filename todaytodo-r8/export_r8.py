"""Export the merged R8 checkpoint with the official sherpa Whisper exporter."""
import os
from pathlib import Path
import runpy
import sys

import torch
from safetensors.torch import load_file
import whisper
from whisper.model import ModelDimensions, Whisper
from whisper.model import MultiHeadAttention

root = Path(__file__).resolve().parent
output = root / "onnx"
output.mkdir(exist_ok=True)
source = load_file(str(root / "merged-hf/model.safetensors"))
model = Whisper(ModelDimensions(80, 1500, 768, 12, 12, 51865, 448, 768, 12, 12))
mapping = {
    "encoder.positional_embedding": "encoder.embed_positions.weight",
    "decoder.positional_embedding": "decoder.embed_positions.weight",
    "decoder.token_embedding.weight": "decoder.embed_tokens.weight",
    "encoder.ln_post": "encoder.layer_norm",
    "decoder.ln": "decoder.layer_norm",
    ".attn_ln.": ".self_attn_layer_norm.",
    ".cross_attn_ln.": ".encoder_attn_layer_norm.",
    ".mlp_ln.": ".final_layer_norm.",
    ".mlp.0.": ".fc1.",
    ".mlp.2.": ".fc2.",
    ".cross_attn.": ".encoder_attn.",
    ".attn.": ".self_attn.",
    ".query.": ".q_proj.",
    ".key.": ".k_proj.",
    ".value.": ".v_proj.",
    ".out.": ".out_proj.",
    ".blocks.": ".layers.",
}

def hf_key(name):
    for old, new in mapping.items():
        name = name.replace(old, new)
    return "model." + name

mapped = {target: source[hf_key(target)] for target in model.state_dict()}
remaining = set(source) - {hf_key(target) for target in mapped}
if remaining:
    if remaining != {"proj_out.weight"} or not torch.equal(
        source["proj_out.weight"], mapped["decoder.token_embedding.weight"]
    ):
        raise ValueError(f"Unexpected unused weights: {sorted(remaining)}")
model.load_state_dict(mapped, strict=True)
model.eval()
MultiHeadAttention.use_sdpa = False
del mapped, source
torch.set_num_threads(4)

def local_model(name, *args, **kwargs):
    if name != "small":
        raise ValueError("Expected Whisper Small")
    return model

whisper.load_model = local_model
original_export = torch.onnx.export

def export_legacy(*args, **kwargs):
    return original_export(*args, **{**kwargs, "dynamo": False})

torch.onnx.export = export_legacy
os.chdir(output)
script = root / "sherpa-export.py"
sys.argv = [str(script), "--model", "small"]
runpy.run_path(str(script), run_name="__main__")
