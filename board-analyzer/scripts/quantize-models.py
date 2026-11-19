"""Recreates scanner/models/*.onnx from the upstream chessimg2pos weights (8-bit, dynamic quantization).

    python3 -m venv /tmp/q && /tmp/q/bin/pip install chessimg2pos onnx onnxruntime
    /tmp/q/bin/python scripts/quantize-models.py

The first command downloads the upstream weights (about 170 MB) to ~/.cache/chessimg2pos on first use.
"""
import os
import sys

from chessimg2pos import load_predictor  # noqa: F401  (downloads the weights into the cache)
from onnxruntime.quantization import QuantType, quantize_dynamic

load_predictor()
src = os.path.expanduser("~/.cache/chessimg2pos/0.2.0/v2")
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scanner", "models")
os.makedirs(dst, exist_ok=True)
for name in ("board", "locator"):
    out = os.path.join(dst, f"{name}.onnx")
    quantize_dynamic(os.path.join(src, f"{name}.onnx"), out, weight_type=QuantType.QUInt8)
    print(name, os.path.getsize(os.path.join(src, f"{name}.onnx")) // 10**6, "MB ->", os.path.getsize(out) // 10**6, "MB")
sys.exit(0)
