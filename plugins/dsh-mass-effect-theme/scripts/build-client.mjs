import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = path.join(pluginRoot, 'src', 'client.template.js')
const wallpaperPath = path.join(pluginRoot, 'assets', 'normandy-command.jpg')
const outputPath = path.join(pluginRoot, 'lib', 'client.js')

const [template, wallpaper] = await Promise.all([
  readFile(templatePath, 'utf8'),
  readFile(wallpaperPath),
])

const placeholder = '__WALLPAPER_DATA_URL__'
const occurrences = template.split(placeholder).length - 1
if (occurrences !== 1) {
  throw new Error(`Expected one ${placeholder} placeholder, found ${occurrences}`)
}

const dataUrl = `data:image/jpeg;base64,${wallpaper.toString('base64')}`
const output = template.replace(placeholder, JSON.stringify(dataUrl))
await writeFile(outputPath, output)
