#!/usr/bin/env sh
# Package the complete, immutable Lambda MicroVM build context as one ZIP.
# Run from any directory; the ZIP contains Dockerfile at its root as required
# by the MicroVM image builder.  The model itself remains ignored by git.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
output=${1:-"$repo_root/artifacts/openjev-runtime.zip"}
case "$output" in
  /*) ;;
  *) output="$PWD/$output" ;;
esac

config="$repo_root/configs/config.json"
models_dir="$repo_root/models"
python3 "$script_dir/download_model.py" --config "$config" --output-dir "$models_dir" --verify-existing

stage=$(mktemp -d "${TMPDIR:-/tmp}/openjev-runtime.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
mkdir -p "$stage/apps/inference" "$stage/configs" "$stage/models" "$(dirname -- "$output")"

# Keep the repository-root paths used by the Dockerfile and additionally put a
# root Dockerfile in the archive for the MicroVM image build service.
cp "$repo_root/apps/inference/Dockerfile" "$stage/Dockerfile"
cp "$repo_root/apps/inference/Dockerfile" "$stage/apps/inference/Dockerfile"
cp "$repo_root/apps/inference/requirements.txt" "$stage/apps/inference/requirements.txt"
cp "$repo_root/apps/inference/entrypoint.sh" "$stage/apps/inference/entrypoint.sh"
cp -R "$repo_root/apps/inference/src" "$stage/apps/inference/src"
cp -R "$repo_root/apps/inference/scripts" "$stage/apps/inference/scripts"
cp -R "$repo_root/configs/." "$stage/configs/"

model_file=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["model"]["ggufFile"])' "$config")
cp "$models_dir/$model_file" "$stage/models/$model_file"

artifact_manifest="$stage/artifact-manifest.json"
python3 - "$config" "$artifact_manifest" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
model = config["model"]
Path(sys.argv[2]).write_text(
    json.dumps(
        {
            "formatVersion": 1,
            "model": {
                "source": model["source"],
                "revision": model["revision"],
                "ggufFile": model["ggufFile"],
                "expectedBytes": model["expectedBytes"],
                "sha256": model["sha256"],
            },
        },
        ensure_ascii=False,
        indent=2,
    ) + "\n",
    encoding="utf-8",
)
PY

temporary="$output.tmp"
rm -f "$temporary"
(cd "$stage" && zip -q -r "$temporary" .)
mv "$temporary" "$output"
sha256=$(shasum -a 256 "$output" | awk '{print $1}')
printf 'Created MicroVM artifact: %s\nArtifact SHA-256: %s\n' "$output" "$sha256"
