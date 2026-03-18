import write from 'shp-write/src/write.js'
import prj from 'shp-write/src/prj.js'

const WGS84_PRJ = prj

/** Copia para Uint8Array (DataView/ArrayBuffer). */
function toU8(data) {
  if (data == null) return new Uint8Array(0)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data.buffer instanceof ArrayBuffer) {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    return new Uint8Array(buf)
  }
  return new Uint8Array(0)
}

/**
 * Build and download shapefile files (.shp/.shx/.dbf/.prj) individually.
 * If `dirHandle` is provided (File System Access API), writes files into that directory.
 * Otherwise triggers 4 browser downloads (may require allowing multiple downloads).
 */
export function downloadShpFiles(geojson, options = {}, baseFilename = 'amostra', dirHandle = null) {
  const features = (geojson.features || []).filter(
    (f) => f.geometry && f.geometry.type === 'Point'
  )
  if (features.length === 0) {
    throw new Error('Nenhum ponto para exportar.')
  }

  const geometries = features.map((f) => f.geometry.coordinates)
  const properties = features.map((f) => f.properties || {})

  return new Promise((resolve, reject) => {
    try {
      write(properties, 'POINT', geometries, (err, files) => {
      if (err) {
        reject(err)
        return
      }
      if (!files || !files.shp || !files.shx) {
        reject(new Error('Shapefile não gerado (shp/shx ausentes).'))
        return
      }
      const pointName =
        (options && options.types && options.types.point) || 'point'

      const shpBuf = toU8(files.shp) // Uint8Array
      const shxBuf = toU8(files.shx)
      const dbfBuf = files.dbf ? toU8(files.dbf) : new Uint8Array(0)
      const prjBuf = new TextEncoder().encode(WGS84_PRJ)

      const root = (baseFilename || 'amostra').replace(/[^\w\-]+/g, '_')
      const fn = (ext) => `${root}_${pointName}${ext}`

      const blobs = [
        { name: fn('.shp'), blob: new Blob([shpBuf], { type: 'application/octet-stream' }) },
        { name: fn('.shx'), blob: new Blob([shxBuf], { type: 'application/octet-stream' }) },
        { name: fn('.dbf'), blob: new Blob([dbfBuf], { type: 'application/octet-stream' }) },
        { name: fn('.prj'), blob: new Blob([prjBuf], { type: 'text/plain' }) },
      ]

      // Preferred: write all files into chosen directory (Chrome/Edge)
      if (dirHandle) {
        ;(async () => {
          // Ensure we have write permission up-front (Chrome/Edge)
          if (typeof dirHandle.requestPermission === 'function') {
            const perm = await dirHandle.requestPermission({ mode: 'readwrite' })
            if (perm !== 'granted') {
              throw new Error('Permissão negada para salvar arquivos na pasta selecionada.')
            }
          }
          const written = []
          for (const f of blobs) {
            const fh = await dirHandle.getFileHandle(f.name, { create: true })
            const w = await fh.createWritable()
            // Write as ArrayBuffer for maximum compatibility
            const ab = await f.blob.arrayBuffer()
            await w.write(ab)
            await w.close()
            const saved = await fh.getFile()
            if (!saved || typeof saved.size !== 'number' || saved.size <= 0) {
              throw new Error(`Arquivo gravado com 0 bytes: ${f.name}`)
            }
            written.push({ name: f.name, size: saved.size })
          }
          resolve({ mode: 'directory', files: written.map((x) => x.name), sizes: written })
        })().catch(reject)
        return
      }

      // Fallback: trigger 4 downloads (browser may ask to allow multiple files)
      // IMPORTANT: avoid setTimeout before click (can lose user gesture and download is ignored)
      for (const f of blobs) {
        const url = URL.createObjectURL(f.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = f.name
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        // revoke later to avoid revoking before the download starts
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      }
      resolve({ mode: 'downloads', files: blobs.map((b) => b.name) })
    })
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}
