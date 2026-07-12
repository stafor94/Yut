from pathlib import Path

app_path = Path('src/app/App.tsx')
app = app_path.read_text()
old = "new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('JOIN_ROOM_TIMEOUT')), CREATE_ROOM_TIMEOUT_MS))"
new = "new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('JOIN_ROOM_TIMEOUT')), CREATE_ROOM_AUTH_TIMEOUT_MS))"
assert app.count(old) == 1, app.count(old)
app_path.write_text(app.replace(old, new))
