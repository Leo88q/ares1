// Decompress KHR_draco_mesh_compression in-place for models/*.glb
// so the browser GLTFLoader needs no DRACOLoader (file:// friendly).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const draco3d = require('draco3dgltf');

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.join(base, 'models');

function align4(n) { return (n + 3) & ~3; }

function readGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  let bin = null;
  let off = 20 + jsonLen;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len); // 'BIN\0'
    off += 8 + align4(len);
  }
  return { json, bin };
}

function writeGlb(json, bin) {
  let jsonStr = JSON.stringify(json);
  const jsonPad = align4(jsonStr.length) - jsonStr.length;
  jsonStr += ' '.repeat(jsonPad);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const binPad = align4(bin.length) - bin.length;
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); // glTF
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // JSON
  jsonBuf.copy(out, 20);
  let off = 20 + jsonBuf.length;
  out.writeUInt32LE(bin.length + binPad, off);
  out.writeUInt32LE(0x004e4942, off + 4); // BIN\0
  bin.copy(out, off + 8);
  return out;
}

const decoderModule = await draco3d.createDecoderModule({});

function decompressPrimitive(json, bin, primitive) {
  const ext = primitive.extensions && primitive.extensions['KHR_draco_mesh_compression'];
  if (!ext) return false;

  const dv = json.bufferViews[ext.bufferView];
  const start = dv.byteOffset || 0;
  const compressed = bin.slice(start, start + dv.byteLength);

  const buffer = new decoderModule.DecoderBuffer();
  buffer.Init(new Int8Array(compressed), compressed.byteLength);
  const decoder = new decoderModule.Decoder();
  const geomType = decoder.GetEncodedGeometryType(buffer);
  const mesh = new decoderModule.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, mesh);

  if ((status && typeof status.ok === 'function' && !status.ok()) || mesh.ptr === 0) {
    throw new Error('draco decode failed for primitive');
  }

  const numPoints = mesh.num_points();
  const numFaces = mesh.num_faces();
  const chunks = [];
  let byteOffset = 0;

  // индексы — как в DRACOLoader: GetTrianglesUInt32Array в HEAP
  const numIndices = numFaces * 3;
  const iptr = decoderModule._malloc(numIndices * 4);
  decoder.GetTrianglesUInt32Array(mesh, numIndices * 4, iptr);
  const idx = new Uint32Array(decoderModule.HEAPF32.buffer, iptr, numIndices).slice();
  decoderModule._free(iptr);
  const idxBuf = Buffer.from(idx.buffer);
  const idxViewIndex = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBuf.length });
  chunks.push(idxBuf);
  byteOffset += align4(idxBuf.length);
  const padIdx = align4(idxBuf.length) - idxBuf.length;
  if (padIdx) chunks.push(Buffer.alloc(padIdx));

  if (primitive.indices == null) {
    primitive.indices = json.accessors.length;
    json.accessors.push({
      bufferView: idxViewIndex,
      componentType: 5125,
      count: idx.length,
      type: 'SCALAR'
    });
  } else {
    const acc = json.accessors[primitive.indices];
    acc.bufferView = idxViewIndex;
    acc.byteOffset = 0;
    acc.componentType = 5125;
    acc.count = idx.length;
    delete acc.normalized;
  }

  // атрибуты → Float32
  for (const [semantic, uidStr] of Object.entries(ext.attributes)) {
    const uid = Number(uidStr);
    const attr = decoder.GetAttributeByUniqueId(mesh, uid);
    if (!attr || attr.ptr === 0) throw new Error(`attribute ${semantic} not found`);
    const nc = attr.num_components();
    // КАК В DRACOLoader: GetAttributeDataArrayForAllPoints с явным DT_FLOAT32
    // (применяет де-квантизацию; GetAttributeFloatForAllPoints этого не делал)
    const numValues = numPoints * nc;
    const byteLen = numValues * 4;
    const ptr = decoderModule._malloc(byteLen);
    decoder.GetAttributeDataArrayForAllPoints(mesh, attr, decoderModule.DT_FLOAT32, byteLen, ptr);
    const arr = new Float32Array(decoderModule.HEAPF32.buffer, ptr, numValues).slice();
    decoderModule._free(ptr);
    const buf = Buffer.from(arr.buffer);
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: buf.length });
    chunks.push(buf);
    byteOffset += align4(buf.length);
    const pad = align4(buf.length) - buf.length;
    if (pad) chunks.push(Buffer.alloc(pad));

    const accIndex = primitive.attributes[semantic];
    if (accIndex == null) throw new Error(`missing accessor for ${semantic}`);
    const acc = json.accessors[accIndex];
    acc.bufferView = viewIndex;
    acc.byteOffset = 0;
    acc.componentType = 5126; // FLOAT
    acc.count = numPoints;
    acc.type = nc === 2 ? 'VEC2' : nc === 3 ? 'VEC3' : nc === 4 ? 'VEC4' : 'SCALAR';
    delete acc.normalized;
  }

  delete primitive.extensions['KHR_draco_mesh_compression'];
  if (primitive.extensions && Object.keys(primitive.extensions).length === 0) delete primitive.extensions;

  decoderModule.destroy(mesh);
  decoderModule.destroy(decoder);
  decoderModule.destroy(buffer);
  return chunks;
}

const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.glb'));
for (const f of files) {
  const p = path.join(modelsDir, f);
  const raw = fs.readFileSync(p);
  if (!raw.includes('KHR_draco_mesh_compression')) {
    console.log(`${f}: без draco — ок`);
    continue;
  }
  const { json, bin } = readGlb(raw);
  const newChunks = [];
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const c = decompressPrimitive(json, bin, prim);
      if (c) newChunks.push(...c);
    }
  }
  // вычищаем extension из списков
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (json[key]) {
      json[key] = json[key].filter((e) => e !== 'KHR_draco_mesh_compression');
      if (json[key].length === 0) delete json[key];
    }
  }
  // bufferViews ссылаются на buffer:0 — новый bin = старый + новые чанки (offset'ы новых считали от начала новых чанков!)
  // Пересобираем: кладём НОВЫЕ данные после старого bin, поправляем byteOffset'ы
  // (в decompressPrimitive offsets считались от0 новых чанков — фиксим здесь)
  const oldLen = bin.length;
  let fixBase = oldLen;
  // найдём все новые bufferViews (созданные после исходных) и сдвинем их offsets
  // проще: новые views мы пушли с byteOffset от0..; им нужен +oldLen
  // Определим исходное число views по исходному json? Мы уже пушли... сохраним число ДО:
  // => читаем исходное кол-во из копии
  // (решение: перечитаем исходное json для подсчёта)
  const origJson = readGlb(raw).json;
  const origViews = (origJson.bufferViews || []).length;
  for (let i = origViews; i < json.bufferViews.length; i++) {
    json.bufferViews[i].byteOffset = (json.bufferViews[i].byteOffset || 0) + fixBase;
  }
  const outBin = Buffer.concat([bin, ...newChunks]);
  const out = writeGlb(json, outBin);
  fs.writeFileSync(p, out);
  console.log(`${f}: draco декомпрессирован → ${out.length} байт`);
}
console.log('done');
