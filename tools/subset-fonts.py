"""한글 글꼴을 게임에 필요한 글자만 남겨 www/fonts 에 woff2 로 저장한다.

KS X 1001 한글 2,350자 + ASCII + 기호 + www/ 소스에 실제로 쓰인 글자를 넣는다.
원본 TTF 는 google/fonts 저장소(OFL)에서 받는다.

    pip install fonttools brotli
    python3 tools/subset-fonts.py
"""
import glob
import os
import subprocess
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = {
    'Jua-Regular': 'https://raw.githubusercontent.com/google/fonts/main/ofl/jua/Jua-Regular.ttf',
    'BlackHanSans-Regular': 'https://raw.githubusercontent.com/google/fonts/main/ofl/blackhansans/BlackHanSans-Regular.ttf',
}

chars = {chr(c) for c in range(0x20, 0x7F)}
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(bytes([hi, lo]).decode('euc-kr'))
        except UnicodeDecodeError:
            pass
chars |= set('°×·–—…↑↓→←~%!?♪★●○■□▲▼◀▶♥')
for f in glob.glob(os.path.join(ROOT, 'www', '*.js')) + glob.glob(os.path.join(ROOT, 'www', '*.html')):
    chars |= set(open(f, encoding='utf-8').read())
text = ''.join(sorted(c for c in chars if c.isprintable()))

with tempfile.TemporaryDirectory() as tmp:
    chars_file = os.path.join(tmp, 'chars.txt')
    open(chars_file, 'w', encoding='utf-8').write(text)
    for name, url in FONTS.items():
        ttf = os.path.join(tmp, name + '.ttf')
        urllib.request.urlretrieve(url, ttf)
        out = os.path.join(ROOT, 'www', 'fonts', name + '.woff2')
        subprocess.run(['pyftsubset', ttf, f'--text-file={chars_file}', '--flavor=woff2', f'--output-file={out}', "--layout-features=*"], check=True)
        print(out, os.path.getsize(out))
