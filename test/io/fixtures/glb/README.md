# GLB fixtures

The paired `onshape-cylinder-uncompressed.glb` and
`onshape-cylinder-compressed.glb` fixtures are 15 KiB and 11 KiB binary GLBs
supplied for femgx issue #423. Their metadata identifies the exporter as
`ONSHAPE BY PTC INC, 1.219`; the compressed fixture uses
`KHR_draco_mesh_compression`.

The importer tests use the uncompressed file as the provenance sample and the
compressed file to verify the selected Draco decoder path. Both fixtures
contain the simple cylinder Part Studio display tessellation.
