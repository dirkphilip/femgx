# GLB fixtures

`onshape-cylinder-uncompressed.glb` is a 15 KiB binary GLB supplied for femgx
issue #423. Its metadata identifies the exporter as `ONSHAPE BY PTC INC, 1.219`.
It was exported as a GLB with mesh compression disabled and contains the simple
cylinder Part Studio display tessellation used by the importer tests.

The fixture is retained as a provenance sample for the uncompressed Onshape
path. A current Onshape export with the **Compress** option enabled is still
required before a compression decoder is selected and the importer issue is
closed; Onshape's public documentation does not identify that extension.
