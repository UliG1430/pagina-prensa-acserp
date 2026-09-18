const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contentFile = path.join(root, 'content.json');
const assetsDir = path.join(root, 'content-assets');
const mimeExtensions = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

(async () => {
  const sourceFile = process.argv[2] ? path.resolve(process.argv[2]) : contentFile;
  const content = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  const manifest = {};
  await fs.mkdir(assetsDir, { recursive: true });

  for (const type of ['diarios', 'entrevistas', 'noticieros']) {
    for (const item of (content[type] || []).flat()) {
      item.imagenes = await Promise.all((item.imagenes || []).map(async (source) => {
        const match = /^data:([^;,]+);base64,(.+)$/s.exec(source);
        if (!match || !mimeExtensions[match[1]]) return source;
        const bytes = Buffer.from(match[2], 'base64');
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        const filename = `${digest.slice(0, 20)}.${mimeExtensions[match[1]]}`;
        await fs.writeFile(path.join(assetsDir, filename), bytes);
        manifest[`${match[1]}:${digest}`] = `/content-assets/${filename}`;
        return `/content-assets/${filename}`;
      }));
    }
  }

  await fs.writeFile(contentFile, `${JSON.stringify(content, null, 2)}\n`);
  await fs.writeFile(path.join(assetsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
})();
