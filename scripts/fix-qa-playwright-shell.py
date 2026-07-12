from pathlib import Path
import traceback

path = Path('.github/workflows/qa.yml')
status_path = Path('.patch-status')
error_path = Path('.patch-error')

jobs = [
    ('qa-online-flow', 'QA online flow', '20'),
    ('qa-roll-movement', 'QA roll and movement', '25'),
    ('qa-lobby-desktop', 'QA desktop lobby', '15'),
    ('qa-mobile-layout', 'QA mobile and tablet layout', '15'),
]

try:
    text = path.read_text(encoding='utf-8')
    for job_id, job_name, timeout in jobs:
        old = (
            f'  {job_id}:\n'
            f'    name: {job_name}\n'
            '    needs: deploy-pages\n'
            '    runs-on: ubuntu-latest\n'
            f'    timeout-minutes: {timeout}\n'
            '    container:\n'
        )
        new = (
            f'  {job_id}:\n'
            f'    name: {job_name}\n'
            '    needs: deploy-pages\n'
            '    runs-on: ubuntu-latest\n'
            f'    timeout-minutes: {timeout}\n'
            '    defaults:\n'
            '      run:\n'
            '        shell: bash\n'
            '    container:\n'
        )
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f'{job_id}: expected one target block, found {count}')
        text = text.replace(old, new, 1)

    for job_id, _, _ in jobs:
        start = text.index(f'  {job_id}:')
        next_job = text.find('\n  ', start + 3)
        block = text[start: next_job if next_job >= 0 else len(text)]
        expected = '    defaults:\n      run:\n        shell: bash\n'
        if expected not in block:
            raise RuntimeError(f'{job_id}: Bash defaults missing after patch')
        if 'set -o pipefail' not in block:
            raise RuntimeError(f'{job_id}: expected pipefail command missing')

    path.write_text(text, encoding='utf-8')
    status_path.write_text('ok\n', encoding='utf-8')
    error_path.unlink(missing_ok=True)
except Exception:
    status_path.write_text('failed\n', encoding='utf-8')
    error_path.write_text(traceback.format_exc(), encoding='utf-8')
