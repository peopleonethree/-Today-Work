"""Merge the verified R8 adapter with the cached Whisper Small base."""
import argparse
import hashlib
from pathlib import Path

EXPECTED = "2fb9f2dded81fb49034fd329a266cc4b6dc6ab9dab7173ff3647ac14521bceb7"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with (args.adapter / "adapter_model.safetensors").open("rb") as weights:
        if hashlib.file_digest(weights, "sha256").hexdigest() != EXPECTED:
            raise ValueError("R8 adapter hash mismatch")
    if not (args.base / "model.safetensors").is_file():
        raise FileNotFoundError("The local Whisper Small base is missing")
    args.output.mkdir(parents=False, exist_ok=False)

    from peft import PeftModel
    from transformers import AutoProcessor, WhisperForConditionalGeneration

    base = WhisperForConditionalGeneration.from_pretrained(
        args.base, local_files_only=True, torch_dtype="float32"
    )
    model = PeftModel.from_pretrained(base, args.adapter, local_files_only=True)
    merged = model.merge_and_unload(safe_merge=True)
    merged.save_pretrained(args.output, safe_serialization=True)
    AutoProcessor.from_pretrained(args.base, local_files_only=True).save_pretrained(
        args.output
    )
    print("Verified R8 adapter merged:", args.output)

if __name__ == "__main__":
    main()
