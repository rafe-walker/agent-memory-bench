// Worker for first-start.mjs: import the package, spin until a shared start
// time, then open the store (identity + db creation) and print the key id.
const [, , pkgIndex, dataDir, goAt] = process.argv;
const { KronicleLite } = await import(pkgIndex);
while (Date.now() < +goAt) { /* barrier */ }
const s = new KronicleLite({ dataDir });
process.stdout.write(`key_id: ${s.identity.signer.key_id}\n`);
s.close();
