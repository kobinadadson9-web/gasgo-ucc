"""Build offline demo and full project archive. Run: python3 build-downloads.py"""
from pathlib import Path
import json
import zipfile

base = Path(__file__).resolve().parent
html = (base / 'public/index.html').read_text()
css = (base / 'public/styles.css').read_text()
seed = json.loads((base / 'data/db.json').read_text())
# Never bundle the deployment's private credentials or real orders in the offline demo.
seed['security'] = {'ownerPassword': 'uccboss2026', 'riderPin': '2222'}
seed['orders'] = []
js = 'window.__SEED_DB__ = ' + json.dumps(seed) + ';\n'
js += (base / 'offline-adapter.js').read_text() + '\n'
js += (base / 'public/app.js').read_text()
js = js.replace('</script', '<\\/script')
html = html.replace('<link rel="stylesheet" href="/styles.css" />', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="/app.js"></script>', '<script>\n' + js + '\n</script>')
html = html.replace('<body>', '<body><div style="padding:12px;background:#fff3cd;color:#664d03;text-align:center;font:14px system-ui">Offline demo only — password locks are inspectable. Payments are simulated. Deploy the server-backed project for shared access.</div>')
(base.parent / 'GasGo-UCC-Website.html').write_text(html)
with zipfile.ZipFile(base.parent / 'GasGo-UCC-Full-Project.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for file in base.rglob('*'):
        if file.is_file() and not any(p in {'node_modules', '.git', '__pycache__', '.env'} for p in file.relative_to(base).parts):
            z.write(file, str(Path(base.name) / file.relative_to(base)))
print('Built offline demo and full project ZIP.')
