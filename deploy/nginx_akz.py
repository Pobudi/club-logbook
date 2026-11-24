#!/usr/bin/env python3
"""Make sure nginx forwards akz.ai4es.xyz to the app's port.

Looks only at `server { ... }` blocks whose server_name includes the domain, in the
enabled nginx config files, and points their local proxy_pass lines at 127.0.0.1:PORT.
Other sites (ai4es.xyz) are never touched. Backs up each changed file, runs `nginx -t`,
and restores the backup if the test fails. Prints what it found either way.

usage: sudo python3 nginx_akz.py DOMAIN PORT
"""
import glob, os, re, shutil, subprocess, sys, time

DOMAIN, PORT = sys.argv[1], sys.argv[2]
TARGET = f"http://127.0.0.1:{PORT}"
LOCAL = re.compile(r"(proxy_pass\s+)(https?://(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?::\d+)?)(/?\s*;)")


def server_blocks(text):
    """Yield (start, end) of each top-level-ish `server {` block, by brace counting (comments skipped)."""
    i, n = 0, len(text)
    while True:
        m = re.compile(r"(^|[\s;{}])server\s*\{", re.M).search(text, i)
        if not m:
            return
        start = m.start() + len(m.group(1))
        depth, j = 0, text.index("{", start)
        while j < n:
            c = text[j]
            if c == "#":
                j = text.find("\n", j)
                if j < 0:
                    j = n
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        yield start, j + 1
        i = j + 1


def names_of(block):
    out = []
    for m in re.finditer(r"^\s*server_name\s+([^;]+);", block, re.M):
        out += m.group(1).split()
    return out


files = sorted({os.path.realpath(f) for f in glob.glob("/etc/nginx/sites-enabled/*") + glob.glob("/etc/nginx/conf.d/*.conf") if os.path.isfile(f)})
found, changed = 0, []
for path in files:
    text = open(path, encoding="utf-8").read()
    new, last = [], 0
    for s, e in server_blocks(text):
        block = text[s:e]
        if DOMAIN not in names_of(block):
            continue
        found += 1
        targets = [m.group(2) for m in LOCAL.finditer(block)]
        listen = re.findall(r"^\s*listen\s+([^;]+);", block, re.M)
        print(f"nginx: {path}: server block for {DOMAIN} (listen {', '.join(listen) or '?'}) -> proxy_pass {', '.join(targets) or 'none'}")
        fixed = LOCAL.sub(lambda m: m.group(1) + TARGET + m.group(3), block)
        if fixed != block:
            new.append(text[last:s] + fixed)
            last = e
    if new:
        new.append(text[last:])
        # outside sites-enabled/, which nginx loads wholesale
        os.makedirs("/etc/nginx/akz-backups", exist_ok=True)
        backup = f"/etc/nginx/akz-backups/{os.path.basename(path)}.{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, backup)
        open(path, "w", encoding="utf-8").write("".join(new))
        changed.append((path, backup))
        print(f"nginx: {path}: proxy_pass set to {TARGET} (backup: {backup})")

if not found:
    print(f"nginx: no server block with server_name {DOMAIN} in {', '.join(files) or 'no enabled files'}")
    sys.exit(2)

if changed:
    test = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
    if test.returncode != 0:
        print("nginx: test failed after the change, restoring backups:\n" + test.stderr)
        for path, backup in changed:
            shutil.copy2(backup, path)
        sys.exit(1)
    subprocess.run(["systemctl", "reload", "nginx"], check=True)
    print("nginx: config valid, reloaded")
else:
    print(f"nginx: no change needed for {DOMAIN}")
