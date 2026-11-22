import json
import struct
from zipfile import ZipFile

with ZipFile("dist/dbd-statistics-extension.zip") as archive:
    manifest = json.loads(archive.read("manifest.json"))
    assert "key" not in manifest, "Development keys cannot be uploaded to the store"
    for size, path in manifest["icons"].items():
        data = archive.read(path)
        assert data.startswith(b"\x89PNG\r\n\x1a\n")
        assert struct.unpack(">II", data[16:24]) == (int(size), int(size))
    for script in manifest["content_scripts"]:
        for path in script["js"]:
            assert archive.read(path), f"Missing content script: {path}"
    assert archive.read(manifest["background"]["service_worker"])

print("Store ZIP verified: no development key; icon folders, dimensions and scripts are valid.")
