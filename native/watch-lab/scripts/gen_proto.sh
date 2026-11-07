#!/usr/bin/env bash
# Regenerate watchlab/proto/ from proto/ (Gadgetbridge's Xiaomi protos, copied verbatim).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/Scripts/python
[ -x "$PY" ] || PY=.venv/bin/python
rm -rf watchlab/proto/xiaomi watchlab/proto/xiaomi_pb2.py
mkdir -p watchlab/proto
"$PY" -m grpc_tools.protoc -Iproto --python_out=watchlab/proto proto/xiaomi.proto proto/xiaomi/*.proto
# protoc emits `from xiaomi import x_pb2`; point it at the package instead of needing sys.path tricks.
sed -i 's/^from xiaomi import /from watchlab.proto.xiaomi import /; s/^import xiaomi_pb2 /import watchlab.proto.xiaomi_pb2 /' \
    watchlab/proto/xiaomi_pb2.py watchlab/proto/xiaomi/*_pb2.py
touch watchlab/proto/__init__.py watchlab/proto/xiaomi/__init__.py
echo "generated: $(ls watchlab/proto/xiaomi/*_pb2.py | wc -l) modules + xiaomi_pb2.py"
