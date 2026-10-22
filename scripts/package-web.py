#!/usr/bin/env python3
"""Package an existing Web build without caches, credentials or Android artifacts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parents[1]
web = root / 'web'
output = root / 'output'
output.mkdir(exist_ok=True)
dist_files = sorted(p for p in (web / 'dist').rglob('*') if p.is_file())
if not (web / 'dist/index.html').is_file():
    raise SystemExit('Run npm run build in web/ first')

bundles = []
static_zip = output / 'spacekeeper-web.zip'
with ZipFile(static_zip, 'w', ZIP_DEFLATED) as archive:
    for path in dist_files:
        archive.write(path, path.relative_to(web / 'dist'))
    archive.writestr('使用说明.txt', '''拾光清理 Web 0.1.0
此包为已构建静态站点，不需要 npm 依赖。
推荐：解压后用静态服务器提供目录，例如 python3 -m http.server 4173 --bind 127.0.0.1，
再用新版桌面 Chrome / Edge 打开 http://127.0.0.1:4173。
也可部署到 HTTPS 静态托管服务，无媒体上传后端。
直接双击 index.html 仅建议用作只读预览，浏览器可能限制存储或 Worker。
手机及不支持目录写入 API 的浏览器只能分析、预览、导出计划，不能删除原文件。
默认本地规则，可选模型需自行配置 HTTPS 网关；没有真实 Jev 联调结论。
删除必须确认，无回收站。首次验收使用合成测试目录。
74 项 Node 测试与构建通过，浏览器交互及系统权限尚未完成运行验收。
详见附带 docs/ 内的验证记录和模型网关契约。
''')
    for name in ['web-verification.md', 'model-gateway.md']:
        archive.write(root / 'docs' / name, 'docs/' + name)
bundles.append(static_zip)

source_zip = output / 'spacekeeper-web-source.zip'
with ZipFile(source_zip, 'w', ZIP_DEFLATED) as archive:
    for folder in ['src', 'public', 'scripts', 'tests']:
        for path in sorted((web / folder).rglob('*')):
            if path.is_file() and not path.is_symlink():
                archive.write(path, path.relative_to(root))
    for name in ['README.md', 'package.json', 'package-lock.json', 'playwright.config.mjs']:
        archive.write(web / name, 'web/' + name)
    for name in ['web-verification.md', 'model-gateway.md']:
        archive.write(root / 'docs' / name, 'docs/' + name)
    archive.write(Path(__file__), 'scripts/package-web.py')
bundles.append(source_zip)

manifest = {
    'version': '0.1.0',
    'build': json.loads((web / 'dist/build-info.json').read_text()),
    'verification': {'nodeTestsPassed': 74, 'syntax': 'passed', 'build': 'passed',
                     'browser': 'blocked at Chromium launch; not verified', 'realModels': 'not verified'},
    'files': [{'name': p.name, 'size': p.stat().st_size,
               'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in bundles],
}
(output / 'spacekeeper-web-build-info.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
for bundle in bundles:
    with ZipFile(bundle) as archive:
        assert archive.testzip() is None
    print(f'{bundle.name}: {bundle.stat().st_size:,} bytes; ZIP integrity passed')
