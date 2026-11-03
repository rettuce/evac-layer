// Smooth colour fields compress badly as PNG; posterizing them (fewer levels per channel) keeps the
// picture and brings the file under the gallery limit without an image library.
const POSTERIZE_STEPS = [8, 16]

async function posterize(page, png, step) {
  const data = await page.evaluate(
    async (base64, step) => {
      const img = new Image()
      img.src = `data:image/png;base64,${base64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const pixels = ctx.getImageData(0, 0, img.width, img.height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.min(255, Math.round(pixels.data[i + c] / step) * step)
      }
      ctx.putImageData(pixels, 0, 0)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    png.toString('base64'),
    step,
  )
  return Buffer.from(data, 'base64')
}

export async function fitUnder(page, png, maxBytes) {
  let bytes = png
  for (const step of POSTERIZE_STEPS) {
    if (bytes.length <= maxBytes) break
    bytes = await posterize(page, bytes, step)
  }
  return bytes
}
