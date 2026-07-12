from pathlib import Path

workflow = Path('.github/workflows/qa.yml')
source = workflow.read_text()
old = 'run: npx playwright install --with-deps chromium'
new = 'run: npx playwright install --with-deps chromium webkit'
count = source.count(old)
if count != 1:
    raise SystemExit(f'expected one Playwright install command, found {count}')
workflow.write_text(source.replace(old, new, 1))
print('added WebKit to phase 5 QA browser installation')
