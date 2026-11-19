# Third-party notices for the board scanner

The scanner turns a picture of a chess board into a position. It is built from these open-source parts.

## chessimg2pos (MIT)
- Project: https://github.com/mdicio/chessimg2pos, copyright (c) 2025 Marcodicio. Licence: `LICENSE-chessimg2pos.txt`.
- `models/locator.onnx` and `models/board.onnx` are the project's v2 ONNX weights (release v0.2.0), shrunk to 8-bit with
  ONNX Runtime's dynamic quantization (`../scripts/quantize-models.py`). 181 MB became 46 MB. Nothing else about the
  networks was changed.
- `core.js` is a JavaScript port of the project's image pre-processing, board locating, decoding and legality step
  (`chessimg2pos/v2/*.py` and the browser demo `web/index.html`). Image resizing follows Pillow's antialiased bilinear
  filter, because that is what the networks were trained against.

## ONNX Runtime Web 1.20.1 (MIT)
- https://github.com/microsoft/onnxruntime, copyright (c) Microsoft Corporation.
- `ort/ort.wasm.min.mjs`, `ort/ort-wasm-simd-threaded.mjs` and `ort/ort-wasm-simd-threaded.wasm` are copied unmodified from
  the `onnxruntime-web` npm package, version 1.20.1.

The rest of the extension is GPL-3.0 (see the repository's LICENSE).
