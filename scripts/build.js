const fs = require('fs/promises');
const crypto = require('crypto');

const files = [
  'pagina-independiente-top-secret_1.html', 'content-model.js', 'public-content.js',
  'editor.js', 'admin.css', 'sello.png', 'VOCERO DEL SUR - 3ra Edición.pdf',
  'VOCERO DEL SUR - 3ra Edición_pages-to-jpg-0001.jpg',
  'VOCERO DEL SUR - 3ra Edición_pages-to-jpg-0002.jpg',
];

(async () => {
  await fs.rm('dist', { recursive: true, force: true });
  await fs.mkdir('dist', { recursive: true });
  const main = await fs.readFile('pagina-independiente_4.html');
  const admin = await fs.readFile('admin.html');
  const content = JSON.parse(await fs.readFile('content.json', 'utf8'));
  await fs.writeFile('dist/index.html', main);
  await fs.writeFile('dist/admin.html', admin);
  await fs.writeFile('dist/pagina-independiente_4.html', main);
  await fs.writeFile('dist/content-bootstrap.js', `window.INITIAL_PRESS_CONTENT=${JSON.stringify(content)};\n`);
  for (const file of files) await fs.copyFile(file, `dist/${file}`);
  await fs.copyFile('sello.png', 'dist/logo.png');
  for (const directory of ['uploads', 'content-assets']) {
    try { await fs.cp(directory, `dist/${directory}`, { recursive: true }); } catch {}
  }

  const html = [main.toString(), admin.toString(), await fs.readFile('pagina-independiente-top-secret_1.html', 'utf8')];
  const hashes = new Set();
  for (const page of html) {
    for (const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`);
    }
  }
  const csp = `default-src 'self'; script-src 'self' ${[...hashes].join(' ')}; img-src 'self' https: data: blob:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  await fs.writeFile('dist/_headers', `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: ${csp}\n/api/*\n  Cache-Control: no-store\n/uploads/*\n  Cache-Control: public, max-age=31536000, immutable\n/content-assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
})();
